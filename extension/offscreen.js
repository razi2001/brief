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

import { uploadDraft, transcribeNote } from './cloud.js';
import { getFile, putFile, recKey, replayKey, replayVoiceKey, replayVideoKey, replayVideoStateKey } from './filestore.js';

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
let levelTimer = null;
let levelAnalyser = null;
let levelFreq = null;
let overrunTimer = null;
let stopRequested = false;

const KEYFRAME_INTERVAL_MS = 2000;
// The bar stops a recording at its 2-minute cap. If the bar is gone (the recorded
// tab never came back after a navigation) nothing would ever stop us - past this
// point we ask the worker to stop + save what we have.
const OVERRUN_MS = (120 + 15) * 1000;

function log(...args) {
  console.log('[brief/offscreen]', ...args);
}

// Downscale a keyframe blob to a small JPEG data URL - used as the recording's
// poster so the popup's recording tile shows a real frame (like the screenshots).
function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });
}
async function makePoster(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const maxW = 960; // sharp in the popup at 2x, not just as a tile
    const scale = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return await blobToDataUrl(out);
  } catch (err) {
    log('poster gen failed:', err?.message || err);
    return null;
  }
}

// ---------- Replay -> video ----------
// One render at a time (they share this document's CPU); a newer edit of the
// same replay supersedes a queued older one.
let renderChain = Promise.resolve();
const latestRev = new Map();
function queueReplayRender(draftId, rev) {
  latestRev.set(draftId, rev);
  renderChain = renderChain.then(async () => {
    if (latestRev.get(draftId) !== rev) { chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {}); return; }
    const started = performance.now();
    let state;
    try {
      const json = await getFile(replayKey(draftId));
      if (!json) throw new Error('replay not found');
      const payload = JSON.parse(await json.text());
      const voice = payload.voice ? await getFile(replayVoiceKey(draftId)) : null;
      const { renderReplay } = await import('./replay-render.js');
      const video = await renderReplay(payload, voice);
      await putFile(replayVideoKey(draftId), video);
      state = { rev, status: 'ready', bytes: video.size, ms: Math.round(performance.now() - started) };
    } catch (err) {
      log('replay render failed:', err?.message || err);
      state = { rev, status: 'failed', error: String(err?.message || err) };
    }
    await putFile(replayVideoStateKey(draftId), new Blob([JSON.stringify(state)], { type: 'application/json' })).catch(() => {});
    chrome.runtime.sendMessage({ type: 'REPLAY_VIDEO_DONE', draftId, ...state }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
  });
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
          // Phase 1: acquire streams + build recorders (don't start yet).
          await prepareRecording(message.streamId, message.capture);
          sendResponse({ ok: true, surface: tabStream?.getVideoTracks()[0]?.getSettings().displaySurface || null });
          break;
        case 'GO':
          // Phase 2: the bar's countdown finished - start capturing now.
          beginRecording();
          sendResponse({ ok: true });
          break;
        case 'STOP': {
          // Stop + collect synchronously, ACK right away so the bar can show
          // "saved" and close, then upload in the background (cloud-only - no
          // local zip; a missing pairing surfaces as uploadFailed and the
          // popup gates recording on pairing so it shouldn't happen).
          // Once per recording: a window recording has a bar in every tab, and
          // a second STOP would upload an empty video.
          if (!mediaRecorder || stopRequested) { sendResponse({ ok: false, error: 'not_recording' }); break; }
          stopRequested = true;
          const data = await collectRecording();
          sendResponse({ ok: true });
          uploadAndFinish({
            briefId: message.briefId,
            intent: message.intent || 'brief',
            ...data,
          });
          break;
        }
        case 'UPLOAD_FILE': {
          // A video the reporter picked in the popup, parked in IndexedDB. ACK,
          // then sample keyframes + upload in the background exactly like a
          // captured recording (background guards this document until
          // OFFSCREEN_DONE, same as STOP).
          const blob = await getFile(message.key);
          if (!blob) { sendResponse({ ok: false, error: 'video file not found' }); break; }
          sendResponse({ ok: true });
          uploadFileAndFinish({
            briefId: message.briefId,
            key: message.key,
            blob,
            fileName: message.name || 'recording.mp4',
            mimeType: message.mimeType || blob.type || 'video/mp4',
          });
          break;
        }
        case 'AUTO_REPORT_BUILD':
          // One-click report: rebuild the last minute, find what looks wrong,
          // render the video and its stills - no page on screen. ACK now; the
          // result goes back as AUTO_REPORT_BUILT (any worker can take it).
          sendResponse({ ok: true });
          renderChain = renderChain.then(async () => {
            let result;
            try {
              const { buildAutoReport } = await import('./auto-report.js');
              result = await buildAutoReport(message);
            } catch (err) {
              log('auto report failed:', err?.message || err);
              result = { ok: false, error: String(err?.message || err) };
            }
            chrome.runtime.sendMessage({ type: 'AUTO_REPORT_BUILT', draftId: message.draftId, result }).catch(() => {});
            chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
          });
          break;
        case 'RENDER_REPLAY':
          // Turn a saved replay into a video, in the background. ACK now; the
          // result lands in IndexedDB (filing waits for it) and is reported
          // with REPLAY_VIDEO_DONE, then OFFSCREEN_DONE like an upload.
          sendResponse({ ok: true });
          queueReplayRender(message.draftId, message.rev);
          break;
        case 'CANCEL':
          await cancelRecording();
          sendResponse({ ok: true });
          // Nothing to upload or relay - background can close this document.
          chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
          break;
        case 'GET_REC_STATE':
          // Is the capture actually still alive? The worker asks after a page
          // reload before it resumes the bar: a tab-capture track can end with
          // the document it was opened on, and a bar showing a running timer
          // over a dead recorder is a lie.
          {
            const video = (tabStream?.getVideoTracks() || []).map((t) => t.readyState);
            sendResponse({
              ok: true,
              // Still genuinely capturing? MediaRecorder keeps reporting
              // 'recording' after the tab's video track has ended, and a capture
              // with a dead video track records nothing - so the tracks decide.
              alive: mediaRecorder?.state === 'recording' && video.length > 0 && video.every((s) => s === 'live'),
              state: mediaRecorder?.state || 'none',
              chunks: recordedChunks.length,
              video,
              tabAudio: (tabStream?.getAudioTracks() || []).map((t) => t.readyState),
              mic: (micStream?.getAudioTracks() || []).map((t) => t.readyState),
              elapsedMs: recordingStartMs ? Date.now() - recordingStartMs : 0,
            });
          }
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
// Phase 1: acquire the streams and BUILD the recorders without starting them,
// so the bar can run its 3-2-1 countdown while this (slow) capture setup
// happens. beginRecording() starts everything at "go" for a clean start with
// no clipped first word and no captured dead-time.
async function prepareRecording(streamId, capture = 'tab') {
  log('prepareRecording', { streamId, capture });
  recordedChunks = [];
  audioChunks = [];
  stopRequested = false;

  if (capture === 'window') {
    // 1. A window (or a screen) from Chrome's picker: whatever tab is in front
    //    is what gets recorded. A window has no audio; a tab or a screen picked
    //    here may share its own, which plays on as usual (nothing to re-route).
    try {
      tabStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: true,
        systemAudio: 'exclude',
        surfaceSwitching: 'exclude',
      });
    } catch (err) {
      // The user closed the picker (the mic is asked for only after this).
      if (err?.name === 'NotAllowedError') throw new Error('picker_cancelled');
      throw err;
    }
    // "Stop sharing" in Chrome's bar, or the window closed: save what we have.
    tabStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_ENDED' }).catch(() => {});
    });
  } else {
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

  // Audio-only recorder for server-side transcription. Records JUST the mixed
  // tab+mic audio (dest.stream) as a small opus webm (~1-2 MB for 2 min), so it
  // always fits under OpenAI's 25 MB transcription cap - no video bloat.
  const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  try {
    audioRecorder = new MediaRecorder(new MediaStream(dest.stream.getAudioTracks()), { mimeType: audioMime });
    audioRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
  } catch (err) {
    // Non-fatal: if the audio recorder can't start we just upload without a
    // transcribable track; the brief still files on visual evidence.
    log('audio recorder failed to start:', err);
    audioRecorder = null;
  }

  // Build the mic-level analyser now (started in beginRecording). It taps the
  // MIC (not the mixed dest) so the bar's waveform reacts to the user's voice -
  // and muting the mic flattens it, which is honest feedback.
  try {
    levelAnalyser = audioCtx.createAnalyser();
    levelAnalyser.fftSize = 256;
    levelAnalyser.smoothingTimeConstant = 0.78;
    audioCtx.createMediaStreamSource(micStream).connect(levelAnalyser);
    levelFreq = new Uint8Array(levelAnalyser.frequencyBinCount);
  } catch (err) {
    levelAnalyser = null;
    log('level meter setup failed:', err);
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

  // Streams are live and the recorders are built but NOT started. The bar runs
  // its 3-2-1 countdown, then sends GO -> beginRecording().
}

// Phase 2: actually start capturing. Called on GO, after the bar's countdown.
// Starts both recorders, the keyframe capture, and the live level meter, stamps
// the start time, and tells the bar to switch to the recording UI. This is the
// instant recording truly begins - no countdown audio is captured.
function beginRecording() {
  recordingStartMs = Date.now();
  try { mediaRecorder.start(1000); } catch (err) { log('recorder start failed:', err); }
  if (audioRecorder) {
    try { audioRecorder.start(1000); }
    catch (err) { log('audio recorder start failed:', err); audioRecorder = null; }
  }

  // Start sampling the mic-level analyser (built in prepareRecording) and relay
  // levels to the bar's waveform. Timer, not rAF (offscreen docs throttle rAF).
  if (levelAnalyser && levelFreq) {
    if (levelTimer) clearInterval(levelTimer);
    levelTimer = setInterval(() => {
      levelAnalyser.getByteFrequencyData(levelFreq);
      // Low-mid voice slice (0..255 per bin); the bar mirrors + maps it.
      const bins = Array.from(levelFreq.subarray(0, 48));
      chrome.runtime
        .sendMessage({ target: 'relayToBar', payload: { target: 'bar', type: 'AUDIO_LEVELS', bins } })
        .catch(() => {});
    }, 40);
  }

  keyframes = [];
  startKeyframeCapture();

  if (overrunTimer) clearTimeout(overrunTimer);
  overrunTimer = setTimeout(() => {
    overrunTimer = null;
    chrome.runtime.sendMessage({ type: 'RECORDING_OVERRUN' }).catch(() => {});
  }, OVERRUN_MS);

  // Notify the bar (via background relay) to switch to the recording UI.
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

// Stop the audio-only recorder and wait for its final chunk to flush. A 3s
// safety net guards against onstop never firing on a flaky engine - without it
// collectRecording (on the critical stop/upload path) could hang forever.
function stopAudioRecorder() {
  return new Promise((resolve) => {
    if (!audioRecorder || audioRecorder.state === 'inactive') return resolve();
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(safety); resolve(); };
    const safety = setTimeout(finish, 3000);
    audioRecorder.onstop = finish;
    try { audioRecorder.stop(); } catch { finish(); }
  });
}

// Stop the recorder and hand back the raw results (blob + keyframe blobs).
// Shared by the cloud-upload and legacy-relay paths.
async function collectRecording() {
  log('collectRecording');
  if (overrunTimer) { clearTimeout(overrunTimer); overrunTimer = null; }
  await stopAudioRecorder();
  stopKeyframeCapture();
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }

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
//
// `fileName` is where the video lands in the draft (recording.webm for captures;
// an uploaded file keeps its container: recording.mp4 / .mov). `transcribeBlob`
// overrides what we send for transcription (defaults to the audio-only track).
//
// The newest upload of a brief's recording is the one that counts. A capture
// starts uploading the moment it stops (the video plus a PNG every 2s: big and
// slow); trim it in the editor, or pick another video, and the new file starts
// uploading while the old one may still be going. Whichever finished last used
// to land on the draft, so a slow original took the brief back and the ticket
// got the untrimmed video. An upload that has been superseded goes no further
// and reports nothing.
const latestUpload = new Map(); // briefId -> the newest upload's token
// Make this the newest upload of the brief; true while it still is.
function newUpload(briefId) {
  const me = {};
  latestUpload.set(briefId, me);
  return () => latestUpload.get(briefId) === me;
}
async function uploadAndFinish({ briefId, intent, blob, audioBlob, mimeType, fileName = 'recording.webm', transcribeBlob, keyframes: frames, durationMs, startedAtMs, current = newUpload(briefId) }) {
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

  // Keep the video where the popup can play it back, BEFORE uploading: the
  // reporter can rewatch it while the upload runs, and still rewatch it if the
  // upload fails. The worker prunes it once the brief is filed or reset.
  try {
    if (blob && blob.size && current()) await putFile(recKey(briefId), blob);
  } catch (err) {
    log('stash recording for playback failed:', err?.message || err);
  }

  // Poster (first keyframe, downscaled) so the popup's recording tile shows a
  // real frame right away. Fail-soft: the popup falls back to a generic poster.
  try {
    if (frames && frames[0] && frames[0].blob) {
      const poster = await makePoster(frames[0].blob);
      if (poster && current()) chrome.runtime.sendMessage({ type: 'RECORDING_POSTER', briefId, poster, durationMs }).catch(() => {});
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
    // Screenshots are uploaded by the popup at file time; record their metadata
    // (captions) here so the server has it even before the override payload.
    hasScreenshot: Array.isArray(entry?.screenshots) ? entry.screenshots.length > 0 : false,
    screenshots: Array.isArray(entry?.screenshots)
      ? entry.screenshots.map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated }))
      : [],
    // The "attach the recording" toggle is OFF by default and may be flipped in
    // the popup after this point; the authoritative value is sent at file time.
    // This is just a frozen fallback for retries.
    includeVideo: !!entry?.includeVideo,
    extra: Array.isArray(entry?.extra)
      ? entry.extra.filter((p) => (p.key || '').trim() || (p.value || '').trim())
      : [],
    recording: { file: fileName, mimeType, durationMs },
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
      files.push({ name: fileName, blob, contentType: mimeType });
    }
    if (audioBlob && audioBlob.size) {
      files.push({ name: 'audio.webm', blob: audioBlob, contentType: 'audio/webm' });
    }
    // Screenshots are NOT bundled here - the popup uploads them at file time
    // (uploadFilesToDraft), so a shot taken AFTER recording-stop is never dropped.

    const cloudMeta = {
      title: entry?.name || '',
      transcript: '',
      keyframeCount: keyframeEntries.length,
      hasScreenshot: Array.isArray(entry?.screenshots) ? entry.screenshots.length > 0 : false,
      pageUrl: meta.pageUrl,
      pageTitle: meta.pageTitle,
      description: entry?.description || '',
    };

    // No pairing token: say so plainly. (uploadDraft would otherwise fall back
    // to chrome.storage, which doesn't exist in this document, and the failure
    // would read as "Cannot read properties of undefined".)
    if (!token) throw new Error('Not connected to Brief Cloud');

    // Transient network/server hiccups: retry before declaring failure -
    // there is no local fallback anymore, so we try hard here.
    let cloudBriefId = null;
    let lastErr = null;
    for (const delay of [0, 1500, 5000]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (!current()) break;
      try {
        cloudBriefId = await uploadDraft(files, cloudMeta, token);
        break;
      } catch (err) {
        lastErr = err;
        log('upload attempt failed:', err?.message || err);
      }
    }
    if (!current()) { log('upload superseded by a newer one, dropped'); return; }
    if (!cloudBriefId) throw lastErr || new Error('upload failed');
    log('background upload done', cloudBriefId);
    await chrome.runtime.sendMessage({ type: 'UPLOAD_RESULT', briefId, cloudBriefId }).catch(() => {});

    // Transcribe the audio-only track now so the popup can show + let the user
    // correct the narration immediately. Independent of the upload result; the
    // server still transcribes at file time if we send nothing.
    const tBlob = transcribeBlob !== undefined ? transcribeBlob : audioBlob;
    let said;
    try {
      said = { transcript: tBlob && tBlob.size && token ? (await transcribeNote(tBlob, token)) || '' : '' };
    } catch (err) {
      log('transcription failed:', err?.message || err);
      said = { error: String(err?.message || err) };
    }
    if (current()) await chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId, ...said }).catch(() => {});
  } catch (err) {
    if (!current()) return;
    console.warn('[brief/offscreen] cloud upload failed:', err);
    await chrome.runtime
      .sendMessage({ type: 'UPLOAD_RESULT', briefId, error: String(err?.message || err) })
      .catch(() => {});
  } finally {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_DONE' }).catch(() => {});
  }
}

