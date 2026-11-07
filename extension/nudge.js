// Brief - the reminder for a user who stopped using Brief
//
// A paired browser whose user has made nothing for a week gets the extension's
// own popup, opened under its toolbar icon on a page they use, with a line on
// top ("Seen a bug?", or the owner's text from /admin/card). At most once a
// week, plus once for each "show it now" the owner sends (GET /api/nudge,
// syncNudge). The worker decides, on each page load (claimNudge) and opens it
// (background.js maybeNudge). The state stays in chrome.storage.local under
// `nudge`:
//   usedAt       the user's last brief (here, or as the server knows it from
//                `lastBriefAt`), a capture started here, or the pairing
//   shownAt      last time the reminder opened
//   prevShownAt  the one before, put back if Chrome refuses to open it
//   pushSeen     the owner's last push this browser opened
//   prevPushSeen the one before, put back if Chrome refuses to open it
//   tries        { day, n }: refused opens today
// What people do with it is logged (cardEvent): it opened, a capture started
// from it, it closed with none, with the push's id when the owner sent it.
// Nothing about the page but whether it is a Replay site. See
// docs/superpowers/specs/2026-10-30-inactivity-nudge-design.md and
// 2026-11-07-nudge-admin-control-design.md.

import { patternMatches } from './replay-sites.js';
import { APP_URL, getCloudToken } from './cloud.js';

const DAY = 86_400_000;
/** How long without a brief before the card shows. */
export const QUIET_MS = 7 * DAY;
/** And how long between two reminders. */
export const EVERY_MS = 7 * DAY;
/** How many refused opens a day before waiting for tomorrow. */
export const TRIES_PER_DAY = 3;

const dayOf = (t) => Math.floor(t / DAY);

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

/**
 * A page loaded in front: 'push' or 'weekly' when the reminder should open
 * now (and it is then counted as shown; missedNudge takes that back if Chrome
 * refuses), else false. `lastBriefAt` (from the server) moves `usedAt` forward
 * when the user made a brief elsewhere, and gives a browser paired before this
 * version its start. `push`: the owner's newest "show it now", opened once,
 * whatever the week says.
 */
export async function claimNudge({ url, paired, recording, sites, appUrl, lastBriefAt, push = null, now = Date.now() }) {
  let why = false;
  await update((n) => {
    if (!paired) return n;
    const usedAt = Math.max(n.usedAt || 0, lastBriefAt || 0);
    const known = usedAt && usedAt !== n.usedAt ? { ...n, usedAt } : n;
    if (recording || !nudgePageOk(url, { sites, appUrl })) return known;
    if (n.tries?.day === dayOf(now) && n.tries.n >= TRIES_PER_DAY) return known;
    const { prevShownAt, prevPushSeen, ...rest } = known;
    const shown = { ...rest, shownAt: now, ...(n.shownAt ? { prevShownAt: n.shownAt } : {}) };
    if (push?.id && push.id !== n.pushSeen) {
      why = 'push';
      return { ...shown, pushSeen: push.id, prevPushSeen: n.pushSeen ?? null };
    }
    if (!usedAt || !nudgeDue({ now, paired, recording, ...known })) return known;
    why = 'weekly';
    return shown;
  });
  return why;
}

/** Chrome refused to open it: not shown after all, and one try fewer today. */
export function missedNudge(now = Date.now()) {
  return update((n) => {
    const { shownAt, prevShownAt, prevPushSeen, pushSeen, tries, ...rest } = n;
    const today = tries?.day === dayOf(now) ? tries.n : 0;
    // a refused push: try it again on a later page load
    const seen = prevPushSeen !== undefined ? prevPushSeen : pushSeen;
    return {
      ...rest,
      ...(prevShownAt ? { shownAt: prevShownAt } : {}),
      ...(seen ? { pushSeen: seen } : {}),
      tries: { day: dayOf(now), n: today + 1 },
    };
  });
}

/** The only names the extension logs, all about the reminder. */
export const CARD_EVENTS = ['nudge.shown', 'nudge.brief_it', 'nudge.closed'];

/**
 * Tell Brief Cloud what happened to the reminder: it opened (`replay`: over a
 * Replay site or not), a capture started from it, or it closed with none.
 * `push`: the id of the owner's push that opened it, so /admin/card can say
 * what each person did with it. Fire and forget, with the pairing token.
 */
export async function cardEvent(name, props = {}) {
  if (!CARD_EVENTS.includes(name)) return;
  try {
    const token = await getCloudToken();
    if (!token) return;
    await fetch(`${APP_URL}/api/extension-events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        props: {
          ...(name === 'nudge.shown' ? { replay: !!props.replay } : {}),
          ...(typeof props.push === 'string' && props.push ? { push: props.push } : {}),
        },
      }),
      keepalive: true,
    });
  } catch {}
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
