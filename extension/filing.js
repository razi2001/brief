// Brief - filing (runs in the background service worker)
//
// "Create in <tracker>" / "Public link" / "Fix prompt" used to run inside the popup, and Chrome
// destroys the popup the instant it loses focus - so clicking Create and then
// clicking anywhere else silently dropped the whole flow: nothing was uploaded,
// nothing was filed. The worker outlives the popup. The popup only ASKS for the
// filing (FILE_DRAFT); this module does it, lands progress + the outcome on the
// draft (a reopened popup shows "Filing…" or the error), and opens the brief page
// when done.

import { uploadDraft, uploadFilesToDraft, processBrief, createDraft, stopFilingOnServer, filingStateOnServer } from './cloud.js';
import { getDraft, setDraft, clearDraft, updateDraft, emptyDraft, isReadyDraft } from './draft.js';
import { deleteFile, draftKeys, getFile, replayKey, replayVoiceKey, replayFramesKey, replayVideoKey, replayVideoStateKey } from './filestore.js';

// The replay's video, once its render (this edit's `rev`) is done. Usually it
// is, long before Create; if not, filing waits for it - a ticket without the
// video is the fallback only when the render failed or never reports back.
const VIDEO_WAIT_MS = 4 * 60 * 1000;
/** The replay's video if it's already rendered, without waiting for it. */
async function replayVideoNow(d) {
  const rev = d.replay?.video?.rev;
  if (!rev) return null;
  const st = await getFile(replayVideoStateKey(d.id)).then((b) => b && b.text()).then((t) => t && JSON.parse(t)).catch(() => null);
  return st?.rev === rev && st.status === 'ready' ? getFile(replayVideoKey(d.id)) : null;
}

async function replayVideo(d) {
  const rev = d.replay?.video?.rev;
  if (!rev) return null;
  const until = Date.now() + VIDEO_WAIT_MS;
  while (Date.now() < until) {
    if (stopAsked.has(d.id)) throw new Stopped();
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
async function buildReplayFiles(d, { waitVideo = true } = {}) {
  if (!d.replay) return [];
  const files = [];
  const blob = await getFile(replayKey(d.id));
  if (blob) files.push({ name: 'replay.json', blob, contentType: 'application/json' });
  const voice = d.replay.voice ? await getFile(replayVoiceKey(d.id)) : null;
  if (voice) files.push({ name: 'replay-voice.webm', blob: voice, contentType: 'audio/webm' });
  // the replay as a video, for trackers that take uploads (only when attached)
  if (d.replay.attach !== false) {
    const video = waitVideo ? await replayVideo(d) : await replayVideoNow(d);
    if (video) files.push({ name: 'replay.webm', blob: video, contentType: 'video/webm' });
    d.videoSent = !!video;
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
    // the recording's narration was transcribed and nothing was said: the
    // server must not transcribe it again (it would invent words for silence)
    ...(d.recording && d.noSpeech && !(d.transcript || '').trim() ? { noSpeech: true } : {}),
    ...(d.autoReport ? { autoReport: true } : {}),
    // the popup's quality competition switch, off for this brief: the server then sends it
    // on as if you were in no quality competition
    ...(d.bashOff ? { bash: false } : {}),
    extra: (d.extra || []).filter((p) => (p.key || '').trim() || (p.value || '').trim()),
    screenshots: (d.screenshots || []).map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated })),
    ...(d.replay ? { includeReplay: d.replay.attach !== false, replayNote: d.replay.note || '' } : {}),
    ...(d.recording?.marks?.length ? { recordingMarks: d.recording.marks.map((m) => ({ t: Math.round(m.t), note: m.note || '' })) } : {}),
    // a trimmed recording: the part of the capture it keeps (its event log is shifted to match)
    ...(d.recording?.trim ? { recordingTrim: { a: Math.round(d.recording.trim.a), b: Math.round(d.recording.trim.b) } } : {}),
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
//
// `shareId`: a link already copied (Public link, Fix prompt), claimed with the brief.
async function ensureUploaded(d, opts = {}) {
  const shotFiles = [...buildScreenshotFiles(d), ...(await buildReplayFiles(d, opts))];
  if (!d.cloudBriefId) {
    const page = await activePageContext();
    const { files, meta } = buildBriefJsonAndMeta(d, page);
    const id = await uploadDraft([...files, ...shotFiles], meta, undefined, { shareId: opts.shareId, via: d.via });
    d.cloudBriefId = id;
    await updateDraft(d.id, (x) => { x.cloudBriefId = id; });
    // a filing that resumes after a worker restart goes on with this upload
    const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
    if (filingDrafts[d.id]) { filingDrafts[d.id].cloudBriefId = id; await chrome.storage.local.set({ filingDrafts }); }
  } else if (shotFiles.length) {
    await uploadFilesToDraft(d.cloudBriefId, shotFiles);
  }
}

// Drafts being filed in the background, by id (the popup spins the cloud while
// any are in flight).
async function addFilingDraft(d, mode) {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  filingDrafts[d.id] = { ...d, filingMode: mode, filingStartedAt: Date.now() };
  await chrome.storage.local.set({ filingDrafts });
}
async function dropFilingDraft(id) {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  delete filingDrafts[id];
  await chrome.storage.local.set({ filingDrafts });
}

// Filings running in THIS worker, so a resume never starts one twice.
const running = new Set();

// Stop, pressed while the worker still has the brief (uploading it, waiting
// for its replay video): the filing ends at its next checkpoint and the brief
// comes back into the popup, nothing sent to the tracker.
const stopAsked = new Set();
class Stopped extends Error {}
function checkpoint(d) { if (stopAsked.has(d.id)) throw new Stopped(); }

// A ticket handed to the server is kept here, with its blobs, while the
// server's agent writes and files it: Stop (in the popup, or on its brief
// page) brings it back into the popup. Dropped once the server says it's
// done, or after the server's own filing limit.
const SENT_KEEP_MS = 10 * 60 * 1000;
async function getSent() {
  const { sentDrafts = {} } = await chrome.storage.local.get('sentDrafts');
  return sentDrafts;
}
async function setSent(sentDrafts) { await chrome.storage.local.set({ sentDrafts }); }
async function dropSent(id, { keepBlobs = false } = {}) {
  const sent = await getSent();
  const d = sent[id];
  if (!d) return;
  delete sent[id];
  await setSent(sent);
  if (!keepBlobs) for (const k of draftKeys(d)) await deleteFile(k).catch(() => {});
}

// Back into the popup, as it was before Create: the current draft if the
// popup is empty, otherwise waiting as `failedDraft` (the popup offers it back).
async function giveBack(d) {
  const back = { ...d, filing: false, fileError: null };
  delete back.filingMode; delete back.filingStartedAt; delete back.sentAt;
  const now = await getDraft();
  if (!now || !isReadyDraft(now)) await setDraft(back);
  else await chrome.storage.local.set({ failedDraft: { ...back, stopped: true } });
}

// Chrome shuts an idle extension worker down after ~30s, and a filing can
// wait minutes for its replay video - a pending promise alone doesn't count
// as activity. So while one runs, an extension API call every 20s keeps the
// worker up; and if it goes down anyway (browser closed, crash), the next
// worker resumes what's left in `filingDrafts` (resumeFiling), with its
// blobs kept (filingKeys) instead of swept as orphans.
async function fileInBackground(d, mode = 'ticket') {
  if (running.has(d.id)) return;
  running.add(d.id);
  const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20_000);
  try {
    await fileOne(d, mode);
  } finally {
    clearInterval(keepAlive);
    running.delete(d.id);
  }
}

