// Where a video went and what happened when, for the ticket writers. A screen
// recording often starts on one page and shows the bug on another, and the
// reporter talks through it: lining up the pages, the clicks, what they said
// and what failed on one clock is what tells the writer which moment (and so
// which page) the report is about. Pure: unit-tested in timeline.test.ts.

import { isNoise, type PageLine, type TechDetails } from "./tech-details";
import type { SaidLine } from "./transcribe";

export type Mark = { t: number; note?: string };

/** ms -> "M:SS" */
export const clockOf = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const shortUrl = (u: string, max = 140) => oneLine(u.replace(/^https?:\/\//, ""), max);

/** The page the video was on at `t`: the last one opened at or before it. */
export function pageAt(pages: PageLine[], t: number): PageLine | undefined {
  let here: PageLine | undefined;
  for (const p of pages) if (p.t <= t) here = p;
  return here ?? pages[0];
}

/** "Title (address)", or the address alone when the page's title isn't known. */
export function pageName(p: { url: string; title?: string }): string {
  return p.title?.trim() ? `${oneLine(p.title, 100)} (${p.url})` : p.url;
}

/**
 * The pages a video went through, in order, each with its title when known.
 * The brief's own page (where the capture started) lends its title to the
 * trail's pages at that address, and when the trail opens on it, it was there
 * from the start (the log only notices a page at its first event).
 */
export function pageTrail(td: TechDetails | undefined, start?: { url?: string; title?: string }): PageLine[] {
  const pages = (td?.pages ?? []).map((p) => ({ ...p }));
  if (start?.url && pages[0]?.url === start.url) pages[0].t = 0;
  if (start?.url && start.title) {
    for (const p of pages) if (!p.title && p.url === start.url) p.title = start.title;
  }
  return pages;
}

/** Distinct addresses in a trail (a page left and come back to counts once). */
export const distinctPages = (pages: PageLine[]) => new Set(pages.map((p) => p.url)).size;

const failed = (status: number) => !status || status >= 400;
const SLOW_MS = 1000;

/**
 * One line per moment of a screen recording, in order: each page it reached,
 * what the reporter did, what they said (when the narration is timed), the
 * calls that failed or were slow, console errors, and their marks. The "says"
 * lines are what make it useful: the moment the reporter reacts ("see, it's
 * still the old name") sits next to the page and the clicks it is about.
 */
export function recordingTimeline(
  td: TechDetails,
  opts: { said?: SaidLine[]; marks?: Mark[]; startTitle?: string; startUrl?: string } = {},
): string[] {
  // ties: a page first, then what was done on it, what came of it, what was said
  type Row = { t: number; order: number; line: string };
  const rows: Row[] = [];
  const pages = pageTrail(td, { url: opts.startUrl, title: opts.startTitle });
  pages.forEach((p, i) => rows.push({ t: p.t, order: 0, line: `${clockOf(p.t)} ${i ? "now on" : "on"} ${pageName(p)}` }));
  let actions = 0;
  for (const a of td.actions) {
    // a page opening is already its own line above
    if (a.kind === "open" || a.kind === "go to") continue;
    if (++actions > 60) break;
    const what = a.kind === "click" ? `clicked ${a.what}` : a.kind === "key" ? `pressed ${a.what}` : a.kind === "reload" ? "reloaded the page" : `${a.kind} ${a.what}`;
    rows.push({ t: a.t, order: 1, line: `${clockOf(a.t)} ${what}` });
  }
  const calls = td.network.filter((c) => !isNoise(c.url) && (failed(c.status) || (c.ms ?? 0) >= SLOW_MS)).slice(0, 15);
  for (const c of calls) {
    const how = failed(c.status) ? `${c.status || "failed"}${c.reason && !c.status ? ` (${oneLine(c.reason, 80)})` : ""}` : `${c.status}`;
    const ms = c.ms != null ? ` in ${c.ms >= 1000 ? `${(c.ms / 1000).toFixed(1)} s` : `${Math.round(c.ms)} ms`}` : "";
    rows.push({ t: c.t, order: 2, line: `${clockOf(c.t)} call ${c.method} ${shortUrl(c.url)} -> ${how}${ms}` });
  }
  for (const c of td.console.filter((x) => x.level === "error").slice(0, 10)) {
    rows.push({ t: c.t, order: 2, line: `${clockOf(c.t)} console error: ${oneLine(c.text, 200)}` });
  }
  for (const s of opts.said ?? []) {
    if (s.text.trim()) rows.push({ t: s.t, order: 3, line: `${clockOf(s.t)} says: "${oneLine(s.text, 400)}"` });
  }
  for (const m of opts.marks ?? []) {
    if (typeof m?.t !== "number") continue;
    const note = m.note?.trim() ? `: "${oneLine(m.note, 300)}"` : "";
    rows.push({ t: m.t, order: 4, line: `${clockOf(m.t)} MARKED by the reporter${note}` });
  }
  return rows.sort((a, b) => a.t - b.t || a.order - b.order).map((r) => r.line);
}
