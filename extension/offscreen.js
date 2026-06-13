// Brief - offscreen recorder
//
// Runs in chrome-extension://<id>/offscreen.html as an offscreen document.
// This origin is NOT subject to any host page's Permissions-Policy, so
// mic + tab capture work reliably regardless of the recorded page's headers.
//
// Talks to background.js via chrome.runtime messages. The bar iframe never
// touches mic or MediaRecorder directly - it only sends control messages.
//
// When connected to Brief Cloud, THIS document also uploads the finished
// draft (it holds the blob and outlives the bar, which closes immediately) -
// the bar shows "saved" right away and the upload runs in the background.
// Background keeps this document alive until it reports OFFSCREEN_DONE.

import { uploadDraft } from './cloud.js';

let micStream = null;
let tabStream = null;
let mediaRecorder = null;
let audioRecorder = null;
let audioChunks = [];
let recordedChunks = [];
let recordingStartMs = 0;
let previewVideo = null;
let keyframes = [];
let keyframeTimer = null;

const KEYFRAME_INTERVAL_MS = 2000;

function log(...args) {
  console.log('[brief/offscreen]', ...args);
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only accept the copy relayed by background. The bar is an extension-origin
  // iframe, so its sendMessage BROADCASTS here directly too - without this
  // guard every command runs twice (double STOP = duplicate uploads, a blob
  // missing its final chunk, and broken UPLOADS_PENDING accounting).
  if (message?.target !== 'offscreen' || !message.viaBackground) return false;

  (async () => {
    try {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          break;
        case 'START':
          await startRecording(message.streamId, message.lang);
          sendResponse({ ok: true });
          break;
        case 'STOP': {
          // Stop + collect synchronously, ACK right away so the bar can show
          // "saved" and close, then upload in the background (cloud-only - no
          // local zip; a missing pairing surfaces as uploadFailed and the
          // popup gates recording on pairing so it shouldn't happen).
          const data = await collectRecording();
          sendResponse({ ok: true });
          uploadAndFinish({
            briefId: message.briefId,
            intent: message.intent || 'brief',
            ...data,
          });
          break;
        }
        case 'CANCEL':
          await cancelRecording();
          sendResponse({ ok: true });
          // Nothing to upload or relay - background can close this document.
          chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
          break;
        case 'GET_TAB_STREAM_ID':
          // Bar might need the stream ID to also tap it for keyframes
          sendResponse({ ok: true });
          break;
        case 'MUTE':
          if (micStream) {
            for (const t of micStream.getAudioTracks()) t.enabled = !message.muted;
          }
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown_type' });
      }
    } catch (err) {
      log('handler error:', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  return true; // keep channel open for async response
});

// ---------- Recording ----------
async function startRecording(streamId, lang) {
  log('startRecording', { streamId, lang });
  recordedChunks = [];
  audioChunks = [];
  recordingStartMs = Date.now();

  // 1. Tab stream from the streamId we were handed
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  });
  // Re-route tab audio to speakers (tabCapture mutes the source by default)
  try {
    const ctx = new AudioContext();
    ctx.createMediaStreamSource(new MediaStream(tabStream.getAudioTracks()))
      .connect(ctx.destination);
    // AudioContexts can start suspended (autoplay policy); a suspended
    // context silently drops audio until it spins up.
    await ctx.resume().catch(() => {});
  } catch (err) {
    log('tab audio routing failed:', err);
  }

  // 2. Mic stream - THIS is the one that fails inside page iframes.
  //    Here in offscreen origin, no page policy applies.
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  // 3. Mix tab audio + mic audio into combined stream alongside tab video
  const tracks = [];
  for (const t of tabStream.getVideoTracks()) tracks.push(t);
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  for (const t of tabStream.getAudioTracks()) {
    audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
  }
  for (const t of micStream.getAudioTracks()) {
    audioCtx.createMediaStreamSource(new MediaStream([t])).connect(dest);
  }
  // CRITICAL for the first seconds of voice: a suspended mixing context
  // records silence until it starts. Make sure it's actually running BEFORE
  // the recorder starts pulling from its destination stream.
  await audioCtx.resume().catch(() => {});
  for (const t of dest.stream.getAudioTracks()) tracks.push(t);
  const combinedStream = new MediaStream(tracks);

  // 4. MediaRecorder
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : 'video/webm';
  // 1.2 Mbps keeps screen content crisp while staying well under Supabase's
  // 50 MB object cap: ~5.5 min of recording vs ~2.7 min at 2.5 Mbps. Long
  // briefs that still cross the cap surface a clear "exceeded maximum size"
  // error now (see cloud.js) instead of a silent failure.
  mediaRecorder = new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 1_200_000 });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(1000);

  // Audio-only recorder for server-side transcription. Records JUST the mixed
  // tab+mic audio (dest.stream) as a small opus webm (~1-2 MB for 2 min), so it
  // always fits under OpenAI's 25 MB transcription cap - no video bloat.
  const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  try {
    audioRecorder = new MediaRecorder(new MediaStream(dest.stream.getAudioTracks()), { mimeType: audioMime });
    audioRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    audioRecorder.start(1000);
  } catch (err) {
    // Non-fatal: if the audio recorder can't start we just upload without a
    // transcribable track; the brief still files on visual evidence.
    log('audio recorder failed to start:', err);
    audioRecorder = null;
  }

  // 4b. Hidden video element to enable keyframe extraction via canvas
  if (!previewVideo) {
    previewVideo = document.createElement('video');
    previewVideo.muted = true;
    previewVideo.autoplay = true;
    previewVideo.playsInline = true;
    previewVideo.style.display = 'none';
    document.body.appendChild(previewVideo);
  }
  previewVideo.srcObject = combinedStream;
  await previewVideo.play().catch(() => {});

  keyframes = [];
  startKeyframeCapture();

  // 5. This document records the video plus a separate audio-only track; the
  // audio is uploaded as audio.webm and transcribed server-side by OpenAI.

  // 6. Notify the bar (via background relay - it knows which tab the bar is in)
  chrome.runtime.sendMessage({
    target: 'relayToBar',
    payload: { target: 'bar', type: 'RECORDING_STARTED', startedAt: recordingStartMs },
  });
}

