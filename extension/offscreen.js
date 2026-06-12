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

import { getCloudToken, uploadDraft } from './cloud.js';
import { buildBriefZipBytes } from './brief-bundle.js';

let micStream = null;
let tabStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recognizer = null;
let transcriptFinal = '';
let transcriptInterim = '';
let transcriptChunks = [];
let recognitionShouldRun = false;
let recordingStartMs = 0;
let recordingLang = 'en-US';
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
          // Stop + collect synchronously, then branch:
          //  - cloud: ACK right away (mode: 'cloud') so the bar can show
          //    "saved" and close; the upload continues here in the background.
          //  - not connected: legacy base64 relay back to the bar, which
          //    builds the local zip.
          const data = await collectRecording();
          let token = null;
          try { token = await getCloudToken(); } catch {}
          if (token && message.briefId) {
            sendResponse({ ok: true, mode: 'cloud' });
            uploadAndFinish({
              briefId: message.briefId,
              intent: message.intent || 'brief',
              transcriptFinal: (message.transcriptFinal || '').trim(),
              transcriptChunks: message.transcriptChunks || [],
              ...data,
            });
          } else {
            sendResponse({ ok: true, mode: 'relay' });
            await relayFinished(data, message.transcriptFinal, message.transcriptChunks);
            chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
          }
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
  transcriptFinal = '';
  transcriptInterim = '';
  transcriptChunks = [];
  recordingLang = lang || 'en-US';
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
  mediaRecorder = new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(1000);

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

  // 5. Speech recognition runs in the BAR, not here. Offscreen documents
  // are invisible to Chrome, and webkitSpeechRecognition silently fails to
  // produce results in invisible contexts. The bar iframe is visible and
  // works correctly. We just record audio/video here.

  // 6. Notify the bar (via background relay - see RECORDING_FINISHED for why)
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

async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function startSpeechRecognition(lang) {
  // Intentionally unused - SR runs in the bar iframe instead.
  // Kept as a no-op so the rest of the message handling doesn't break.
}

function stopSpeechRecognition() {
  // No-op - see startSpeechRecognition.
}

// Stop the recorder and hand back the raw results (blob + keyframe blobs).
// Shared by the cloud-upload and legacy-relay paths.
async function collectRecording() {
  log('collectRecording');
  stopSpeechRecognition();
  stopKeyframeCapture();

  // Wait for MediaRecorder to flush
  await new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return resolve();
    mediaRecorder.onstop = () => resolve();
    try { mediaRecorder.stop(); } catch { resolve(); }
  });

  cleanupStreams();

  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const collected = {
    blob,
    mimeType: 'video/webm',
    keyframes: keyframes.slice(),
    durationMs: Date.now() - recordingStartMs,
    startedAtMs: recordingStartMs,
    // Snapshot the lang NOW - a new recording can reuse this document while
    // the upload is still running and would clobber the module-level value.
    lang: recordingLang,
  };
  recordedChunks = [];
  keyframes = [];
  return collected;
}

// Legacy path (not connected to Brief Cloud): base64 the blob + keyframes and
// relay them to the bar, which assembles and downloads the local zip.
async function relayFinished(data, transcriptFinalFromBar, transcriptChunksFromBar) {
  const recordingB64 = await blobToBase64(data.blob);
  const keyframesB64 = [];
  for (const k of data.keyframes) {
    keyframesB64.push({
      timestamp: k.timestamp,
      base64: await blobToBase64(k.blob),
    });
  }

  // Send via background - it knows which tab the bar lives in.
  // Using a relay target instead of broadcast so the bar receives the
  // message only via background's chrome.tabs.sendMessage path (no
  // duplicate delivery from the broadcast).
  chrome.runtime.sendMessage({
    target: 'relayToBar',
    payload: {
      target: 'bar',
      type: 'RECORDING_FINISHED',
      recordingB64,
      mimeType: data.mimeType,
      durationMs: data.durationMs,
      transcriptFinal: (transcriptFinalFromBar || '').trim(),
      transcriptChunks: transcriptChunksFromBar || [],
      keyframes: keyframesB64,
    },
  });
}

// Cloud path: assemble brief.json HERE (page meta from background, the user's
// draft fields from the inbox entry) and upload the draft. The bar is already
// closed - failures fall back to the local zip download so the recording is
// never lost, and the result lands on the inbox entry via UPLOAD_RESULT.
async function uploadAndFinish({ briefId, intent, transcriptFinal, transcriptChunks, blob, mimeType, keyframes: frames, durationMs, startedAtMs, lang }) {
  // Page meta + event log collected by background during the recording.
  let meta = { events: [], pageUrl: null, pageTitle: null };
  try {
    meta = await chrome.runtime.sendMessage({ type: 'GET_BRIEF_META' });
  } catch {}

  // The user's draft fields (name, description, screenshot, extras, toggle).
  let entry = null;
  try {
    const { inbox } = await chrome.storage.local.get('inbox');
    entry = (Array.isArray(inbox) ? inbox : []).find((b) => b.id === briefId) || null;
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
    transcriptLang: lang || recordingLang,
    transcript: transcriptFinal || null,
    transcriptChunks: transcriptChunks || [],
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
      transcript: transcriptFinal || '',
      keyframeCount: keyframeEntries.length,
      hasScreenshot: !!entry?.screenshot,
      pageUrl: meta.pageUrl,
      pageTitle: meta.pageTitle,
      description: entry?.description || '',
    };

    const cloudBriefId = await uploadDraft(files, cloudMeta);
    log('background upload done', cloudBriefId);
    await chrome.runtime.sendMessage({ type: 'UPLOAD_RESULT', briefId, cloudBriefId }).catch(() => {});
  } catch (err) {
    console.warn('[brief/offscreen] cloud upload failed, saving local zip:', err);
    // Preserve the recording locally so nothing is lost.
    try {
      const recordingBytes = new Uint8Array(await blob.arrayBuffer());
      const kfBytes = [];
      for (const k of keyframeEntries) {
        kfBytes.push({ name: k.name, data: new Uint8Array(await k.blob.arrayBuffer()) });
      }
      const zipBytes = await buildBriefZipBytes({
        briefJson,
        recordingBytes,
        keyframeEntries: kfBytes,
        screenshotDataUrl: entry?.screenshot || null,
      });
      const blobUrl = URL.createObjectURL(new Blob([zipBytes], { type: 'application/zip' }));
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ZIP',
        payload: { blobUrl, filename: `brief/brief-${briefId}.zip` },
      });
    } catch (zipErr) {
      console.error('[brief/offscreen] zip fallback failed too:', zipErr);
    }
    await chrome.runtime
      .sendMessage({ type: 'UPLOAD_RESULT', briefId, error: String(err?.message || err) })
      .catch(() => {});
  } finally {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
  }
}

async function cancelRecording() {
  log('cancelRecording');
  stopSpeechRecognition();
  stopKeyframeCapture();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch {}
  }
  cleanupStreams();
  recordedChunks = [];
  keyframes = [];
  transcriptChunks = [];
  transcriptFinal = '';
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