/** Pick up filings a previous worker left unfinished. */
export async function resumeFiling() {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  for (const d of Object.values(filingDrafts)) {
    fileInBackground(d, d.filingMode || 'ticket').catch((err) => console.warn('[brief/filing] resume:', err));
  }
}

/** Every blob the drafts being filed (or kept for Stop) still need (kept when pruning). */
export async function filingKeys() {
  const { filingDrafts = {}, sentDrafts = {}, failedDraft = null } = await chrome.storage.local.get(['filingDrafts', 'sentDrafts', 'failedDraft']);
  return [...Object.values(filingDrafts), ...Object.values(sentDrafts), failedDraft].flatMap((d) => draftKeys(d));
}

/**
 * Tickets on their way, for the popup's Stop: the ones the worker still has
 * (`stage: 'sending'`) and the ones the server is filing (`stage: 'filing'`).
 * Asks the server about each kept copy first: a copy stopped on its brief
 * page comes back into the popup here; a filed one is dropped.
 */
export async function inFlight() {
  for (const d of Object.values(await getSent())) {
    if (Date.now() - (d.sentAt || 0) > SENT_KEEP_MS) { await dropSent(d.id); continue; }
    const state = await filingStateOnServer(d.cloudBriefId).catch(() => null);
    if (state === 'stopped') { await dropSent(d.id, { keepBlobs: true }); await giveBack(d); }
    else if (state === 'done') await dropSent(d.id);
  }
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  const row = (d, stage) => ({ id: d.id, stage, title: d.name || (d.description || '').split('\n')[0].trim() });
  return [
    ...Object.values(filingDrafts).filter((d) => (d.filingMode || 'ticket') === 'ticket' && !stopAsked.has(d.id)).map((d) => row(d, 'sending')),
    ...Object.values(await getSent()).map((d) => row(d, 'filing')),
  ];
}

/**
 * Stop a ticket before it reaches the tracker. Resolves { ok } once it is on
 * its way back into the popup, or { ok: false, error } when it was too late.
 */
