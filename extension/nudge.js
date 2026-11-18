// Brief - the reminder, only when the owner sends it
//
// The owner sends it from /admin/card ("show it now", to everyone or to the
// people picked). The extension pulls the newest one meant for it (GET
// /api/nudge, syncNudge) and opens a small popup under its toolbar icon
// (reminder.html) on the next page load: "Seen a bug?" or the owner's text,
// Brief it, ×. Once per push, on any web page, never on Brief's own site or
// app, never while recording. There is no automatic reminder. The worker
// decides on each page load (claimNudge) and opens it (background.js
// maybeNudge). The state stays in chrome.storage.local under `nudge`:
//   pushSeen     the owner's last push this browser opened
//   prevPushSeen the one before, put back if Chrome refuses to open it
//   tries        { day, n }: refused opens today
// What people do with it is logged (cardEvent): it opened, Brief it, closed,
// with the push's id. Nothing about the page but whether it is a Replay site.
// See docs/superpowers/specs/2026-11-07-nudge-admin-control-design.md.

import { patternMatches } from './replay-sites.js';
import { APP_URL, getCloudToken } from './cloud.js';

const DAY = 86_400_000;
/** How many refused opens a day before waiting for tomorrow. */
export const TRIES_PER_DAY = 3;

const dayOf = (t) => Math.floor(t / DAY);

const KEY = 'nudge';

/**
 * Whether this page can carry the reminder: any web page, or one of `sites`
 * when given. Never Brief's own site or app.
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
// open it.
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

/**
 * A page loaded in front: true when the owner's newest push (`push`) should
 * open now, and it is then counted as opened (missedNudge takes that back if
 * Chrome refuses).
 */
export async function claimNudge({ url, paired, recording, appUrl, push = null, now = Date.now() }) {
  let show = false;
  await update((n) => {
    if (!paired || recording || !push?.id || push.id === n.pushSeen) return n;
    if (!nudgePageOk(url, { appUrl })) return n;
    if (n.tries?.day === dayOf(now) && n.tries.n >= TRIES_PER_DAY) return n;
    show = true;
    return { ...n, pushSeen: push.id, prevPushSeen: n.pushSeen ?? null };
  });
  return show;
}

/** Chrome refused to open it: tried again on a later page load, a few times a day at most. */
export function missedNudge(now = Date.now()) {
  return update((n) => {
    const { prevPushSeen, pushSeen, tries, ...rest } = n;
    const today = tries?.day === dayOf(now) ? tries.n : 0;
    const seen = prevPushSeen !== undefined ? prevPushSeen : pushSeen;
    return { ...rest, ...(seen ? { pushSeen: seen } : {}), tries: { day: dayOf(now), n: today + 1 } };
  });
}

/** The only names the extension logs, all about the reminder. */
export const CARD_EVENTS = ['nudge.shown', 'nudge.brief_it', 'nudge.closed'];

/**
 * Tell Brief what happened to the reminder: it opened (`replay`: over a
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
