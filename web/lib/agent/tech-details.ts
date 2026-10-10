// The ticket's technical logs, one set per video - exact, from the capture,
// never written by the agent. Pure: unit-tested in tech-details.test.ts.
//
//   Failed and slow   each with its trace id, what was sent, what came back
//   Timeline          everything in order: what the user did (page loads,
//                     reloads, clicks, typing), each network call, the console
//
// Two sources, one shape:
//  - a replay (replay.json): its rrweb events - page loads (Meta), clicks and
//    typing (via replay-steps), and the custom events (type 5, tag "brief") the
//    extension's page capture adds: network calls, console, address changes.
//  - a recording (brief.json): the capture's events, each with `tMs` into the
//    recording, `at`, and the page `url` it happened on.
//
// Every line has two times. `t` is on the video's clock (a replay's cut-out
// idle time is gone from it, so it matches what plays). `at` is the real time
// (epoch ms), which no cut can shift - what a server log shows. Lines the
// capture had no real time for get one from their nearest neighbour that has
// one (exact within a stretch the replay didn't cut).

import { replayActions, type ReplayFile } from "./replay-steps";

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
  /** what was sent (failed or slow calls) and what came back (failed calls) */
  request?: string;
  response?: string;
};
export type ConsoleLine = { t: number; at?: number; level: "error" | "warn"; text: string };
export type PageLine = { t: number; at?: number; url: string };
/** what the user did: "open", "reload", "click", "type", "key", ... */
export type Action = { t: number; at?: number; kind: string; what: string };
export type TechDetails = { pages: PageLine[]; network: NetCall[]; console: ConsoleLine[]; actions: Action[] };

const SLOW_MS = 1000;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
const opt = (v: unknown) => str(v) || undefined;
const empty = (): TechDetails => ({ pages: [], network: [], console: [], actions: [] });

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

/** Lines with no real time borrow it from the nearest line that has one. */
function fillClock(td: TechDetails): TechDetails {
  const known = [...td.pages, ...td.network, ...td.console, ...td.actions]
    .filter((x) => x.at != null)
    .sort((a, b) => a.t - b.t);
  if (!known.length) return td;
  const near = (t: number) => {
    let best = known[0];
    for (const k of known) if (Math.abs(k.t - t) < Math.abs(best.t - t)) best = k;
    return best;
  };
  for (const x of [...td.pages, ...td.network, ...td.console, ...td.actions]) {
    if (x.at == null) { const k = near(x.t); x.at = (k.at as number) + (x.t - k.t); }
  }
  return td;
}

/** From an attached replay (replay.json). */
export function techFromReplay(file: unknown): TechDetails {
  const out = empty();
  const events = Array.isArray((file as { events?: unknown })?.events) ? (file as { events: Ev[] }).events : [];
  if (!events.length) return out;
  const t0 = num(events[0].timestamp) ?? 0;
  // when each page (re)loaded, by the page's own clock
  const loads: Array<{ t: number; at?: number }> = [];
  for (const e of events) {
    const t = (num(e.timestamp) ?? t0) - t0;
    if (e.type === 4) addPage(out.pages, t, str(e.data?.href));
    if (e.type !== 5 || e.data?.tag !== "brief") continue;
    const p = e.data.payload ?? {};
    const kind = str(p.kind);
    const at = num(p.at);
    if (kind === "nav") {
      addPage(out.pages, t, str(p.url), at);
      // an address change inside the app (a page load is the Meta's "open")
      if (p.load) loads.push({ t, at });
      else out.actions.push({ t, at, kind: "go to", what: shortUrl(str(p.url), 140) });
    } else if (kind === "network") out.network.push(callOf(t, p));
    else if (kind === "console-warn") out.console.push({ t, at, level: "warn", text: consoleText(kind, p) });
    else if (kind === "console-error" || kind === "js-error" || kind === "promise-rejection") {
      out.console.push({ t, at, level: "error", text: consoleText(kind, p) });
    }
  }
  try {
    for (const a of replayActions(file as ReplayFile)) {
      const page = a.kind === "open" || a.kind === "reload";
      const load = page ? loads.find((l) => Math.abs(l.t - a.t) < 1000) : undefined;
      out.actions.push({ t: a.t, at: load?.at, kind: a.kind, what: page ? shortUrl(a.what, 140) : a.what });
    }
  } catch { /* a replay we can't read actions from still has its calls */ }
  out.actions.sort((a, b) => a.t - b.t);
  // a page loading at the address the user was already on is a reload (the
  // app may have moved there itself, so the last load isn't enough to tell)
  let here = "";
  for (const a of out.actions) {
    if (a.kind === "open" || a.kind === "reload") { a.kind = a.what === here ? "reload" : "open"; here = a.what; }
    else if (a.kind === "go to") here = a.what;
  }
  return fillClock(out);
}

