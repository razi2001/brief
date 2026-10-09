// Brief - filing (runs in the background service worker)
//
// "Create ticket" / "Save as draft" used to run inside the popup, and Chrome
// destroys the popup the instant it loses focus - so clicking Create and then
// clicking anywhere else silently dropped the whole flow: nothing was uploaded,
// nothing was filed. The worker outlives the popup. The popup only ASKS for the
// filing (FILE_DRAFT); this module does it, lands progress + the outcome on the
// draft (a reopened popup shows "Filing…" or the error), and opens the brief page
// when done.

import { TICKETS_URL, uploadDraft, uploadFilesToDraft, processBrief, createDraft, briefPageUrl } from './cloud.js';
import { getDraft, setDraft, clearDraft, updateDraft, emptyDraft, isReadyDraft } from './draft.js';
import { deleteFile, draftKeys, getFile, replayKey, replayVoiceKey, replayFramesKey, replayVideoKey, replayVideoStateKey } from './filestore.js';

// The replay's video, once its render (this edit's `rev`) is done. Usually it
// is, long before Create; if not, filing waits for it - a ticket without the
// video is the fallback only when the render failed or never reports back.
const VIDEO_WAIT_MS = 4 * 60 * 1000;
async function replayVideo(d) {
  const rev = d.replay?.video?.rev;
  if (!rev) return null;
  const until = Date.now() + VIDEO_WAIT_MS;
  while (Date.now() < until) {
    const st = await getFile(replayVideoStateKey(d.id)).then((b) => b && b.text()).then((t) => t && JSON.parse(t)).catch(() => null);
    if (st?.rev === rev) return st.status === 'ready' ? getFile(replayVideoKey(d.id)) : null;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function buildScreenshotFiles(d) {
  return (d.screenshots || []).map((s) => ({
    name: `screenshots/${s.id}.png`,
    blob: new Blob([dataUrlToBytes(s.dataUrl)], { type: 'image/png' }),
    contentType: 'image/png',
  }));
}

// The replay, when one is attached (kept in the blob store), and its voice-over.
async function buildReplayFiles(d) {
  if (!d.replay) return [];
  const files = [];
  const blob = await getFile(replayKey(d.id));
  if (blob) files.push({ name: 'replay.json', blob, contentType: 'application/json' });
  const voice = d.replay.voice ? await getFile(replayVoiceKey(d.id)) : null;
  if (voice) files.push({ name: 'replay-voice.webm', blob: voice, contentType: 'audio/webm' });
  // the replay as a video, for trackers that take uploads (only when attached)
  if (d.replay.attach !== false) {
    const video = await replayVideo(d);
    if (video) files.push({ name: 'replay.webm', blob: video, contentType: 'video/webm' });
  }
  // the key-moment stills, named as replay.json's `frames` list them
  const framesBlob = d.replay.frames ? await getFile(replayFramesKey(d.id)) : null;
  if (framesBlob) {
    const urls = JSON.parse(await framesBlob.text());
    urls.forEach((u, i) => files.push({
      name: `replay-frames/frame-${String(i + 1).padStart(2, '0')}.jpg`,
      blob: new Blob([dataUrlToBytes(u)], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
    }));
  }
  return files;
}

// The user's edits, sent at file time and applied by the server over the
// capture-owned brief.json (edits win).
function buildOverrides(d) {
  return {
    title: d.name || '',
    includeVideo: !!d.includeVideo,
    transcript: d.transcript || '',
    description: d.description || '',
    extra: (d.extra || []).filter((p) => (p.key || '').trim() || (p.value || '').trim()),
    screenshots: (d.screenshots || []).map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated })),
    ...(d.replay ? { includeReplay: d.replay.attach !== false, replayNote: d.replay.note || '' } : {}),
    ...(d.recording?.marks?.length ? { recordingMarks: d.recording.marks.map((m) => ({ t: Math.round(m.t), note: m.note || '' })) } : {}),
  };
}

function buildBriefJsonAndMeta(d, page) {
  const pageUrl = d.pageUrl || page?.url || null;
  const pageTitle = d.pageTitle || page?.title || null;
  const briefJson = {
    id: d.id, name: d.name || '', createdAt: d.createdAt || Date.now(),
    source: d.recording ? 'recording' : ((d.screenshots || []).length ? 'screenshot' : d.replay ? 'replay' : 'text'),
    description: d.description || '', transcript: d.transcript || '', pageUrl, pageTitle,
    hasRecording: !!d.recording,
    screenshots: (d.screenshots || []).map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated })),
    includeVideo: !!d.includeVideo,
    extra: (d.extra || []).filter((p) => (p.key || '').trim() || (p.value || '').trim()),
  };
  const files = [{ name: 'brief.json', blob: new Blob([JSON.stringify(briefJson, null, 2)], { type: 'application/json' }), contentType: 'application/json' }];
  const meta = { title: d.name || '', description: d.description || '', transcript: d.transcript || '', pageUrl, pageTitle, hasScreenshot: (d.screenshots || []).length > 0, keyframeCount: 0 };
  return { files, meta };
}

// The page behind the popup when Create was clicked - the brief's page context
// when no capture pinned one.
async function activePageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) return null;
    return { url: tab.url, title: tab.title || null };
  } catch { return null; }
}

