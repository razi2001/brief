// Brief - "Seen a bug?", the card for a browser that stopped using Brief
//
// A paired browser that has made nothing for a week gets a small card on a page
// it uses: Brief it, or close it. At most once a week, plus once for each "show
// it now" from the owner. The worker decides, on each page load (claimNudge);
// content.js only draws the card. The text and the pushes come from GET
// /api/nudge (syncNudge); nothing about this browser is sent. The state stays
// in chrome.storage.local under `nudge`:
//   usedAt   last capture or filing here, or the pairing (the week starts over)
//   shownAt  last time the card showed or was closed
//   pushSeen the owner's last "show it now" this browser already showed
// See docs/superpowers/specs/2026-10-30-inactivity-nudge-design.md and
// 2026-11-07-nudge-admin-control-design.md.

import { patternMatches } from './replay-sites.js';
import { APP_URL, getCloudToken } from './cloud.js';

const DAY = 86_400_000;
/** How long without a brief before the card shows. */
export const QUIET_MS = 7 * DAY;
/** And how long between two cards. */
export const EVERY_MS = 7 * DAY;

const KEY = 'nudge';

/** Whether the card is due, from what this browser remembers. */
export function nudgeDue({ now, paired, recording, usedAt, shownAt }) {
  if (!paired || recording || !usedAt) return false;
  if (now - usedAt < QUIET_MS) return false;
  return !shownAt || now - shownAt >= EVERY_MS;
}

/**
 * Whether this page can carry the card: one of the Replay sites when there are
 * any, else any web page. Never Brief's own site or app.
 */
export function nudgePageOk(url, { sites = [], appUrl = '' } = {}) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.hostname === 'get-brief.app' || u.hostname.endsWith('.get-brief.app')) return false;
  try { if (appUrl && u.host === new URL(appUrl).host) return false; } catch {}
  return sites.length ? sites.some((p) => patternMatches(p, url)) : true;
}

// One read-modify-write at a time: two tabs loading together must not both
// get the card.
let chain = Promise.resolve();
function update(fn) {
  const run = chain.then(async () => {
    const { [KEY]: n } = await chrome.storage.local.get(KEY);
    const before = n && typeof n === 'object' ? n : {};
    const after = fn(before);
    if (after !== before) await chrome.storage.local.set({ [KEY]: after });
    return after;
  });
  chain = run.catch(() => {});
  return run;
}

/** Something was made here, or the browser was just paired: the week starts over. */
export function markUsed(now = Date.now()) {
  return update((n) => ({ ...n, usedAt: now }));
}

/** The card was closed: the week between two cards starts now. */
export function markClosed(now = Date.now()) {
  return update((n) => ({ ...n, shownAt: now }));
}

/**
 * A page loaded in front: true when it gets the card now, and the card is
 * then counted as shown. A browser paired before this version has no
 * `usedAt` yet: its week starts here. `push`: the owner's "show it now"
 * (GET /api/nudge), shown once, whatever the week says.
 */
export async function claimNudge({ url, paired, recording, sites, appUrl, push = null, now = Date.now() }) {
  let show = false;
  await update((n) => {
    const next = paired && !n.usedAt ? { ...n, usedAt: now } : n;
    if (!nudgePageOk(url, { sites, appUrl })) return next;
    if (paired && !recording && push?.id && push.id !== n.pushSeen) {
      show = true;
      return { ...next, shownAt: now, pushSeen: push.id };
    }
    if (next !== n || !nudgeDue({ now, paired, recording, ...n })) return next;
    show = true;
    return { ...n, shownAt: now };
  });
  return show;
}

// ---------- What the owner set (GET /api/nudge) ----------
// The card's text and the newest "show it now". Pulled like the Replay sites:
// at most every few minutes, on a page load. Unpaired or a dead pairing: none.
// A network failure keeps the last answer.

const CFG_KEY = 'nudgeCfg';
const CFG_SYNC_KEY = 'nudgeCfgSyncedAt';

/** `{ message, button, push }`, or null before the first answer. */
export async function getNudgeCfg() {
  const { [CFG_KEY]: c } = await chrome.storage.local.get(CFG_KEY);
  return c && typeof c === 'object' ? c : null;
}

function cleanCfg(c) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const push = c?.push && typeof c.push.id === 'string' ? { id: c.push.id, at: String(c.push.at || '') } : null;
  return { message: str(c?.message, 80), button: str(c?.button, 24), push };
}

export async function syncNudge() {
  const token = await getCloudToken().catch(() => null);
  let cfg = null;
  if (token) {
    try {
      const res = await fetch(`${APP_URL}/api/nudge`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) cfg = cleanCfg(await res.json());
      else if (res.status !== 401) return getNudgeCfg();
    } catch {
      return getNudgeCfg();
    }
  }
  await chrome.storage.local.set({ [CFG_KEY]: cfg, [CFG_SYNC_KEY]: Date.now() });
  return cfg;
}

export async function syncNudgeIfStale(maxAgeMs) {
  const { [CFG_SYNC_KEY]: at = 0 } = await chrome.storage.local.get(CFG_SYNC_KEY);
  return Date.now() - at > maxAgeMs ? syncNudge() : getNudgeCfg();
}