// ---------- Uploaded video file ----------
// Sample frames from a video file the way the live recorder does (one every
// KEYFRAME_INTERVAL_MS, bounded so a long clip doesn't produce hundreds): seek a
// <video> through the clip and draw each stop to a canvas. Also discovers the
// duration - MediaRecorder webm files often lack a duration header, and Chrome
// only fills `duration` in once it has seeked to the end.
const MAX_SAMPLED_FRAMES = 40;
function videoEvent(v, name, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error(`${name} timeout`)); }, ms);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('video decode error')); };
    const cleanup = () => { clearTimeout(t); v.removeEventListener(name, onOk); v.removeEventListener('error', onErr); };
    v.addEventListener(name, onOk, { once: true });
    v.addEventListener('error', onErr, { once: true });
  });
}
async function sampleVideoFrames(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.style.display = 'none';
  document.body.appendChild(v);
  try {
    const loaded = videoEvent(v, 'loadedmetadata', 10000);
    v.src = url;
    await loaded;
    let duration = v.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      const seeked = videoEvent(v, 'seeked', 10000);
      v.currentTime = 1e9;
      await seeked;
      duration = Number.isFinite(v.duration) ? v.duration : 0;
    }
    const durationMs = Math.round(duration * 1000);
    const frames = [];
    if (duration > 0 && v.videoWidth && v.videoHeight) {
      const stepS = Math.max(KEYFRAME_INTERVAL_MS / 1000, duration / MAX_SAMPLED_FRAMES);
      const maxW = 1280;
      const scale = Math.min(1, maxW / v.videoWidth);
      const cw = Math.round(v.videoWidth * scale), ch = Math.round(v.videoHeight * scale);
      for (let t = 0; t < duration && frames.length < MAX_SAMPLED_FRAMES; t += stepS) {
        const seeked = videoEvent(v, 'seeked', 5000);
        v.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        await seeked;
        const canvas = new OffscreenCanvas(cw, ch);
        canvas.getContext('2d').drawImage(v, 0, 0, cw, ch);
        frames.push({ timestamp: Math.round(t * 1000), blob: await canvas.convertToBlob({ type: 'image/png' }) });
      }
    }
    return { durationMs, frames };
  } finally {
    try { v.removeAttribute('src'); v.load(); } catch {}
    v.remove();
    URL.revokeObjectURL(url);
  }
}

