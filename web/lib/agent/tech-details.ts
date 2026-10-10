// The ticket's technical details: which pages, which network calls (with how
// long each took), what the console said - exact, from the capture, never
// written by the agent. Pure: unit-tested in tech-details.test.ts.
//
type Ev = Record<string, unknown> & { data?: Record<string, unknown> & { payload?: Record<string, unknown> } };

// Two sources, one shape:
//  - a replay (replay.json): rrweb custom events (type 5, tag "brief") that the
//    extension's page capture adds, plus each page load's Meta event (type 4).
//    Times are on the replay's own clock - the same as its video.
//  - a recording (brief.json): the capture's events, each with `tMs` into the
//    recording and the page `url` it happened on.

export type NetCall = { t: number; method: string; url: string; status: number; ms?: number; reason?: string };
export type ConsoleLine = { t: number; level: "error" | "warn"; text: string };
export type TechDetails = { pages: Array<{ t: number; url: string }>; network: NetCall[]; console: ConsoleLine[] };

const SLOW_MS = 1000;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);

function addPage(pages: TechDetails["pages"], t: number, url: string) {
  if (!url) return;
  if (pages.length && pages[pages.length - 1].url === url) return;
  pages.push({ t: Math.max(0, t), url });
}

function consoleText(kind: string, d: Record<string, unknown>): string {
  if (kind === "js-error") {
    const at = str(d.filename) ? ` (${str(d.filename).split("/").pop()}:${num(d.lineno) ?? "?"})` : "";
    return `${str(d.message)}${at}`;
  }
  if (kind === "promise-rejection") return `Unhandled rejection: ${str(d.reason)}`;
  return (Array.isArray(d.args) ? d.args : []).map((a) => String(a)).join(" ");
}

/** From an attached replay (replay.json's events). */
export function techFromReplay(file: unknown): TechDetails {
  const out: TechDetails = { pages: [], network: [], console: [] };
  const events = Array.isArray((file as { events?: unknown })?.events) ? (file as { events: Ev[] }).events : [];
  if (!events.length) return out;
  const t0 = num(events[0].timestamp) ?? 0;
  for (const e of events) {
    const t = (num(e.timestamp) ?? t0) - t0;
    if (e.type === 4) addPage(out.pages, t, str(e.data?.href));
    if (e.type !== 5 || e.data?.tag !== "brief") continue;
    const p = e.data.payload ?? {};
    const kind = str(p.kind);
    if (kind === "nav") addPage(out.pages, t, str(p.url));
    else if (kind === "network") {
      out.network.push({ t, method: str(p.method) || "GET", url: str(p.url), status: num(p.status) ?? 0, ms: num(p.ms), reason: str(p.reason) || undefined });
    } else if (kind === "console-warn") out.console.push({ t, level: "warn", text: consoleText(kind, p) });
    else if (kind === "console-error" || kind === "js-error" || kind === "promise-rejection") {
      out.console.push({ t, level: "error", text: consoleText(kind, p) });
    }
  }
  return out;
}

/** From a recording (brief.json's capture events). */
export function techFromRecording(json: unknown): TechDetails {
  const out: TechDetails = { pages: [], network: [], console: [] };
  const events = Array.isArray((json as { events?: unknown })?.events) ? (json as { events: Ev[] }).events : [];
  // An extension that predates `network` events only reported failures.
  const hasAllCalls = events.some((e) => e?.type === "network");
  for (const e of events) {
    const t = Math.max(0, num(e.tMs) ?? 0);
    const type = str(e.type);
    // on a network event `url` is the request; on every other one, the page
    const isNet = type === "network" || type === "network-error";
    if (!isNet) addPage(out.pages, t, str(e.url));
    if (type === "network" || (type === "network-error" && !hasAllCalls)) {
      out.network.push({ t, method: str(e.method) || "GET", url: str(e.url), status: num(e.status) ?? 0, ms: num(e.ms), reason: str(e.reason) || undefined });
    } else if (type === "console-warn") out.console.push({ t, level: "warn", text: consoleText(type, e) });
    else if (type === "console-error" || type === "js-error" || type === "promise-rejection") {
      out.console.push({ t, level: "error", text: consoleText(type, e) });
    }
  }
  return out;
}

export function isEmpty(td: TechDetails | null | undefined): boolean {
  return !td || (!td.network.length && !td.console.length && td.pages.length < 2);
}

