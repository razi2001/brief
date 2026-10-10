// Brief - stitch the browser-wide replay (POC). Pure functions, no chrome.*.
//
// buildTimeline: one rrweb event stream that follows the user across tabs.
//   focus  [{t, tabId}]  which tab was in front, from the worker's log
//   tabs   Map tabId -> {events, pages}  everything replay-store kept
// For each stretch the user spent on a tab, that tab's events are replayed from
// its latest full snapshot; events between that snapshot and the switch are
// pulled up to the switch instant so the page is in the right state when the
// stretch starts. A stretch on a tab with nothing recorded (unwatched site)
// stays a gap: the player holds the last frame and the label says so.
//
// skipIdle: squeeze long quiet stretches (no recorded activity, including gaps)
// down to `keepMs`, returning a time map so labels follow.

const META = 4;
const FULL = 2;
const CUSTOM = 5; // rrweb custom events: the page capture's network/console log

export function focusIntervals(focus, start, end) {
  const log = [...focus].sort((a, b) => a.t - b.t);
  const out = [];
  let current = null;
  for (const e of log) {
    if (e.t <= start) { current = e.tabId; continue; }
    if (e.t >= end) break;
    out.push({ tabId: current, a: out.length ? out[out.length - 1].b : start, b: e.t });
    current = e.tabId;
  }
  out.push({ tabId: current, a: out.length ? out[out.length - 1].b : start, b: end });
  // first stretch may have started before the log did: drop unknown leading tabs
  return out.filter((s) => s.b > s.a).reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && last.tabId === s.tabId) last.b = s.b; else acc.push({ ...s });
    return acc;
  }, []);
}

function pageAt(pages, t) {
  let hit = pages[0];
  for (const p of pages) if (p.t0 <= t) hit = p;
  return hit;
}

export function buildTimeline({ focus, tabs, start, end }) {
  const events = [];
  const segments = [];
  for (const s of focusIntervals(focus, start, end)) {
    const tab = s.tabId != null ? tabs.get(s.tabId) : null;
    const ev = tab?.events || [];
    // latest Meta (followed by its full snapshot) at or before the stretch start,
    // else the first one inside the stretch
    let m = -1;
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].type === META && ev[i + 1]?.type === FULL) {
        if (ev[i].timestamp <= s.a) m = i;
        else if (m < 0 && ev[i].timestamp < s.b) { m = i; break; } else break;
      }
    }
    // `loading`: a watched tab between pages (nothing to draw yet), as opposed
    // to a tab that was never recorded at all
    const loading = ev.length > 0;
    if (m < 0) { segments.push({ a: s.a, b: s.b, tabId: s.tabId, recorded: false, loading }); continue; }
    const a = Math.max(s.a, ev[m].timestamp);
    if (a > s.a) segments.push({ a: s.a, b: a, tabId: s.tabId, recorded: false, loading });
    // Later snapshots of the SAME page (the recorder's 30s checkouts, a tab
    // coming back into view) are skipped: node ids are stable across them, so
    // they add nothing - but replaying one rebuilds the whole page, a visible
    // flash. A new page (navigation) keeps its snapshot.
    let pageLoad = ev[m].__page;
    let skipFull = false;
    for (let i = m; i < ev.length && ev[i].timestamp < s.b; i++) {
      const e = ev[i];
      if (i > m && e.type === META) {
        if (pageLoad != null && e.__page === pageLoad) { skipFull = true; continue; }
        pageLoad = e.__page;
      }
      if (e.type === FULL && skipFull) { skipFull = false; continue; }
      // the page's own log (network, console) from before this stretch isn't
      // part of it: pulled up to its start it would all read "0:00"
      if (e.type === CUSTOM && e.timestamp < a) continue;
      const { __page, ...clean } = e;
      events.push(clean.timestamp < a ? { ...clean, timestamp: a } : clean);
    }
    const page = pageAt(tab.pages, a);
    segments.push({ a, b: s.b, tabId: s.tabId, recorded: true, url: page?.url, title: page?.title });
  }
  return { events, segments };
}

// Gentle on purpose: short pauses (reading, a page settling) play in real time;
// only dead stretches over 5s shrink, and keep 1.5s so the jump reads as a cut,
// not a stutter.
export function skipIdle(events, segments, { maxGapMs = 5000, keepMs = 1500, end } = {}) {
  // activity = recorded events; the stretch end counts too so a trailing gap
  // (e.g. sitting on an unwatched tab) is squeezed as well
  // custom events (network calls, console) aren't activity: an app that polls
  // every few seconds would otherwise never have dead time to cut
  const marks = events.filter((e) => e.type !== 5).map((e) => e.timestamp);
  if (end != null) marks.push(end);
  const cuts = []; // [t, cumulative shift applied to anything at or after t]
  let shift = 0;
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - marks[i - 1];
    if (gap > maxGapMs) { shift += gap - keepMs; cuts.push([marks[i], shift]); }
  }
  const map = (t) => {
    let s = 0;
    for (const [ct, cs] of cuts) { if (t >= ct) s = cs; else break; }
    // inside a squeezed gap: clamp to the kept slice
    return t - s;
  };
  const clamp = (t) => {
    // a time inside a cut gap maps to the gap's start + keepMs at most
    for (let i = 0; i < cuts.length; i++) {
      const [ct, cs] = cuts[i];
      const prev = i ? cuts[i - 1][1] : 0;
      const gapStart = ct - (cs - prev) - keepMs;
      if (t > gapStart + keepMs && t < ct) return gapStart + keepMs - prev;
    }
    return map(t);
  };
  return {
    events: events.map((e) => ({ ...e, timestamp: map(e.timestamp) })),
    segments: segments.map((s) => ({ ...s, a: clamp(s.a), b: clamp(s.b) })),
    savedMs: shift,
  };
}

// Trim a stitched stream to [a, b]. The cut has to open on a full snapshot, so
// the page is rebuilt from the latest one at or before `a` and everything
// between it and `a` is pulled up to `a`.
export function sliceTimeline(events, segments, a, b) {
  let m = -1;
  for (let i = 0; i < events.length && events[i].timestamp <= a; i++) {
    if (events[i].type === META && events[i + 1]?.type === FULL) m = i;
  }
  if (m < 0) m = events.findIndex((e, i) => e.type === META && events[i + 1]?.type === FULL);
  const out = [];
  for (let i = Math.max(m, 0); i < events.length && events[i].timestamp <= b; i++) {
    if (events[i].type === CUSTOM && events[i].timestamp < a) continue; // see buildTimeline
    out.push(events[i].timestamp < a ? { ...events[i], timestamp: a } : events[i]);
  }
  return {
    events: out,
    segments: segments.filter((s) => s.b > a && s.a < b).map((s) => ({ ...s, a: Math.max(s.a, a), b: Math.min(s.b, b) })),
  };
}


// Keep several pieces ([{a, b}] absolute) and play them back to back. Every
// piece reopens on a full snapshot (sliceTimeline), so the page is right at
// each join.
export function cutTimeline(events, segments, pieces) {
  const out = { events: [], segments: [] };
  let cursor = pieces[0]?.a ?? 0;
  for (const r of pieces) {
    const piece = sliceTimeline(events, segments, r.a, r.b);
    const shift = cursor - r.a;
    for (const e of piece.events) out.events.push({ ...e, timestamp: e.timestamp + shift });
    for (const s of piece.segments) out.segments.push({ ...s, a: s.a + shift, b: s.b + shift });
    cursor += r.b - r.a;
  }
  return out;
}