// OpenAI's transcription cap; QuickTime isn't a container it decodes.
const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;
async function uploadFileAndFinish({ briefId, key, blob, fileName, mimeType }) {
  // the newest from now on, not once its frames are sampled (that takes a while)
  const current = newUpload(briefId);
  let durationMs = 0;
  let frames = [];
  try {
    ({ durationMs, frames } = await sampleVideoFrames(blob));
  } catch (err) {
    // Fail-soft: the video still uploads; the ticket leans on the transcript +
    // description instead of a storyboard.
    log('frame sampling failed:', err?.message || err);
  }
  const transcribable = blob.size <= TRANSCRIBE_MAX_BYTES && /^video\/(webm|mp4)$/.test(mimeType);
  // The file already sits in the blob store under this brief's recording key
  // (the popup parked it there), so it stays playable - nothing to clean up here.
  await uploadAndFinish({
    briefId,
    intent: 'brief',
    blob,
    audioBlob: null,
    mimeType,
    fileName,
    transcribeBlob: transcribable ? blob : null,
    keyframes: frames,
    durationMs,
    startedAtMs: Date.now() - durationMs,
    current,
  });
}

async function cancelRecording() {
  log('cancelRecording');
  if (overrunTimer) { clearTimeout(overrunTimer); overrunTimer = null; }
  stopKeyframeCapture();
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
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
  levelAnalyser = null;
  levelFreq = null;
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
