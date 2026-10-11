// Brief - where a replay went and which moments to show, shared by the replay
// editor (replay-view.js) and the one-click report (auto-report.js, offscreen).

const host = (url) => { try { return new URL(url).host; } catch { return url || ''; } };

// The log may start after the window does; guess the tab in front before its
// first entry from where the recorded activity was.
export function completeFocus(focus, tabs, start) {
  const log = [...focus].sort((a, b) => a.t - b.t);
  if (log.length && log[0].t <= start) return log;
  const until = log.length ? log[0].t : Infinity;
  let best = null;
  let bestN = 0;
  for (const [tabId, t] of tabs) {
    const n = t.events.filter((e) => e.timestamp >= start && e.timestamp < until).length;
    if (n > bestN) { best = tabId; bestN = n; }
  }
  if (best == null && log.length) best = log[0].tabId;
  return best == null ? log : [{ t: start, tabId: best }, ...log];
}

// Where the replay went, for the agent's steps (replay.json `chips`): same-site
// runs collapse; page loads and glances (< 1s) at other tabs are not stops.
export function stretches(segments) {
  const out = [];
  for (const s of segments) {
    if (!s.recorded && (s.loading || s.b - s.a < 1000)) { if (out.length) out[out.length - 1].b = s.b; continue; }
    const label = s.recorded ? host(s.url) : 'Unwatched tab';
    const last = out[out.length - 1];
    if (last && last.label === label && last.recorded === s.recorded) { last.b = s.b; continue; }
    out.push({ ...s, label });
  }
  while (out.length && !out[0].recorded) out.shift();
  while (out.length && !out[out.length - 1].recorded) out.pop();
  return out;
}

// The moments the agent should see (source ms from the start): every mark the
// reporter placed first, then - up to four in all - the first page as it
// opens, the last page it went to, just after the last click, and where the
// kept part ends. Chrome lets an extension screenshot twice a second, so
// every still costs half a second of the user's time.
export function keyMoments({ a, b }, segments, t0, clicks, marks = []) {
  const pages = stretches(segments)
    .filter((s) => s.recorded && s.a - t0 < b && s.b - t0 > a)
    .map((s) => ({ t: Math.max(a, s.a - t0) + 400, note: `Opened ${s.title || s.label}` }));
  const lastClick = clicks.filter((c) => c >= a && c < b).pop();
  const picks = [pages[0], pages.length > 1 ? pages[pages.length - 1] : null,
    lastClick != null ? { t: lastClick + 350, note: 'Just after the last click' } : null];
  const marked = marks.filter((m) => m.t >= a && m.t <= b).slice(0, 6)
    .map((m) => ({ t: m.t, note: m.auto ? `Brief noticed: ${m.note}` : m.note ? `Marked by the reporter: ${m.note}` : 'Marked by the reporter', marked: true }));
  const room = Math.max(0, 3 - marked.length);
  const out = [];
  for (const m of picks.filter(Boolean).sort((x, y) => x.t - y.t)) {
    if (out.length >= room) break;
    const clear = [...out, ...marked].every((o) => Math.abs(o.t - m.t) >= 1000);
    if (m.t < b - 900 && clear) out.push(m);
  }
  const all = [...marked, ...out].sort((x, y) => x.t - y.t);
  if (!marked.some((m) => b - m.t < 900)) all.push({ t: Math.max(a, b - 80), note: 'Where it ends' });
  return all;
}