export async function stopFiling(id) {
  const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
  if (filingDrafts[id]) {
    if (running.has(id)) { stopAsked.add(id); return { ok: true }; }
    // left by a worker that went down, not resumed yet: hand it back now
    await dropFilingDraft(id);
    await giveBack(filingDrafts[id]);
    return { ok: true };
  }
  const d = (await getSent())[id];
  if (!d) return { ok: false, error: 'It already filed' };
  const res = await stopFilingOnServer(d.cloudBriefId).catch((err) => ({ ok: false, error: String(err?.message || err) }));
  if (!res.ok) {
    if (res.tooLate) await dropSent(id);
    return { ok: false, error: res.tooLate ? 'It already filed' : res.error };
  }
  await dropSent(id, { keepBlobs: true });
  await giveBack(d);
  return { ok: true };
}

async function fileOne(d, mode) {
  // A draft is written from the replay's steps and stills, not its video: it
  // goes up at once and the video follows when it's rendered (it can take
  // minutes, and the draft used to wait for it). A ticket waits - the video
  // is attached to it in the tracker.
  const draft = mode !== 'ticket';
  const run = async () => {
    const shareId = draft ? d.shareId : undefined;
    checkpoint(d);
    await ensureUploaded(d, { waitVideo: !draft, shareId });
    checkpoint(d);
    const overrides = buildOverrides(d);
    return mode === 'ticket' ? processBrief(d.cloudBriefId, overrides) : createDraft(d.cloudBriefId, { ...overrides, ...(shareId ? { shareId } : {}) });
  };
  try {
    try {
      await run();
    } catch (err) {
      if (err instanceof Stopped) throw err;
      if (err?.code === 'already_filed') { /* it exists: a success */ }
      else if (err?.status === 404 && d.cloudBriefId) { d.cloudBriefId = null; await run(); }
      else throw err;
    }
    // Stop pressed while the server took it: take it back there too.
    if (stopAsked.has(d.id) && !draft && d.cloudBriefId) {
      const res = await stopFilingOnServer(d.cloudBriefId).catch(() => ({ ok: false }));
      if (res.ok) throw new Stopped();
      stopAsked.delete(d.id); // too late: it files
    }
  } catch (err) {
    if (err instanceof Stopped) {
      stopAsked.delete(d.id);
      await dropFilingDraft(d.id);
      await giveBack(d);
      return;
    }
    // Nothing is lost: the draft comes back with the error. Into the popup if
    // it is empty; otherwise it waits as `failedDraft` (the popup offers it back).
    await dropFilingDraft(d.id);
    const back = { ...d, filing: false, fileError: String(err?.message || err) };
    const now = await getDraft();
    if (!now || !isReadyDraft(now)) await setDraft(back);
    else await chrome.storage.local.set({ failedDraft: back });
    return;
  }
  // the draft's video, once rendered, joins it (best-effort: the draft stands without it)
  if (draft && d.cloudBriefId && d.replay?.video && d.replay.attach !== false && !d.videoSent) {
    const video = await replayVideo(d);
    if (video) await uploadFilesToDraft(d.cloudBriefId, [{ name: 'replay.webm', blob: video, contentType: 'video/webm' }]).catch(() => {});
  }
  if (mode === 'ticket' && d.cloudBriefId) {
    // kept (blobs too) while the server files it, so Stop can bring it back
    await setSent({ ...(await getSent()), [d.id]: { ...d, sentAt: Date.now() } });
  } else {
    for (const k of draftKeys(d)) await deleteFile(k).catch(() => {});
  }
  await dropFilingDraft(d.id);
  // Unseen until the cloud button is clicked: the popup marks it with a dot,
  // and the button opens the list it landed in (Tickets or Drafts).
  await chrome.storage.local.set({ ticketsUnseen: Date.now(), unseenView: mode === 'ticket' ? 'tickets' : 'drafts' }).catch(() => {});
}

// One brief, one action, and the same experience either way. `mode` = 'ticket'
// files straight to the connected tracker; 'draft' writes it up with no ticket.
// Neither makes you wait: the draft is handed off (kept under `filingDrafts`
// with its blobs, which are keyed by its id), a fresh one takes its place right
// away, and the upload + write-up finish here in the worker. No tab opens - the
// result lands behind the popup's cloud button.
//
// Resolves { ok, queued } or { ok: false, error }.
/**
 * File a draft that was never the popup's (a one-click report): handed off
 * the same way, the current draft untouched.
 */
export async function fileDraftObject(d, mode = 'draft') {
  if (!isReadyDraft(d)) return { ok: false, error: 'Nothing to file' };
  await addFilingDraft(d, mode);
  fileInBackground(d, mode).catch((err) => console.warn('[brief/filing] background filing:', err));
  return { ok: true, queued: true };
}

export async function fileDraft(mode) {
  const d = await getDraft();
  if (!d) return { ok: false, error: 'Nothing to file' };
  if (d.filing) return { ok: false, error: 'already_filing' };
  if (d.uploading) return { ok: false, error: 'The recording is still uploading' };
  if (!isReadyDraft(d)) return { ok: false, error: 'Nothing to file' };

  await addFilingDraft(d, mode);
  await setDraft(emptyDraft());
  fileInBackground(d, mode).catch((err) => console.warn('[brief/filing] background filing:', err));
  return { ok: true, queued: true };
}