/** From a recording (brief.json's capture events). */
export function techFromRecording(json: unknown): TechDetails {
  const out = empty();
  const events = Array.isArray((json as { events?: unknown })?.events) ? (json as { events: Ev[] }).events : [];
  // An extension that predates `network` events only reported failures.
  const hasAllCalls = events.some((e) => e?.type === "network");
  let lastLoad = "";
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
    } else if (type === "nav") {
      const url = shortUrl(str(e.url), 140);
      if (e.load) { out.actions.push({ t, at, kind: url === lastLoad ? "reload" : "open", what: url }); lastLoad = url; }
      else out.actions.push({ t, at, kind: "go to", what: url });
    } else if (type === "click") {
      const el = (e.element ?? {}) as Record<string, unknown>;
      const label = str(el.text).replace(/\s+/g, " ").trim();
      out.actions.push({ t, at, kind: "click", what: label ? `"${label.slice(0, 60)}"` : str(el.selector) || "an element" });
    } else if (type === "key" && /^(Enter|Escape|Tab)$/.test(str(e.key))) {
      out.actions.push({ t, at, kind: "key", what: str(e.key) });
    }
  }
  return fillClock(out);
}

export function isEmpty(td: TechDetails | null | undefined): boolean {
  return !td || (!td.network.length && !td.console.length && td.pages.length < 2 && !(td.actions ?? []).length);
}

const failed = (c: NetCall) => !c.status || c.status >= 400;
const slow = (c: NetCall) => (c.ms ?? 0) >= SLOW_MS;
/** Failed first, then the slowest, then the rest in time order. */
export function rankCalls(calls: NetCall[]): NetCall[] {
  const notable = calls.filter((c) => failed(c) || slow(c)).sort((a, b) => Number(failed(b)) - Number(failed(a)) || (b.ms ?? 0) - (a.ms ?? 0));
  return [...notable, ...calls.filter((c) => !failed(c) && !slow(c))];
}

// Analytics, telemetry and ad beacons: real calls, but never the bug. They are
// counted on one line instead of filling the timeline.
const NOISE = [
  /(^|\.)posthog\.com$/, /(^|\.)google-analytics\.com$/, /(^|\.)googletagmanager\.com$/, /(^|\.)doubleclick\.net$/,
  /(^|\.)dc\.services\.visualstudio\.com$/, /(^|\.)monitor\.azure\.com$/, /(^|\.)applicationinsights\.azure\.com$/,
  /(^|\.)segment\.(io|com)$/, /(^|\.)sentry\.io$/, /(^|\.)hotjar\.(com|io)$/, /(^|\.)clarity\.ms$/,
  /(^|\.)intercom\.io$/, /(^|\.)intercomcdn\.com$/, /(^|\.)mixpanel\.com$/, /(^|\.)amplitude\.com$/,
  /(^|\.)datadoghq\.(com|eu)$/, /(^|\.)newrelic\.com$/, /(^|\.)nr-data\.net$/, /(^|\.)fullstory\.com$/,
  /(^|\.)logrocket\.(com|io)$/, /(^|\.)heapanalytics\.com$/, /(^|\.)facebook\.(com|net)$/, /(^|\.)linkedin\.com$/,
];
function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}
export function isNoise(url: string): boolean {
  const h = hostOf(url);
  return !!h && NOISE.some((re) => re.test(h));
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
  const at = [...td.pages, ...td.network, ...td.console, ...(td.actions ?? [])].map((x) => x.at).find((x) => x != null);
  return at != null ? new Date(at).toISOString().slice(0, 10) : "";
}

// What a tracker accepts in one description is limited (Jira ~32k chars), and
// a ticket may carry two videos' logs: each video's section stays under this.
const SECTION_BUDGET = 14_000;
const KIND_W = 7;

/**
 * One video's logs, as Markdown (each tracker folds it under its own title).
 * Nothing is cut short except to stay within what the tracker accepts, and
 * then the timeline says so.
 */
