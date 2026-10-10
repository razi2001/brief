// The ticket's technical logs: which pages, which network calls (with how long
// each took, the backend's trace id, and for a failed one what was sent and
// what came back), what the console said - exact, from the capture, never
// written by the agent. Pure: unit-tested in tech-details.test.ts.
//
// Two sources, one shape:
//  - a replay (replay.json): rrweb custom events (type 5, tag "brief") that the
//    extension's page capture adds, plus each page load's Meta event (type 4).
//  - a recording (brief.json): the capture's events, each with `tMs` into the
//    recording and the page `url` it happened on.
//
// Every line has two times. `t` is on the video's clock (a replay's cut-out
// idle time is gone from it, so it matches what plays). `at` is the real time
// (epoch ms) the page reported, which no cut can shift - what a server log
// shows. Older captures have no `at`; their lines show the video time only.

type Ev = Record<string, unknown> & { data?: Record<string, unknown> & { payload?: Record<string, unknown> } };

export type NetCall = {
  t: number;
  at?: number;
  method: string;
  url: string;
  status: number;
  ms?: number;
  reason?: string;
  /** "x-request-id: …" - the header the backend tagged the call with */
  trace?: string;
  /** a failed call's bodies, as captured (text, capped, secrets masked) */
  request?: string;
  response?: string;
};
export type ConsoleLine = { t: number; at?: number; level: "error" | "warn"; text: string };
export type PageLine = { t: number; at?: number; url: string };
export type TechDetails = { pages: PageLine[]; network: NetCall[]; console: ConsoleLine[] };

const SLOW_MS = 1000;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
const opt = (v: unknown) => str(v) || undefined;

function addPage(pages: PageLine[], t: number, url: string, at?: number) {
  if (!url) return;
  const last = pages[pages.length - 1];
  if (last && last.url === url) {
    if (last.at == null && at != null && Math.abs(last.t - t) < 2000) last.at = at;
    return;
  }
  pages.push({ t: Math.max(0, t), at, url });
}

function consoleText(kind: string, d: Record<string, unknown>): string {
  if (kind === "js-error") {
    const at = str(d.filename) ? ` (${str(d.filename).split("/").pop()}:${num(d.lineno) ?? "?"})` : "";
    return `${str(d.message)}${at}`;
  }
  if (kind === "promise-rejection") return `Unhandled rejection: ${str(d.reason)}`;
  return (Array.isArray(d.args) ? d.args : []).map((a) => String(a)).join(" ");
}