function startKeyframeCapture() {
  if (keyframeTimer) clearInterval(keyframeTimer);
  const captureOne = async () => {
    if (!previewVideo || previewVideo.readyState < 2) return;
    const w = previewVideo.videoWidth, h = previewVideo.videoHeight;
    if (!w || !h) return;
    const maxW = 1280;
    const scale = Math.min(1, maxW / w);
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d').drawImage(previewVideo, 0, 0, cw, ch);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    keyframes.push({ timestamp: Date.now() - recordingStartMs, blob });
  };
  captureOne();
  keyframeTimer = setInterval(captureOne, KEYFRAME_INTERVAL_MS);
}

function stopKeyframeCapture() {
  if (keyframeTimer) clearInterval(keyframeTimer);
  keyframeTimer = null;
}

// Stop the audio-only recorder and wait for its final chunk to flush.
function stopAudioRecorder() {
  return new Promise((resolve) => {
    if (!audioRecorder || audioRecorder.state === 'inactive') return resolve();
    audioRecorder.onstop = () => resolve();
    try { audioRecorder.stop(); } catch { audioRecorder.onstop = null; resolve(); }
  });
}

// Stop the recorder and hand back the raw results (blob + keyframe blobs).
// Shared by the cloud-upload and legacy-relay paths.
async function collectRecording() {
  log('collectRecording');
  await stopAudioRecorder();
  stopKeyframeCapture();

  // Wait for MediaRecorder to flush
  await new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return resolve();
    mediaRecorder.onstop = () => resolve();
    try { mediaRecorder.stop(); } catch { resolve(); }
  });

  cleanupStreams();

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const audioBlob = audioChunks.length ? new Blob(audioChunks, { type: 'audio/webm' }) : null;
  const collected = {
    blob,
    audioBlob,
    mimeType: 'video/webm',
    keyframes: keyframes.slice(),
    durationMs: Date.now() - recordingStartMs,
    startedAtMs: recordingStartMs,
  };
  recordedChunks = [];
  audioChunks = [];
  audioRecorder = null;
  keyframes = [];
  return collected;
}

