// Brief - bar (UI only)
//
// All recording happens in the offscreen document (chrome-extension origin,
// immune to page Permissions-Policy). The bar sends control messages via
// background.js; the offscreen document uploads the finished draft itself.

import { getDraft, setDraft, emptyDraft, landRecording } from './draft.js';

const SAVED_AUTODISMISS_MS = 5000;

// ---------- Params ----------
const params = new URLSearchParams(location.hash.slice(1));
const streamId = params.get('streamId');
const intent = params.get('intent') || 'brief';
const mode = params.get('mode') || 'ship'; // 'ship' | 'inbox'
const itemId = params.get('itemId') || '';
// 'tab' (this tab, tabCapture) or 'window' (Chrome's picker; the bar follows the
// active tab, so a window recording's bar is often a resumed one).
const capture = params.get('capture') === 'window' ? 'window' : 'tab';
// Resume: the page reloaded mid-recording. The offscreen recorder never stopped;
// this bar just picks the UI back up (timer from the original start, mute state).
const resume = params.get('resume') === '1';
const resumeStartedAt = Number(params.get('startedAt')) || 0;
const resumeMuted = params.get('muted') === '1';

// ---------- DOM ----------
const body = document.body;
const stopBtn = document.getElementById('stopBtn');
const muteBtn = document.getElementById('muteBtn');
const cancelBtn = document.getElementById('cancelBtn');
const closeBtn = document.getElementById('closeBtn');
const errCloseBtn = document.getElementById('errCloseBtn');
const timerEl = document.getElementById('timer');
const waveEl = document.getElementById('wave');
const errTextEl = document.getElementById('errText');

// ---------- State ----------
const briefId = itemId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let recordingStartMs = 0;
let surface = null;         // what the window picker gave: 'window' | 'monitor' | 'browser'
let timerInterval = null;
let muted = false;
let savedDismissTimer = null;
let stopping = false;       // guards stopAndSave against double-invocation
let cancelled = false;      // set if the user cancels during the countdown
let countdownTimer = null;
let countdownResolve = null; // resolves the countdown promise early on cancel

// ---------- Iframe sizing ----------
function postToParent(type, payload = {}) {
  window.parent.postMessage({ app: 'brief', type, ...payload }, '*');
}
function closeParent() { postToParent('close'); }


// The iframe is a FIXED bottom strip sized by the content script; the bar no
// longer resizes it. #root just lays out inside that strip. scheduleResize is
// kept as a no-op so existing callers (setView) don't need changing.
function scheduleResize() {}

// ---------- View routing ----------
function setView(name) {
  body.className = `state-${name}`;
  scheduleResize();
  if (savedDismissTimer && name !== 'saved' && name !== 'inboxed') {
    clearTimeout(savedDismissTimer);
    savedDismissTimer = null;
  }
}
function showError(message) {
  errTextEl.textContent = message;
  setView('error');
  setTimeout(closeParent, 6000);
}

// Update the text shown in the "saving" pill (used for cloud upload progress).
function setSavingText(message) {
  const el = document.querySelector('[data-state="saving"] .state-text');
  if (el) el.textContent = message;
}

// Show a filed-ticket success in the "saving" pill with a clickable identifier.
// The bar is a content script with no chrome.tabs access, so the link click is
// routed to the background service worker, which opens the ticket in a new tab.
function setSavingTicketLink(identifier, url) {
  const el = document.querySelector('[data-state="saving"] .state-text');
  if (!el) return;
  el.textContent = '';
  const ok = document.createElement('strong');
  ok.textContent = '✓';
  const link = document.createElement('a');
  link.href = url;
  link.textContent = `${identifier} created`;
  link.className = 'ticket-link';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'open-url', url }).catch(() => {});
  });
  el.appendChild(ok);
  el.appendChild(document.createTextNode(' '));
  el.appendChild(link);
}


// ---------- Offscreen control ----------
async function sendToOffscreen(type, extra = {}) {
  return chrome.runtime.sendMessage({ target: 'offscreen', type, ...extra });
}

