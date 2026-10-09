// Brief - the browser-wide replay buffer (POC)
//
// rrweb chunks streamed from every watched page (replay.js -> REPLAY_CHUNK),
// kept in IndexedDB so the buffer survives navigations and covers every
// watched tab at once. Two stores: small `meta` rows (so pruning never loads
// events) and the `events` arrays they point at.
//
// Rolling: a tab keeps everything from its last full snapshot at or before
// (now - RETAIN_MS), so a replay can always start any tab on a full snapshot.
// Everything is local and short-lived: pruned as chunks arrive, wiped at
// browser startup, and purged for sites taken off the watch list.

const DB = 'brief-replay';
const META = 'meta';
const EVENTS = 'events';
export const RETAIN_MS = 150_000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id', autoIncrement: true });
      req.result.createObjectStore(EVENTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction([META, EVENTS], mode);
    let out;
    Promise.resolve(fn(t.objectStore(META), t.objectStore(EVENTS))).then((v) => { out = v; });
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error || new Error('indexedDB tx failed')); };
    t.onabort = () => { db.close(); reject(t.error || new Error('indexedDB tx aborted')); };
  }));
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export function putChunk({ tabId, pageId, url, title, full, events }) {
  if (!events?.length) return Promise.resolve();
  const t0 = events[0].timestamp;
  const t1 = events[events.length - 1].timestamp;
  return tx('readwrite', (meta, ev) => {
    const add = meta.add({ tabId, pageId, url, title, full: !!full, t0, t1 });
    add.onsuccess = () => ev.put(events, add.result);
  });
}

export function allMeta() {
  return tx('readonly', (meta) => req(meta.getAll()));
}

export function deleteChunks(ids) {
  if (!ids.length) return Promise.resolve();
  return tx('readwrite', (meta, ev) => { for (const id of ids) { meta.delete(id); ev.delete(id); } });
}

export function clearAll() {
  return tx('readwrite', (meta, ev) => { meta.clear(); ev.clear(); });
}

// Which chunks rolling retention drops. Pure, so it is easy to test.
export function chunksToPrune(metas, now, retainMs = RETAIN_MS) {
  const cutoff = now - retainMs;
  const byTab = new Map();
  for (const m of metas) {
    if (!byTab.has(m.tabId)) byTab.set(m.tabId, []);
    byTab.get(m.tabId).push(m);
  }
  const drop = [];
  for (const list of byTab.values()) {
    list.sort((a, b) => a.t0 - b.t0 || a.id - b.id);
    // A tab silent for the whole retention window is gone or long idle; it gets
    // a fresh snapshot the moment it comes back into view.
    if (list[list.length - 1].t1 < cutoff) { drop.push(...list.map((m) => m.id)); continue; }
    let keepFrom = 0;
    list.forEach((m, i) => { if (m.full && m.t0 <= cutoff) keepFrom = i; });
    drop.push(...list.slice(0, keepFrom).map((m) => m.id));
  }
  return drop;
}

export async function prune(now = Date.now()) {
  await deleteChunks(chunksToPrune(await allMeta(), now));
}

// Every stored event, grouped by tab and in time order, plus the page each
// chunk came from (for labels).
export async function readAll() {
  const metas = (await allMeta()).sort((a, b) => a.t0 - b.t0 || a.id - b.id);
  const lists = await tx('readonly', (_meta, ev) => Promise.all(metas.map((m) => req(ev.get(m.id)))));
  const tabs = new Map();
  metas.forEach((m, i) => {
    if (!tabs.has(m.tabId)) tabs.set(m.tabId, { events: [], pages: [] });
    const t = tabs.get(m.tabId);
    // which page load each event came from: the stitcher keeps one snapshot per page
    for (const e of lists[i] || []) e.__page = m.pageId;
    t.events.push(...(lists[i] || []));
    t.pages.push({ t0: m.t0, t1: m.t1, url: m.url, title: m.title });
  });
  for (const t of tabs.values()) t.events.sort((a, b) => a.timestamp - b.timestamp);
  return tabs;
}

export async function hasSince(since) {
  return (await allMeta()).some((m) => m.t1 >= since);
}
