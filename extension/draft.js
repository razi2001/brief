// Brief - the single current draft. One brief at a time: the popup composes it,
// the bar/offscreen finalize the recording onto it, and filing clears it.
//
// chrome.storage is available in popup/background/bar (extension pages) but NOT
// in the offscreen document - offscreen never imports this; it goes through
// background messaging instead.

const KEY = 'draft';

export function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyDraft() {
  return {
    id: genId(),
    name: '',
    // [{ id, dataUrl, annotated, strokes, description, pageUrl, pageTitle, addedAt }]
    // dataUrl is the FLATTENED image (marks baked in) - what the tile shows and
    // what gets filed. `strokes` plus the clean capture kept in the blob store
    // under shot:<id> are what make the drawing re-editable.
    screenshots: [],
    recording: null,   // { recordedAt, durationMs } once a recording lands
    includeVideo: true,
    transcript: '',
    transcribing: false,
    transcriptFailed: false,
    description: '',
    // true while `description` is the AI's summary of the narration, untouched
    // by the reporter: only then may a newer summary replace it.
    descriptionAuto: false,
    // true from the transcript landing until that summary does
    describing: false,
    extra: [],         // [{ key, value }]
    pageUrl: null,
    pageTitle: null,
    cloudBriefId: null,
    uploading: false,
    uploadFailed: false,
    uploadError: null,
    // Filing runs in the background worker (it outlives the popup). These let a
    // reopened popup show progress, and surface a failure that happened while
    // the popup was closed.
    filing: false,
    filingMode: null,  // 'ticket' | 'draft'
    filingStartedAt: 0,
    fileError: null,
    createdAt: Date.now(),
  };
}

// A recording just landed on the draft: the user hit stop, or the worker stopped
// it because the recorded tab was closed, or a video file was picked in the
// popup. One place for the state transition so every path produces the same
// draft. `source` is 'capture' (tabCapture) or 'upload' (a file).
export function landRecording(d, { uploading = true, durationMs = 0, poster = null, source = 'capture' } = {}) {
  d.recording = { recordedAt: Date.now(), durationMs, poster, source };
  // A fresh recording defaults to "attach the video" ON (the user can still
  // toggle it off in the recording sheet).
  d.includeVideo = true;
  if (uploading) {
    d.uploading = true;
    d.uploadFailed = false;
    d.uploadError = null;
    d.transcribing = true;
    // A new recording replaces any prior one (one recording per brief): the
    // fresh upload sets a new cloud id, so clear the old id + transcript and
    // never file the stale draft.
    d.cloudBriefId = null;
    d.transcript = '';
    d.transcriptFailed = false;
    d.describing = false;
    // An AI description summed up the old recording's narration.
    clearAutoDescription(d);
  }
}

// The AI's description (from the narration) lands only in an empty field or
// over its own untouched text: what the reporter wrote always wins.
export function applyAutoDescription(d, text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return false;
  if ((d.description || '').trim() && !d.descriptionAuto) return false;
  d.description = t;
  d.descriptionAuto = true;
  return true;
}
export function clearAutoDescription(d) {
  if (!d.descriptionAuto) return;
  d.description = '';
  d.descriptionAuto = false;
}

export async function getDraft() {
  const { [KEY]: d } = await chrome.storage.local.get(KEY);
  return d && typeof d === 'object' ? d : null;
}
export async function setDraft(d) {
  await chrome.storage.local.set({ [KEY]: d });
  chrome.runtime.sendMessage({ type: 'DRAFT_CHANGED' }).catch(() => {});
}
export async function clearDraft() {
  await chrome.storage.local.remove(KEY);
  chrome.runtime.sendMessage({ type: 'DRAFT_CHANGED' }).catch(() => {});
}

// Read-modify-write guarded by id: async results (upload/transcript/shot) only
// apply when they still target the CURRENT draft (the user may have filed and
// started a fresh one while a background task was in flight). patch(d) mutates in
// place. Returns the saved draft, or null if the id no longer matches.
// `create`: with no draft at all, start a fresh one with this id.
//
// One at a time in this context: two results landing together (the narration
// and the upload, which run side by side) would each read the draft, and the
// second write would undo the first.
let updating = Promise.resolve();
export function updateDraft(briefId, patch, { create = false } = {}) {
  const run = updating.then(async () => {
    let d = await getDraft();
    if (!d && create && briefId) { d = emptyDraft(); d.id = briefId; }
    if (!d || (briefId && d.id !== briefId)) return null;
    patch(d);
    await setDraft(d);
    return d;
  });
  updating = run.catch(() => {});
  return run;
}

export function isReadyDraft(d) {
  if (!d) return false;
  return (Array.isArray(d.screenshots) && d.screenshots.length > 0) ||
    !!d.recording ||
    !!d.replay ||
    !!(d.description && d.description.trim());
}

// One-time migration off the legacy multi-brief `inbox` array. Adopt the single
// most-relevant entry (prefer one whose recording is still uploading), convert
// its single `screenshot` to the screenshots[] shape, drop the rest. Idempotent.
export async function migrateInboxToDraft() {
  const { inbox, [KEY]: existing } = await chrome.storage.local.get(['inbox', KEY]);
  if (existing) { if (inbox) await chrome.storage.local.remove('inbox'); return; }
  if (!Array.isArray(inbox) || inbox.length === 0) {
    if (inbox) await chrome.storage.local.remove('inbox');
    return;
  }
  const pick = inbox.find((b) => b && b.uploading) ||
    inbox.slice().sort((a, b) => (b?.recordedAt || b?.addedAt || 0) - (a?.recordedAt || a?.addedAt || 0))[0];
  const d = emptyDraft();
  if (pick) {
    d.id = pick.id || d.id;
    d.name = pick.name || '';
    d.description = pick.description || '';
    d.extra = Array.isArray(pick.extra) ? pick.extra : [];
    d.includeVideo = !!pick.includeVideo;
    d.pageUrl = pick.pageUrl || null;
    d.pageTitle = pick.pageTitle || null;
    d.cloudBriefId = pick.cloudBriefId || null;
    d.uploading = !!pick.uploading;
    d.uploadFailed = !!pick.uploadFailed;
    d.uploadError = pick.uploadError || null;
    if (pick.hasRecording || pick.recorded) d.recording = { recordedAt: pick.recordedAt || Date.now(), durationMs: 0 };
    if (pick.screenshot) {
      d.screenshots = [{
        id: genId(), dataUrl: pick.screenshot, annotated: !!pick.screenshotAnnotated,
        description: '', pageUrl: pick.pageUrl || null, pageTitle: pick.pageTitle || null, addedAt: Date.now(),
      }];
    }
  }
  await chrome.storage.local.set({ [KEY]: d });
  await chrome.storage.local.remove('inbox');
}