// Cloud path: assemble brief.json HERE (page meta from background, the user's
// draft fields from the inbox entry) and upload the draft. The bar is already
// closed - the upload retries a few times, and the outcome (cloud id or a
// labelled error) lands on the inbox entry via UPLOAD_RESULT. Cloud-only: there
// is no local zip fallback, so a hard failure is surfaced, not hidden.
async function uploadAndFinish({ briefId, intent, blob, audioBlob, mimeType, keyframes: frames, durationMs, startedAtMs }) {
  // CRITICAL: an offscreen document only reliably gets chrome.runtime -
  // chrome.storage is undefined here, so reading the token / inbox directly
  // threw "Cannot read properties of undefined (reading 'local')" and EVERY
  // background upload failed. Ask the background worker (which has full
  // chrome.storage) for the token + this brief's draft fields over runtime
  // messaging instead. Page meta comes back in the same call.
  let token = null;
  let entry = null;
  let meta = { events: [], pageUrl: null, pageTitle: null };
  try {
    const ctx = await chrome.runtime.sendMessage({ type: 'GET_UPLOAD_CONTEXT', briefId });
    if (ctx) {
      token = ctx.token || null;
      entry = ctx.entry || null;
      if (ctx.meta) meta = ctx.meta;
    }
  } catch {}

  const keyframeEntries = [];
  const keyframeMeta = [];
  for (let i = 0; i < frames.length; i++) {
    const name = `keyframes/keyframe-${String(i).padStart(3, '0')}.png`;
    keyframeEntries.push({ name, blob: frames[i].blob });
    keyframeMeta.push({ index: i, timestamp: frames[i].timestamp, file: name });
  }

  const briefJson = {
    id: briefId,
    schemaVersion: 2,
    createdAt: new Date(startedAtMs).toISOString(),
    durationMs,
    intent,
    pageUrl: meta.pageUrl,
    pageTitle: meta.pageTitle,
    userAgent: navigator.userAgent,
    transcript: null,        // filled server-side by OpenAI transcription
    transcriptChunks: [],
    keyframes: keyframeMeta,
    events: meta.events || [],
    description: entry?.description || '',
    hasScreenshot: !!entry?.screenshot,
    screenshotAnnotated: !!entry?.screenshotAnnotated,
    // The "attach the recording" toggle is OFF by default and may be flipped in
    // the popup after this point; the authoritative value is sent at file time.
    // This is just a frozen fallback for retries.
    includeVideo: !!entry?.includeVideo,
    extra: Array.isArray(entry?.extra)
      ? entry.extra.filter((p) => (p.key || '').trim() || (p.value || '').trim())
      : [],
    recording: { file: 'recording.webm', mimeType, durationMs },
  };

  try {
    const files = [
      {
        name: 'brief.json',
        blob: new Blob([JSON.stringify(briefJson)], { type: 'application/json' }),
        contentType: 'application/json',
      },
      ...keyframeEntries.map((k) => ({ name: k.name, blob: k.blob, contentType: 'image/png' })),
    ];
    if (blob && blob.size) {
      files.push({ name: 'recording.webm', blob, contentType: mimeType });
    }
    if (audioBlob && audioBlob.size) {
      files.push({ name: 'audio.webm', blob: audioBlob, contentType: 'audio/webm' });
    }
    if (entry?.screenshot) {
      try {
        const b64 = entry.screenshot.split(',')[1] || '';
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        files.push({ name: 'screenshot.png', blob: new Blob([arr], { type: 'image/png' }), contentType: 'image/png' });
      } catch {}
    }

    const cloudMeta = {
      title: entry?.name || '',
      transcript: '',
      keyframeCount: keyframeEntries.length,
      hasScreenshot: !!entry?.screenshot,
      pageUrl: meta.pageUrl,
      pageTitle: meta.pageTitle,
      description: entry?.description || '',
    };

    // Transient network/server hiccups: retry before declaring failure -
    // there is no local fallback anymore, so we try hard here.
    let cloudBriefId = null;
    let lastErr = null;
    for (const delay of [0, 1500, 5000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        cloudBriefId = await uploadDraft(files, cloudMeta, token);
        break;
      } catch (err) {
        lastErr = err;
        log('upload attempt failed:', err?.message || err);
      }
    }
    if (!cloudBriefId) throw lastErr || new Error('upload failed');
    log('background upload done', cloudBriefId);
    await chrome.runtime.sendMessage({ type: 'UPLOAD_RESULT', briefId, cloudBriefId }).catch(() => {});
  } catch (err) {
    console.warn('[brief/offscreen] cloud upload failed:', err);
    await chrome.runtime
      .sendMessage({ type: 'UPLOAD_RESULT', briefId, error: String(err?.message || err) })
      .catch(() => {});
  } finally {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
  }
}

async function cancelRecording() {
  log('cancelRecording');
  stopKeyframeCapture();
  if (audioRecorder) {
    audioRecorder.ondataavailable = null;
    if (audioRecorder.state !== 'inactive') { try { audioRecorder.stop(); } catch {} }
  }
  audioRecorder = null;
  audioChunks = [];
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch {}
  }
  cleanupStreams();
  recordedChunks = [];
  keyframes = [];
}

function cleanupStreams() {
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  } catch {}
  for (const t of (tabStream?.getTracks() || [])) {
    try { t.stop(); } catch {}
  }
  for (const t of (micStream?.getTracks() || [])) {
    try { t.stop(); } catch {}
  }
  tabStream = null;
  micStream = null;
  mediaRecorder = null;
  if (previewVideo) {
    try { previewVideo.srcObject = null; } catch {}
  }
}

// Stop everything if the document is unloaded (e.g. when background calls
// chrome.offscreen.closeDocument). Otherwise streams can linger and block
// tabCapture on the next recording.
window.addEventListener('beforeunload', () => {
  stopKeyframeCapture();
  cleanupStreams();
});

log('offscreen recorder loaded');
