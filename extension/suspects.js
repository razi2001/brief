// Brief - what probably went wrong in a replay (one-click reports, POC).
//
// Reads the replay's own record - rrweb events plus the 'brief' custom events
// the page capture adds (network, console, errors, navigation) - and ranks the
// moments that look like the bug, each with a timestamp on the replay's clock
// and a short note. Plain code, no model: the agent gets these as SUSPECTS to
// check against the stills and the logs, never as facts.
//
//   detectSuspects(events, t0) -> [{ t, note, kind, score }]   (t = ms after t0)

// rrweb: incremental snapshot (3) with a mouse click (source 2, type 2), a DOM
// mutation (source 0); custom events (5) tagged 'brief' carry the page logs.
const INCREMENTAL = 3;
const CUSTOM = 5;
const SRC_MUTATION = 0;
const SRC_MOUSE = 2;
const MOUSE_CLICK = 2;

// Third parties failing is noise, not the bug.
const NOISE = /google-analytics|googletagmanager|doubleclick|segment\.(io|com)|sentry\.io|hotjar|intercom|mixpanel|amplitude|posthog|datadoghq|newrelic|fullstory|clarity\.ms|facebook\.net|stripe\.network|\/beacon|\/collect\b|\/telemetry|\/analytics/i;
// Words a page shows when something broke.
const ERROR_TEXT = /something went wrong|went wrong|an error occurred|unexpected error|failed to|could ?n[o']t|unable to|try again|not found|access denied|forbidden|timed out|server error|oops/i;

const path = (url) => {
  try { const u = new URL(url); return u.pathname + (u.search ? '?…' : ''); } catch { return String(url || '').slice(0, 80); }
};
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const firstText = (args) => {
  for (const a of args || []) {
    if (typeof a === 'string' && a.trim()) return a;
    if (a && typeof a === 'object' && typeof a.message === 'string') return a.message;
  }
  return '';
};

/** Text a mutation added to the page (text nodes and their element wrappers). */
function addedText(data) {
  const out = [];
  for (const add of data?.adds || []) {
    const n = add?.node;
    if (!n) continue;
    if (n.type === 3 && n.textContent) out.push(n.textContent);
    for (const c of n.childNodes || []) if (c?.type === 3 && c.textContent) out.push(c.textContent);
  }
  for (const t of data?.texts || []) if (t?.value) out.push(t.value);
  return out.join(' ');
}

export function detectSuspects(events, t0 = events?.[0]?.timestamp ?? 0) {
  const found = [];
  const add = (ts, kind, score, note) => found.push({ t: Math.max(0, ts - t0), kind, score, note });

  const clicks = [];
  const mutations = [];
  const requests = [];
  let loads = 0;

  for (const e of events || []) {
    if (e.type === INCREMENTAL && e.data?.source === SRC_MOUSE && e.data?.type === MOUSE_CLICK) {
      clicks.push({ ts: e.timestamp, x: e.data.x ?? 0, y: e.data.y ?? 0 });
    } else if (e.type === INCREMENTAL && e.data?.source === SRC_MUTATION) {
      mutations.push(e.timestamp);
      const text = addedText(e.data);
      const m = text && ERROR_TEXT.exec(text);
      if (m) {
        // the sentence around the match, not the whole page
        const i = text.toLowerCase().indexOf(m[0].toLowerCase());
        const around = text.slice(Math.max(0, i - 40), i + m[0].length + 60);
        add(e.timestamp, 'error-text', 6, `The page showed "${clip(around, 90)}"`);
      }
    } else if (e.type === CUSTOM && e.data?.tag === 'brief') {
      const p = e.data.payload || {};
      requests.push(e.timestamp);
      if (p.kind === 'network') {
        if (NOISE.test(p.url || '')) continue;
        const failed = !p.status || p.status >= 400;
        if (failed) {
          const score = p.status >= 500 ? 10 : p.status === 0 ? 6 : 7;
          add(e.timestamp, 'request-failed', score, `${p.method || 'GET'} ${path(p.url)} failed (${p.status || 'no response'}${p.reason ? `, ${clip(p.reason, 40)}` : ''})`);
        } else if (p.ms >= 3000) {
          add(e.timestamp, 'request-slow', 5, `${p.method || 'GET'} ${path(p.url)} took ${(p.ms / 1000).toFixed(1)}s`);
        }
      } else if (p.kind === 'js-error') {
        add(e.timestamp, 'js-error', 9, `JavaScript error: ${clip(p.message, 100)}`);
      } else if (p.kind === 'promise-rejection') {
        add(e.timestamp, 'js-error', 8, `Unhandled promise rejection: ${clip(typeof p.reason === 'string' ? p.reason : p.reason?.message || JSON.stringify(p.reason ?? ''), 100)}`);
      } else if (p.kind === 'console-error') {
        const msg = firstText(p.args);
        if (msg && !NOISE.test(msg)) add(e.timestamp, 'console-error', 5, `Console error: ${clip(msg, 100)}`);
      } else if (p.kind === 'nav' && p.load) {
        loads++;
        // the first load is just the page opening; more mean someone reloaded
        if (loads > 1) add(e.timestamp, 'reload', loads > 2 ? 5 : 3, loads > 2 ? 'Reloaded the page again' : 'Reloaded the page');
      }
    }
  }

  // Rage clicks: three or more clicks in the same spot within 1.5s.
  for (let i = 0; i < clicks.length; i++) {
    const burst = [clicks[i]];
    for (let j = i + 1; j < clicks.length && clicks[j].ts - clicks[i].ts <= 1500; j++) {
      if (Math.hypot(clicks[j].x - clicks[i].x, clicks[j].y - clicks[i].y) <= 40) burst.push(clicks[j]);
    }
    if (burst.length >= 3) {
      add(burst[burst.length - 1].ts, 'rage-click', 8, `Clicked the same spot ${burst.length} times`);
      i += burst.length - 1;
    }
  }

  // Dead clicks: nothing changed on the page and no request went out within 1s.
  for (const c of clicks) {
    const after = (list) => list.some((ts) => ts > c.ts && ts - c.ts <= 1000);
    if (!after(mutations) && !after(requests)) add(c.ts, 'dead-click', 4, 'Clicked, and nothing happened');
  }

  // One suspect per moment (the strongest), then the strongest few, in order.
  found.sort((a, b) => b.score - a.score || a.t - b.t);
  const kept = [];
  for (const s of found) {
    if (kept.some((k) => Math.abs(k.t - s.t) < 1500)) continue;
    kept.push(s);
    if (kept.length >= 4) break;
  }
  return kept.sort((a, b) => a.t - b.t);
}
