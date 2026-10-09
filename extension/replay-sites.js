// Brief - which sites keep a replay buffer (POC)
//
// The list is set per org on the web app's Settings page; syncReplaySites pulls
// it into chrome.storage.local, where the worker and pages read it. Host
// patterns, http(s) only:
//   app.thunders.ai   that host (any port)
//   localhost:3000    that host on that port
//   *.thunders.ai     thunders.ai and every subdomain
// Only pages matching a pattern get the rrweb recorder injected; everywhere
// else nothing runs.

import { APP_URL, getCloudToken } from './cloud.js';

const KEY = 'replaySites';
const SYNC_KEY = 'replaySitesSyncedAt';

function parse(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

export function originOf(url) {
  return parse(url)?.origin || null;
}

// What the user typed -> a stored pattern, or null when it isn't one.
// Accepts a pasted URL too ("https://app.thunders.ai/x" -> "app.thunders.ai").
export function normalizePattern(input) {
  let p = String(input || '').trim().toLowerCase();
  p = p.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '');
  const wild = p.startsWith('*.');
  const host = wild ? p.slice(2) : p;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(host)) return null;
  if (wild && !host.includes('.')) return null; // "*.com" is not a site
  return wild ? `*.${host}` : host;
}

export function patternMatches(pattern, url) {
  const u = parse(url);
  if (!u) return false;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return u.hostname === base || u.hostname.endsWith(`.${base}`);
  }
  return pattern.includes(':') ? u.host === pattern : u.hostname === pattern;
}

// Earlier POC builds stored origins ("http://localhost:3999").
function migrate(list) {
  return [...new Set(list.map((s) => normalizePattern(s)).filter(Boolean))];
}

export async function getReplaySites() {
  const { [KEY]: sites } = await chrome.storage.local.get(KEY);
  return Array.isArray(sites) ? migrate(sites) : [];
}

export async function setReplaySites(sites) {
  await chrome.storage.local.set({ [KEY]: migrate(sites) });
}

// The pattern that puts this page under watch, or null. An exact host wins over
// a wildcard, so the popup names the most specific rule.
export async function matchingPattern(url) {
  const sites = await getReplaySites();
  return sites.find((p) => !p.startsWith('*.') && patternMatches(p, url))
    || sites.find((p) => patternMatches(p, url))
    || null;
}

export async function isWatched(url) {
  return !!(await matchingPattern(url));
}

export async function addPattern(pattern) {
  const p = normalizePattern(pattern);
  if (!p) return null;
  const sites = await getReplaySites();
  if (!sites.includes(p)) await setReplaySites([...sites, p]);
  return p;
}

export async function removePattern(pattern) {
  await setReplaySites((await getReplaySites()).filter((p) => p !== pattern));
}

// Pull the org's list. Unpaired or a dead pairing: an empty list (record
// nothing). A network failure keeps the last known list.
export async function syncReplaySites() {
  const token = await getCloudToken().catch(() => null);
  let sites = [];
  if (token) {
    try {
      const res = await fetch(`${APP_URL}/api/replay-sites`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) sites = (await res.json()).sites || [];
      else if (res.status !== 401) return getReplaySites();
    } catch {
      return getReplaySites();
    }
  }
  const next = migrate(sites);
  const prev = await getReplaySites();
  await chrome.storage.local.set({ [SYNC_KEY]: Date.now() });
  if (JSON.stringify(prev) !== JSON.stringify(next)) await setReplaySites(next);
  return next;
}

export async function syncReplaySitesIfStale(maxAgeMs) {
  const { [SYNC_KEY]: at = 0 } = await chrome.storage.local.get(SYNC_KEY);
  if (Date.now() - at > maxAgeMs) await syncReplaySites();
}

// The pattern the popup's toggle adds for a page: its host, with the port only
// when it isn't the default one.
export function hostPattern(url) {
  const u = parse(url);
  return u ? normalizePattern(u.host) : null;
}

// Start the buffer in a tab's top frame. Safe to call twice: replay.js restarts
// the existing recorder instead of adding a second one.
export async function armReplay(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['vendor/rrweb-record.min.js', 'replay.js'],
  });
}

export function pingReplay(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'REPLAY_PING' }, { frameId: 0 })
    .then((r) => !!r?.ok)
    .catch(() => false);
}

export function stopReplay(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'REPLAY_STOP' }, { frameId: 0 }).catch(() => {});
}