function callOf(t: number, d: Record<string, unknown>): NetCall {
  return {
    t,
    at: num(d.at),
    method: str(d.method) || "GET",
    url: str(d.url),
    status: num(d.status) ?? 0,
    ms: num(d.ms),
    reason: opt(d.reason),
    trace: opt(d.trace),
    request: opt(d.request),
    response: opt(d.response),
  };
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
    const at = num(p.at);
    if (kind === "nav") addPage(out.pages, t, str(p.url), at);
    else if (kind === "network") out.network.push(callOf(t, p));
    else if (kind === "console-warn") out.console.push({ t, at, level: "warn", text: consoleText(kind, p) });
    else if (kind === "console-error" || kind === "js-error" || kind === "promise-rejection") {
      out.console.push({ t, at, level: "error", text: consoleText(kind, p) });
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
    const at = num(e.at);
    // on a network event `url` is the request; on every other one, the page
    const isNet = type === "network" || type === "network-error";
    if (!isNet) addPage(out.pages, t, str(e.url), type === "nav" ? at : undefined);
    if (type === "network" || (type === "network-error" && !hasAllCalls)) out.network.push(callOf(t, e));
    else if (type === "console-warn") out.console.push({ t, at, level: "warn", text: consoleText(type, e) });
    else if (type === "console-error" || type === "js-error" || type === "promise-rejection") {
      out.console.push({ t, at, level: "error", text: consoleText(type, e) });
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
/** "18:36:28.412" (UTC), or blanks so the columns still line up */
function utc(at?: number): string {
  return at != null ? new Date(at).toISOString().slice(11, 23) : " ".repeat(12);
}
function dur(ms?: number): string {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
function shortUrl(u: string, max = 110): string {
  const s = u.replace(/^https?:\/\//, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const fence = (lines: string[]) => "```text\n" + lines.join("\n").replace(/```/g, "'''") + "\n```";

/** The UTC day the capture happened on, for the section's time note. */
function dayOf(td: TechDetails): string {
  const at = [...td.pages, ...td.network, ...td.console].map((x) => x.at).find((x) => x != null);
  return at != null ? new Date(at).toISOString().slice(0, 10) : "";
}

/**
 * The section itself, as Markdown (each tracker folds it its own way). Long
 * lists are capped: the notable calls always show, the rest up to a total.
 */
export function renderTechDetails(td: TechDetails, { maxCalls = 40, maxConsole = 25, maxBody = 600 } = {}): string {
  const parts: string[] = [];
  const day = dayOf(td);
  const stamp = (x: { t: number; at?: number }) => (day ? `${clock(x.t)}  ${utc(x.at)}` : clock(x.t));
  const pad = " ".repeat(stamp({ t: 0 }).length);

  if (td.pages.length) {
    parts.push("**Pages**\n\n" + fence(td.pages.slice(0, 20).map((p) => `${stamp(p)}  ${shortUrl(p.url, 140)}`)));
  }
  if (td.network.length) {
    const ranked = rankCalls(td.network);
    const shown = ranked.slice(0, maxCalls);
    const w = Math.min(70, Math.max(...shown.map((c) => shortUrl(c.url, 70).length)));
    const lines: string[] = [];
    for (const c of shown) {
      const status = c.status ? String(c.status) : "failed";
      const why = !c.status && c.reason ? `  ${c.reason}` : "";
      lines.push(`${stamp(c)}  ${c.method.padEnd(6)} ${shortUrl(c.url, 70).padEnd(w)}  ${status.padEnd(6)} ${dur(c.ms)}${why}`.trimEnd());
      if (c.trace) lines.push(`${pad}  trace     ${c.trace}`);
      if (c.request) lines.push(`${pad}  request   ${oneLine(c.request, maxBody)}`);
      if (c.response) lines.push(`${pad}  response  ${oneLine(c.response, maxBody)}`);
    }
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
    const lines = ordered.map((c) => `${stamp(c)}  ${c.level.padEnd(5)}  ${oneLine(c.text, 300)}`);
    if (td.console.length > ordered.length) lines.push(`… ${td.console.length - ordered.length} more`);
    parts.push("**Console**\n\n" + fence(lines));
  }
  if (!parts.length) return "";
  const note = day
    ? `Times: into the video, then the clock in UTC (${day}), which is what server logs show.`
    : "Times: into the video.";
  return [note, ...parts].join("\n\n");
}

/** What the agent reads: the same facts, compact, to call out what matters. */
export function techForAgent(td: TechDetails): string {
  if (isEmpty(td)) return "";
  const lines: string[] = [];
  if (td.pages.length) lines.push("Pages: " + td.pages.map((p) => `${clock(p.t)} ${shortUrl(p.url, 120)}`).join(" -> "));
  const notable = rankCalls(td.network).filter((c) => failed(c) || slow(c)).slice(0, 12);
  if (notable.length) {
    lines.push("Failed or slow network calls:");
    for (const c of notable) {
      lines.push(`- ${clock(c.t)} ${c.method} ${shortUrl(c.url, 140)} -> ${c.status || "failed"} in ${dur(c.ms) || "?"}${c.reason ? ` (${c.reason})` : ""}`);
      // what the server said is often the root cause, verbatim
      if (c.response) lines.push(`  response: ${oneLine(c.response, 300)}`);
    }
  } else if (td.network.length) {
    lines.push(`Network: ${td.network.length} requests, none failed or slow (all under ${SLOW_MS} ms).`);
  }
  const errs = td.console.filter((c) => c.level === "error").slice(0, 10);
  if (errs.length) {
    lines.push("Console errors:");
    for (const c of errs) lines.push(`- ${clock(c.t)} ${oneLine(c.text, 300)}`);
  }
  return lines.join("\n");
}