// ---------- Init ----------
// Declared here, CALLED AT THE BOTTOM of this file - never inline. The resume
// path starts the timer and the waveform immediately, and both read module
// constants (MAX_RECORDING_SECONDS, WAVE_BARS, the built wave bars...) declared
// further down. Running init during module evaluation threw a temporal-dead-zone
// ReferenceError that left a resumed bar frozen: the timer never ticked and the
// waveform never drew, so a live recording looked dead.
async function init() {
  if (resume) {
    recordingStartMs = resumeStartedAt || Date.now();
    if (resumeMuted) { muted = true; muteBtn?.classList.add('active'); }
    setView('recording');
    startTimer();
    startWave();
    // Show the recording UI first (instant), then confirm with the recorder that
    // it really is still capturing. A tab capture normally survives a reload, but
    // if this one didn't, save what was recorded rather than run a timer over a
    // dead recorder.
    let st = null;
    try { st = await sendToOffscreen('GET_REC_STATE'); } catch {}
    if (st?.ok && st.alive) return;
    stopTimer();
    stopWave();
    if (st?.ok && st.chunks > 0) {
      stopAndSave('Reload ended the capture — saving…');
    } else {
      chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
      showError('The reload ended the recording before anything was captured.');
    }
    return;
  }
  if (!streamId && capture === 'tab') { showError('Missing stream ID.'); return; }
  setView('loading');
  try {
    const res = await sendToOffscreen('START', { streamId, capture });
    if (!res?.ok) {
      const err = res?.error || 'unknown_error';
      if (err === 'picker_cancelled') {
        // Closed Chrome's window picker: nothing to say.
        chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
        closeParent();
        return;
      } else if (/NotAllowedError|not allowed|permission/i.test(err)) {
        // Mic denied at the extension origin level. Open the permission
        // page in a new tab so the user can grant it there (Jam-style),
        // and close the bar - no point keeping it on screen.
        chrome.runtime.sendMessage({ type: 'OPEN_PERMISSION_PAGE' }).catch(() => {});
        closeParent();
        return;
      } else if (/NotFoundError/i.test(err)) {
        showError('No microphone found.');
      } else {
        showError(err);
      }
      return;
    }
    // Streams are prepared (not yet capturing). Run the 3-2-1 pre-roll, then
    // tell offscreen to GO - recording starts clean at zero. A cancel during
    // the countdown sets `cancelled` and we never send GO.
    surface = res.surface || null;
    await runCountdown();
    if (cancelled) return;
    await sendToOffscreen('GO');
    // RECORDING_STARTED will arrive shortly and we transition to recording UI.
  } catch (err) {
    console.error('[brief/bar] start failed:', err);
    showError(String(err?.message || err));
  }
}

// ---------- Listen for messages from offscreen (via background) ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'bar') return false;

  if (message.type === 'RECORDING_STARTED') {
    recordingStartMs = message.startedAt || Date.now();
    chrome.runtime.sendMessage({ type: 'BRIEF_START', briefId, startedAt: recordingStartMs, capture, surface }).catch(() => {});
    setView('recording');
    startTimer();
    startWave();
  } else if (message.type === 'CAPTURE_ENDED') {
    // Chrome's "Stop sharing", or the recorded window closed.
    if (recordingStartMs) stopAndSave('Sharing stopped. Saving…');
    else cancelAll();
  } else if (message.type === 'AUDIO_LEVELS') {
    waveFreq = message.bins;
    waveLastMsgMs = Date.now();
    let peak = 0;
    for (const b of message.bins) if (b > peak) peak = b;
    if (peak >= SPEAK_LEVEL) waveLastLoudMs = waveLastMsgMs;
  }
  sendResponse({ ok: true });
  return false;
});

// ---------- Timer ----------
const MAX_RECORDING_SECONDS = 120; // hard 2-minute cap

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const total = Math.max(0, Math.floor((Date.now() - recordingStartMs) / 1000));
    timerEl.textContent =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    // Only the bar on screen stops it: a window recording has one in every tab.
    if (total >= MAX_RECORDING_SECONDS && document.visibilityState === 'visible') {
      stopAndSave('2 min limit reached — saving…');
    }
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

