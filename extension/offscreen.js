// Claude Brief — offscreen recorder
//
// Runs in chrome-extension://<id>/offscreen.html as an offscreen document.
// This origin is NOT subject to any host page's Permissions-Policy, so
// mic + tab capture work reliably regardless of the recorded page's headers.
//
// Talks to background.js via chrome.runtime messages. The bar iframe never
// touches mic or MediaRecorder directly — it only sends control messages.

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
let previewVideo = null;
let keyframes = [];
let keyframeTimer = null;

const KEYFRAME_INTERVAL_MS = 2000;

function log(...args) {
  console.log('[brief/offscreen]', ...args);
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

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
        case 'STOP':
          await stopRecording(message.transcriptFinal, message.transcriptChunks);
          sendResponse({ ok: true });
          break;
        case 'CANCEL':
          await cancelRecording();
          sendResponse({ ok: true });
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
  } catch (err) {
    log('tab audio routing failed:', err);
  }

  // 2. Mic stream — THIS is the one that fails inside page iframes.
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

  // 6. Notify the bar (via background relay — see RECORDING_FINISHED for why)
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
  // Intentionally unused — SR runs in the bar iframe instead.
  // Kept as a no-op so the rest of the message handling doesn't break.
}

function stopSpeechRecognition() {
  // No-op — see startSpeechRecognition.
}

async function stopRecording(transcriptFinalFromBar, transcriptChunksFromBar) {
  log('stopRecording');
  stopSpeechRecognition();
  stopKeyframeCapture();

  // Wait for MediaRecorder to flush
  await new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return resolve();
    mediaRecorder.onstop = () => resolve();
    try { mediaRecorder.stop(); } catch { resolve(); }
  });

  cleanupStreams();

  // Build the audio/video blob
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const recordingB64 = await blobToBase64(blob);

  // Serialize keyframes
  const keyframesB64 = [];
  for (const k of keyframes) {
    keyframesB64.push({
      timestamp: k.timestamp,
      base64: await blobToBase64(k.blob),
    });
  }

  const durationMs = Date.now() - recordingStartMs;

  // Send via background — it knows which tab the bar lives in.
  // Using a relay target instead of broadcast so the bar receives the
  // message only via background's chrome.tabs.sendMessage path (no
  // duplicate delivery from the broadcast).
  chrome.runtime.sendMessage({
    target: 'relayToBar',
    payload: {
      target: 'bar',
      type: 'RECORDING_FINISHED',
      recordingB64,
      mimeType: 'video/webm',
      durationMs,
      transcriptFinal: (transcriptFinalFromBar || '').trim(),
      transcriptChunks: transcriptChunksFromBar || [],
      keyframes: keyframesB64,
    },
  });

  recordedChunks = [];
  keyframes = [];
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