// Make sure the brief exists as a cloud draft: create it + upload brief.json and
// the screenshots on first send, or push new screenshots into an existing draft
// (a recording's draft was created by the offscreen upload). Mutates `d`.
async function ensureUploaded(d) {
  const shotFiles = [...buildScreenshotFiles(d), ...(await buildReplayFiles(d))];
  if (!d.cloudBriefId) {
    const page = await activePageContext();
    const { files, meta } = buildBriefJsonAndMeta(d, page);
    const id = await uploadDraft([...files, ...shotFiles], meta);
    d.cloudBriefId = id;
    await updateDraft(d.id, (x) => { x.cloudBriefId = id; });
  } else if (shotFiles.length) {
    await uploadFilesToDraft(d.cloudBriefId, shotFiles);
  }
}

// Drafts being filed in the background, by id (the popup spins the cloud while
// any are in flight).
async function addFilingDraft(d) {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  filingDrafts[d.id] = { ...d, filingStartedAt: Date.now() };
  await chrome.storage.local.set({ filingDrafts });
}
async function dropFilingDraft(id) {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  delete filingDrafts[id];
  await chrome.storage.local.set({ filingDrafts });
}

async function fileInBackground(d) {
  const run = async () => {
    await ensureUploaded(d);
    return processBrief(d.cloudBriefId, buildOverrides(d));
  };
  try {
    try {
      await run();
    } catch (err) {
      if (err?.code === 'already_filed') { /* it exists: a success */ }
      else if (err?.status === 404 && d.cloudBriefId) { d.cloudBriefId = null; await run(); }
      else throw err;
    }
  } catch (err) {
    // Nothing is lost: the draft comes back with the error. Into the popup if
    // it is empty; otherwise it waits as `failedDraft` (the popup offers it back).
    await dropFilingDraft(d.id);
    const back = { ...d, filing: false, fileError: String(err?.message || err) };
    const now = await getDraft();
    if (!now || !isReadyDraft(now)) await setDraft(back);
    else await chrome.storage.local.set({ failedDraft: back });
    return;
  }
  for (const k of draftKeys(d)) await deleteFile(k).catch(() => {});
  await dropFilingDraft(d.id);
  // Unseen until the cloud button is clicked: the popup marks it with a dot.
  await chrome.storage.local.set({ ticketsUnseen: Date.now() }).catch(() => {});
}

async function failFiling(id, err) {
  const error = String(err?.message || err);
  await updateDraft(id, (x) => { x.filing = false; x.fileError = error; });
  return { ok: false, error };
}

// One brief, one action. `mode` = 'ticket' files straight to the connected
// tracker (the server queues it and writes in the background); 'draft' writes it
// up with no tracker. Either way the brief gets a hosted page, which is where we
// land - it shows the writing/filing state and resolves itself.
//
// `openTab(url)` is supplied by the worker (it owns tab opening). Resolves
// { ok, shareId, alreadyFiled } or { ok: false, error }; the same outcome is
// written onto the draft so a popup that missed the response still knows.
export async function fileDraft(mode, { openTab }) {
  const d = await getDraft();
  if (!d) return { ok: false, error: 'Nothing to file' };
  if (d.filing) return { ok: false, error: 'already_filing' };
  if (d.uploading) return { ok: false, error: 'The recording is still uploading' };
  if (!isReadyDraft(d)) return { ok: false, error: 'Nothing to file' };

  // A ticket doesn't make you wait: the draft is handed off (kept under
  // `filingDrafts` with its blobs, which are keyed by its id), a fresh one takes
  // its place right away, and the upload + filing finish here in the worker.
  if (mode === 'ticket') {
    await addFilingDraft(d);
    await setDraft(emptyDraft());
    fileInBackground(d).catch((err) => console.warn('[brief/filing] background filing:', err));
    return { ok: true, queued: true };
  }

  await updateDraft(d.id, (x) => { x.filing = true; x.filingMode = mode; x.filingStartedAt = Date.now(); x.fileError = null; });
  d.filing = true;

  const run = async () => {
    await ensureUploaded(d);
    const overrides = buildOverrides(d);
    return mode === 'ticket' ? processBrief(d.cloudBriefId, overrides) : createDraft(d.cloudBriefId, overrides);
  };

  let shareId = null;
  let alreadyFiled = false;
  try {
    shareId = await run();
  } catch (err) {
    if (err?.code === 'already_filed' && err.shareId) {
      // The server says this capture already has a ticket (a re-submit). Not an
      // error for the user - the ticket exists. Land on it like a success.
      shareId = err.shareId;
      alreadyFiled = true;
    } else if (err?.status === 404 && d.cloudBriefId) {
      // The cloud draft is gone (deleted on the web) - re-create it and retry once.
      d.cloudBriefId = null;
      await updateDraft(d.id, (x) => { x.cloudBriefId = null; });
      try { shareId = await run(); } catch (err2) { return failFiling(d.id, err2); }
    } else {
      return failFiling(d.id, err);
    }
  }

  // Filed: this draft is spent. Its local media (the video kept for playback,
  // each screenshot's clean capture) goes with it - the cloud has the evidence now.
  for (const k of draftKeys(d)) await deleteFile(k).catch(() => {});
  // Start a fresh draft. A ticket opens no tab: it is written in the background
  // and the popup points at the tickets list (the cloud button) instead - a tab
  // per ticket got in the way. A draft has no tracker ticket to look at, so its
  // own brief page IS the thing you just made: that one still opens.
  await clearDraft();
  await setDraft(emptyDraft());
  // Unseen until the cloud button is clicked: the popup marks it with a dot.
  if (mode === 'ticket') await chrome.storage.local.set({ ticketsUnseen: Date.now() }).catch(() => {});
  else openTab(shareId ? briefPageUrl(shareId) : TICKETS_URL);
  return { ok: true, shareId, alreadyFiled };
}
