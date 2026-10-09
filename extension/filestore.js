// Brief - blob store shared by every extension context.
//
// Two jobs, both because chrome.runtime messaging carries JSON only and
// chrome.storage is the wrong place for megabytes:
//
//   rec:<briefId>   the recording, so the popup can play it back, and so the
//                   offscreen document can upload a picked video file (the popup
//                   dies the moment it loses focus, so it can't upload itself)
//   shot:<shotId>   a screenshot's CLEAN capture, so the annotator can reopen it
//                   with the strokes editable instead of drawing over flattened
//                   marks
//   replay:<briefId> the replay attached as evidence (rrweb events + its edit,
//                   as JSON), uploaded as replay.json at filing time
//   replayVoice:<briefId> the replay's voice-over (audio), replay-voice.webm
//   replayFrames:<briefId> stills of the replay's key moments (JSON of data
//                   URLs), uploaded as replay-frames/*.jpg for the agent to see
//
// Every extension page (popup, offscreen, the framed annotator) and the service
// worker share one origin, so they all see the same store.

const DB = 'brief';
const STORE = 'files';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

function run(mode, op) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('indexedDB tx failed')); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('indexedDB tx aborted')); };
  }));
}

export const recKey = (briefId) => `rec:${briefId}`;
export const shotKey = (shotId) => `shot:${shotId}`;
export const replayKey = (briefId) => `replay:${briefId}`;
export const replayVoiceKey = (briefId) => `replayVoice:${briefId}`;
export const replayFramesKey = (briefId) => `replayFrames:${briefId}`;

export function putFile(key, blob) { return run('readwrite', (s) => s.put(blob, key)); }
export function getFile(key) { return run('readonly', (s) => s.get(key)).then((v) => v || null); }
// Is it there, without pulling megabytes into memory to find out?
export function hasFile(key) { return run('readonly', (s) => s.getKey(key)).then((k) => k !== undefined); }
export function deleteFile(key) { return run('readwrite', (s) => s.delete(key)); }
export function listKeys() { return run('readonly', (s) => s.getAllKeys()).then((k) => k || []); }

// Drop every blob this store holds except the ones still referenced. A brief
// that was filed, reset, or interrupted by a crash leaves its video and
// screenshots behind; without this the store would grow forever.
export async function pruneFiles(keep) {
  const wanted = new Set(keep);
  const keys = await listKeys();
  for (const k of keys) {
    if (typeof k === 'string' && !wanted.has(k)) await deleteFile(k);
  }
}

// Every blob key a draft owns - what to keep when pruning, what to delete when
// the draft goes away.
export function draftKeys(d) {
  if (!d) return [];
  const keys = d.recording ? [recKey(d.id)] : [];
  if (d.replay) keys.push(replayKey(d.id));
  if (d.replay?.voice) keys.push(replayVoiceKey(d.id));
  if (d.replay?.frames) keys.push(replayFramesKey(d.id));
  for (const s of d.screenshots || []) keys.push(shotKey(s.id));
  return keys;
}