const failed = (c: NetCall) => !c.status || c.status >= 400;
const slow = (c: NetCall) => (c.ms ?? 0) >= SLOW_MS;
/** Failed first, then the slowest, then the rest in time order. */
export function rankCalls(calls: NetCall[]): NetCall[] {
  const notable = calls.filter((c) => failed(c) || slow(c)).sort((a, b) => Number(failed(b)) - Number(failed(a)) || (b.ms ?? 0) - (a.ms ?? 0));
  return [...notable, ...calls.filter((c) => !failed(c) && !slow(c))];
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function dur(ms?: number): string {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
function shortUrl(u: string, max = 110): string {
  const s = u.replace(/^https?:\/\//, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const fence = (lines: string[]) => "```text\n" + lines.join("\n").replace(/```/g, "'''") + "\n```";

/**
 * The section itself, as Markdown (each tracker folds it its own way). Long
 * lists are capped: the notable calls always show, the rest up to a total.
 */
export function renderTechDetails(td: TechDetails, { maxCalls = 40, maxConsole = 25 } = {}): string {
  const parts: string[] = [];
  if (td.pages.length) {
    parts.push("**Pages**\n\n" + fence(td.pages.slice(0, 20).map((p) => `${clock(p.t)}  ${shortUrl(p.url, 140)}`)));
  }
  if (td.network.length) {
    const ranked = rankCalls(td.network);
    const shown = ranked.slice(0, maxCalls);
    const w = Math.min(70, Math.max(...shown.map((c) => shortUrl(c.url, 70).length)));
    const lines = shown.map((c) => {
      const status = c.status ? String(c.status) : "failed";
      const why = !c.status && c.reason ? `  ${c.reason}` : "";
      return `${clock(c.t)}  ${c.method.padEnd(6)} ${shortUrl(c.url, 70).padEnd(w)}  ${status.padEnd(6)} ${dur(c.ms)}${why}`.trimEnd();
    });
    const rest = ranked.length - shown.length;
    if (rest > 0) lines.push(`… ${rest} more`);
    const nFailed = td.network.filter(failed).length;
    const nSlow = td.network.filter((c) => !failed(c) && slow(c)).length;
    const head = [`${td.network.length} request${td.network.length === 1 ? "" : "s"}`, nFailed && `${nFailed} failed`, nSlow && `${nSlow} slow`].filter(Boolean).join(", ");
    parts.push(`**Network** (${head}; failed and slowest first)\n\n` + fence(lines));
  }
  if (td.console.length) {
    const errs = td.console.filter((c) => c.level === "error");
    const ordered = [...errs, ...td.console.filter((c) => c.level === "warn")].slice(0, maxConsole);
    const lines = ordered.map((c) => `${clock(c.t)}  ${c.level.padEnd(5)}  ${c.text.replace(/\s+/g, " ").slice(0, 300)}`);
    if (td.console.length > ordered.length) lines.push(`… ${td.console.length - ordered.length} more`);
    parts.push("**Console**\n\n" + fence(lines));
  }
  return parts.join("\n\n");
}

/** What the agent reads: the same facts, compact, to call out what matters. */
export function techForAgent(td: TechDetails): string {
  if (isEmpty(td)) return "";
  const lines: string[] = [];
  if (td.pages.length) lines.push("Pages: " + td.pages.map((p) => `${clock(p.t)} ${shortUrl(p.url, 120)}`).join(" -> "));
  const notable = rankCalls(td.network).filter((c) => failed(c) || slow(c)).slice(0, 12);
  if (notable.length) {
    lines.push("Failed or slow network calls:");
    for (const c of notable) lines.push(`- ${clock(c.t)} ${c.method} ${shortUrl(c.url, 140)} -> ${c.status || "failed"} in ${dur(c.ms) || "?"}${c.reason ? ` (${c.reason})` : ""}`);
  } else if (td.network.length) {
    lines.push(`Network: ${td.network.length} requests, none failed or slow (all under ${SLOW_MS} ms).`);
  }
  const errs = td.console.filter((c) => c.level === "error").slice(0, 10);
  if (errs.length) {
    lines.push("Console errors:");
    for (const c of errs) lines.push(`- ${clock(c.t)} ${c.text.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return lines.join("\n");
}