// ---------- Countdown (pre-roll before recording starts) ----------
// Shows "Describe your brief" + 3 → 2 → 1 (~0.7s each), then resolves so init()
// sends GO and offscreen actually starts capturing. Resolves early if cancelled.
function runCountdown() {
  setView('countdown');
  const numEl = document.getElementById('cdNum');
  return new Promise((resolve) => {
    countdownResolve = resolve;
    let n = 3;
    const step = () => {
      if (cancelled || n === 0) { resolve(); return; }
      if (numEl) numEl.textContent = String(n);
      n -= 1;
      countdownTimer = setTimeout(step, 700);
    };
    step();
  });
}

// ---------- Waveform ----------
// Thin bars that follow the user's voice. The offscreen document owns the mic
// (it's immune to host-page Permissions-Policy, unlike this iframe) and relays
// frequency levels as AUDIO_LEVELS messages; we just draw. Before the first
// message lands (startup handshake / silence) a gentle idle shimmer keeps the
// bar feeling alive.
const WAVE_BARS = 18;
const WAVE_MAX_H = 20;        // px, tallest a bar gets at full volume
const SPEAK_LEVEL = 55;       // 0..255 mic peak above this counts as "speaking"
const SILENCE_MS = 900;       // keep the wave up this long after the last peak
const waveBarsContainer = document.getElementById('waveBars');
const waveBars = [];
let waveLevels = new Array(WAVE_BARS).fill(0);
let waveFreq = null;          // latest frequency bytes from offscreen
let waveLastMsgMs = 0;
let waveLastLoudMs = 0;       // last time the mic crossed SPEAK_LEVEL
let waveRaf = null;

(function buildWave() {
  if (!waveBarsContainer) return;
  for (let i = 0; i < WAVE_BARS; i++) {
    const el = document.createElement('i');
    waveBarsContainer.appendChild(el);
    waveBars.push(el);
  }
})();

function startWave() {
  if (!waveBarsContainer || waveRaf) return;
  const mid = (WAVE_BARS - 1) / 2;
  const draw = () => {
    const now = Date.now();
    const live = waveFreq && now - waveLastMsgMs < 400;
    // Light the bars while speaking: stay "speaking" for SILENCE_MS after the
    // last voice peak so pauses between words don't flicker them.
    // (No startup dwell needed - the 3-2-1 countdown already showed the prompt.)
    const speaking = now - waveLastLoudMs < SILENCE_MS;
    if (waveEl) waveEl.classList.toggle('speaking', speaking);
    for (let i = 0; i < WAVE_BARS; i++) {
      // Mirror around centre, sampling the low-mid voice bins - punchy. When
      // there's no live data the bars rest flat (and dim).
      let target = 3;
      if (live) {
        const dist = Math.abs(i - mid);
        const v = (waveFreq[2 + Math.floor(dist * 1.6)] || 0) / 255;
        target = 3 + Math.pow(v, 1.4) * WAVE_MAX_H;
      }
      waveLevels[i] += (target - waveLevels[i]) * 0.35; // smoothing
      waveBars[i].style.height = waveLevels[i].toFixed(1) + 'px';
    }
    waveRaf = requestAnimationFrame(draw);
  };
  draw();
}

function stopWave() {
  if (waveRaf) cancelAnimationFrame(waveRaf);
  waveRaf = null;
  waveFreq = null;
  waveLastLoudMs = 0;
  waveLevels = new Array(WAVE_BARS).fill(0);
  if (waveEl) waveEl.classList.remove('speaking');
}

// ---------- Mute ----------
muteBtn?.addEventListener('click', async () => {
  muted = !muted;
  await sendToOffscreen('MUTE', { muted });
  muteBtn.classList.toggle('active', muted);
});
// A window recording has a bar in every tab: muted in one, muted in all (the
// worker keeps it in the live session).
chrome.storage.onChanged.addListener((changes, area) => {
  const s = area === 'session' ? changes.recSession?.newValue : null;
  if (!s || s.briefId !== briefId || !!s.muted === muted) return;
  muted = !!s.muted;
  muteBtn?.classList.toggle('active', muted);
});

// ---------- Drag-to-move ----------
// The whole pill is the handle, its buttons excepted.
const dragHandle = document.querySelector('.bar');
let dragging = false;

