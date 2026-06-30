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
    screenshots: [],   // [{ id, dataUrl, annotated, description, pageUrl, pageTitle, addedAt }]
    recording: null,   // { recordedAt, durationMs } once a recording lands
    includeVideo: true,
    transcript: '',
    transcribing: false,
    transcriptFailed: false,
    description: '',
    extra: [],         // [{ key, value }]
    pageUrl: null,
    pageTitle: null,
    cloudBriefId: null,
    uploading: false,
    uploadFailed: false,
    uploadError: null,
    createdAt: Date.now(),
  };
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
export async function updateDraft(briefId, patch) {
  const d = await getDraft();
  if (!d || (briefId && d.id !== briefId)) return null;
  patch(d);
  await setDraft(d);
  return d;
}

export function isReadyDraft(d) {
  if (!d) return false;
  return (Array.isArray(d.screenshots) && d.screenshots.length > 0) ||
    !!d.recording ||
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
