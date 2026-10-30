// Brief - "Seen a bug?", the card for a browser that stopped using Brief
//
// A paired browser that has made nothing for a week gets a small card on a page
// it uses: Brief it, or close it. At most once a week. The worker decides, on
// each page load (claimNudge); content.js only draws the card. Nothing is sent
// anywhere: the state stays in chrome.storage.local under `nudge`:
//   usedAt   last capture or filing here, or the pairing (the week starts over)
//   shownAt  last time the card showed or was closed
// See docs/superpowers/specs/2026-10-30-inactivity-nudge-design.md.

import { patternMatches } from './replay-sites.js';

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
 * `usedAt` yet: its week starts here.
 */
export async function claimNudge({ url, paired, recording, sites, appUrl, now = Date.now() }) {
  let show = false;
  await update((n) => {
    if (paired && !n.usedAt) return { ...n, usedAt: now };
    if (!nudgePageOk(url, { sites, appUrl }) || !nudgeDue({ now, paired, recording, ...n })) return n;
    show = true;
    return { ...n, shownAt: now };
  });
  return show;
}