dragHandle?.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || e.target.closest('button, a')) return;
  e.preventDefault();
  dragging = true;
  document.body.classList.add('dragging');
  // Tell content.js where in the iframe the grab happened so it can move the
  // whole iframe to follow the cursor (cursor will leave this small iframe).
  postToParent('dragStart', { grabX: e.clientX, grabY: e.clientY });
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
});

// ---------- Stop & save ----------
// Single stop path, shared by the Stop button and the 2-minute cap. Guarded so
// the cap firing at the same instant as a manual click can't double-upload.
async function stopAndSave(savingMessage) {
  if (stopping) return;
  stopping = true;
  if (stopBtn) stopBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  stopTimer();
  stopWave();
  if (savingMessage) setSavingText(savingMessage);
  setView('saving'); // show feedback immediately while the recorder flushes
  const res = await sendToOffscreen('STOP', { briefId, intent });
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  if (res?.ok) {
    // Cloud-only: the offscreen document uploads the draft in the BACKGROUND
    // (it holds the blob and outlives this bar). Mark the inbox entry as
    // uploading and close immediately - no waiting, no local zip.
    await finishToInbox(briefId, intent, undefined, { uploading: true });
  } else {
    showError(res?.error || 'Could not save the recording.');
  }
}

stopBtn?.addEventListener('click', () => { stopAndSave(); });

// ---------- Cancel ----------
// Shared by the recording-state X and the countdown-state X. Works in either
// phase: during the countdown it sets `cancelled` (so init never sends GO) and
// tears down the prepared streams; during recording it discards the capture.
async function cancelAll() {
  if (cancelled) return;
  cancelled = true;
  stopping = true;
  if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
  if (countdownResolve) { countdownResolve(); countdownResolve = null; }
  if (cancelBtn) cancelBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  stopTimer();
  stopWave();
  await sendToOffscreen('CANCEL');
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  setView('cancelled');
  setTimeout(closeParent, 2000);
}
cancelBtn?.addEventListener('click', cancelAll);
document.getElementById('cdCancelBtn')?.addEventListener('click', cancelAll);

closeBtn?.addEventListener('click', closeParent);
errCloseBtn?.addEventListener('click', closeParent);
document.getElementById('inboxCloseBtn')?.addEventListener('click', closeParent);

// ---------- Inbox: mark this ticket recorded ----------
// `cloudBriefId` (optional): when the recording was uploaded to Brief Cloud as a
// draft, we stash its cloud id on the entry so the popup's "Create ticket" can
// file THIS already-uploaded brief instead of re-uploading.
// `opts.uploading`: the upload is running in the BACKGROUND (offscreen) - the
// entry is flagged so the popup shows progress and defers filing until the
// cloud id lands (background clears the flag via UPLOAD_RESULT).
async function finishToInbox(id, intent, cloudBriefId, opts = {}) {
  try {
    // One brief at a time: the recording belongs to the CURRENT draft (the popup
    // started it with this id). Mark the recording landed; the upload +
    // transcription run in the background and report back via the worker.
    let d = await getDraft();
    if (!d) { d = emptyDraft(); d.id = id; }
    if (d.id === id) {
      // Shared with the worker-driven stop (tab closed mid-recording) so both
      // produce the same draft: recording landed, upload + transcription pending.
      landRecording(d, { uploading: !!opts.uploading });
      if (cloudBriefId && !opts.uploading) d.cloudBriefId = cloudBriefId;
      await setDraft(d);
    }
    // Best-effort: bring the user back to the brief to review. Chrome only allows
    // openPopup in some versions/contexts; it silently no-ops otherwise (the
    // toolbar badge still nudges).
    chrome.runtime.sendMessage({ type: 'REOPEN_POPUP', briefId: id }).catch(() => {});
  } catch (err) {
    console.warn('[brief/bar] draft write failed:', err);
  }
  // No confirmation toast - just close the bar. The badge updates and (where
  // allowed) the popup reopens, so the user already sees the saved brief.
  closeParent();
}

// Everything above is declared; NOW start. (See the note on init().)
init();