export function renderTechDetails(td: TechDetails, { maxBody = 600, budget = SECTION_BUDGET } = {}): string {
  const actions = td.actions ?? [];
  const day = dayOf(td);
  const stamp = (x: { t: number; at?: number }) => (day ? `${clock(x.t)}  ${utc(x.at)}` : clock(x.t));
  const pad = " ".repeat(stamp({ t: 0 }).length);
  const calls = td.network.filter((c) => !isNoise(c.url));
  const noise = td.network.filter((c) => isNoise(c.url));
  const w = calls.length ? Math.min(64, Math.max(...calls.map((c) => shortUrl(c.url, 64).length))) : 0;
  const statusOf = (c: NetCall) => (c.status ? String(c.status) : "failed");
  const callRow = (when: string, c: NetCall, tail: string) =>
    `${when}  ${c.method.padEnd(KIND_W)} ${shortUrl(c.url, 64).padEnd(w)}  ${statusOf(c).padEnd(6)} ${tail}`.trimEnd();

  const parts: string[] = [];

  // the calls that matter, with everything known about them
  const notable = rankCalls(calls).filter((c) => failed(c) || slow(c));
  if (notable.length) {
    const lines: string[] = [];
    for (const c of notable) {
      const why = !c.status && c.reason ? `  ${c.reason}` : "";
      lines.push(callRow(stamp(c), c, `${dur(c.ms)}${why}`));
      if (c.trace) lines.push(`${pad}  trace     ${c.trace}`);
      if (c.request) lines.push(`${pad}  request   ${oneLine(c.request, maxBody)}`);
      if (c.response) lines.push(`${pad}  response  ${oneLine(c.response, maxBody)}`);
    }
    const nF = notable.filter(failed).length;
    const nS = notable.length - nF;
    parts.push(`**Failed and slow** (${[nF && `${nF} failed`, nS && `${nS} slow`].filter(Boolean).join(", ")})\n\n` + fence(lines));
  }

  // the timeline: what the user did, the calls it set off, what the console said
  type Row = { t: number; line: string };
  const rows: Row[] = [];
  for (const a of actions) rows.push({ t: a.t, line: `${stamp(a)}  ${a.kind.padEnd(KIND_W)} ${a.what}` });
  // the same call repeated (polling) is one line, at its first time, with a count
  const groups = new Map<string, { first: NetCall; last: NetCall; n: number; min: number; max: number }>();
  const order: string[] = [];
  for (const c of [...calls].sort((a, b) => a.t - b.t)) {
    const key = failed(c) || slow(c) ? `solo:${order.length}` : `${c.method} ${c.url} ${c.status}`;
    const g = groups.get(key);
    if (g) { g.n++; g.last = c; g.min = Math.min(g.min, c.ms ?? g.min); g.max = Math.max(g.max, c.ms ?? g.max); }
    else { groups.set(key, { first: c, last: c, n: 1, min: c.ms ?? 0, max: c.ms ?? 0 }); order.push(key); }
  }
  for (const key of order) {
    const g = groups.get(key)!;
    if (g.n === 1) { rows.push({ t: g.first.t, line: callRow(stamp(g.first), g.first, dur(g.first.ms)) }); continue; }
    const range = g.min === g.max ? dur(g.min) : `${dur(g.min)} to ${dur(g.max)}`;
    rows.push({ t: g.first.t, line: callRow(stamp(g.first), g.first, `${range}  x${g.n} until ${clock(g.last.t)}`) });
  }
  for (const c of td.console) rows.push({ t: c.t, line: `${stamp(c)}  ${c.level.padEnd(KIND_W)} ${oneLine(c.text, 300)}` });
  rows.sort((a, b) => a.t - b.t);

  if (rows.length || noise.length) {
    let room = budget - parts.join("\n\n").length - 800;
    const kept: string[] = [];
    for (const r of rows) {
      if (room - r.line.length - 1 < 0) break;
      kept.push(r.line); room -= r.line.length + 1;
    }
    if (kept.length < rows.length) kept.push(`… ${rows.length - kept.length} more lines (the tracker's size limit)`);
    if (noise.length) {
      const hosts = new Map<string, number>();
      for (const c of noise) hosts.set(hostOf(c.url), (hosts.get(hostOf(c.url)) ?? 0) + 1);
      const list = [...hosts].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} x${n}`).join(", ");
      kept.push(`+ ${noise.length} analytics/telemetry call${noise.length === 1 ? "" : "s"} not listed: ${list}`);
    }
    const counts = [
      actions.length && `${actions.length} action${actions.length === 1 ? "" : "s"}`,
      calls.length && `${calls.length} call${calls.length === 1 ? "" : "s"}`,
      td.console.length && `${td.console.length} console`,
    ].filter(Boolean).join(", ");
    parts.push(`**Timeline** (${counts || "network"}; in order)\n\n` + fence(kept));
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
  const notable = rankCalls(td.network.filter((c) => !isNoise(c.url))).filter((c) => failed(c) || slow(c)).slice(0, 12);
  if (notable.length) {
    lines.push("Failed or slow network calls:");
    for (const c of notable) {
      lines.push(`- ${clock(c.t)} ${c.method} ${shortUrl(c.url, 140)} -> ${c.status || "failed"} in ${dur(c.ms) || "?"}${c.reason ? ` (${c.reason})` : ""}`);
      // what was sent and what the server said are often the root cause
      if (c.request) lines.push(`  request: ${oneLine(c.request, 300)}`);
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

// ---------- one log set per video ----------
// A brief can carry a screen recording AND a replay: each has its own clock,
// so each keeps its own logs, in its own folded section titled after it.
export type VideoLogs = { label: string; td: TechDetails };

export function videoLogSections(list: VideoLogs[]): Array<{ title: string; markdown: string }> {
  return list
    .filter((v) => !isEmpty(v.td))
    .map((v) => ({ title: `Technical logs: ${v.label}`, markdown: renderTechDetails(v.td) }))
    .filter((s) => s.markdown);
}

export function videoLogsForAgent(list: VideoLogs[]): string {
  const kept = list.filter((v) => !isEmpty(v.td));
  if (kept.length === 1) return techForAgent(kept[0].td);
  return kept.map((v) => `[${v.label} - times are into this video]\n${techForAgent(v.td)}`).join("\n\n");
}
