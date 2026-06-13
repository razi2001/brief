// Brief - bar (UI only)
//
// All recording happens in the offscreen document (chrome-extension origin,
// immune to page Permissions-Policy). The bar sends control messages via
// background.js; the offscreen document uploads the finished draft itself.


const SAVED_AUTODISMISS_MS = 5000;

// ---------- Params ----------
const params = new URLSearchParams(location.hash.slice(1));
const streamId = params.get('streamId');
const intent = params.get('intent') || 'brief';
const mode = params.get('mode') || 'ship'; // 'ship' | 'inbox'
const itemId = params.get('itemId') || '';

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
let timerInterval = null;
let muted = false;
let savedDismissTimer = null;
let stopping = false;       // guards stopAndSave against double-invocation

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
(async function init() {
  if (!streamId) { showError('Missing stream ID.'); return; }
  setView('loading');
  try {
    const res = await sendToOffscreen('START', { streamId });
    if (!res?.ok) {
      const err = res?.error || 'unknown_error';
      if (/NotAllowedError|not allowed|permission/i.test(err)) {
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
    // RECORDING_STARTED message will arrive shortly and we transition to recording UI
  } catch (err) {
    console.error('[brief/bar] start failed:', err);
    showError(String(err?.message || err));
  }
})();

// ---------- Listen for messages from offscreen (via background) ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'bar') return false;

  if (message.type === 'RECORDING_STARTED') {
    recordingStartMs = message.startedAt || Date.now();
    chrome.runtime.sendMessage({ type: 'BRIEF_START', briefId, startedAt: recordingStartMs }).catch(() => {});
    setView('recording');
    startTimer();
    startWave();
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
    if (total >= MAX_RECORDING_SECONDS) {
      stopAndSave('2 min limit reached — saving…');
    }
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

// ---------- Waveform ----------
// Thin bars that follow the user's voice. The offscreen document owns the mic
// (it's immune to host-page Permissions-Policy, unlike this iframe) and relays
// frequency levels as AUDIO_LEVELS messages; we just draw. Before the first
// message lands (startup handshake / silence) a gentle idle shimmer keeps the
// bar feeling alive.
const WAVE_BARS = 24;
const WAVE_MAX_H = 22;        // px, tallest a bar gets at full volume
const SPEAK_LEVEL = 55;       // 0..255 mic peak above this counts as "speaking"
const SILENCE_MS = 900;       // keep the wave up this long after the last peak
const HINT_DWELL_MS = 2000;   // min time the CTA hint stays up at recording start
const waveBarsContainer = document.getElementById('waveBars');
const waveBars = [];
let waveLevels = new Array(WAVE_BARS).fill(0);
let waveFreq = null;          // latest frequency bytes from offscreen
let waveLastMsgMs = 0;
let waveLastLoudMs = 0;       // last time the mic crossed SPEAK_LEVEL
let waveStartMs = 0;          // when the current wave (recording) started
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
  waveStartMs = Date.now();
  const mid = (WAVE_BARS - 1) / 2;
  const draw = () => {
    const now = Date.now();
    const live = waveFreq && now - waveLastMsgMs < 400;
    // Crossfade the "Describe your brief…" hint and the bars: stay in "speaking"
    // for SILENCE_MS after the last voice peak so pauses between words don't
    // flicker the hint back in. But pin the hint for the first HINT_DWELL_MS no
    // matter what - recording auto-starts the instant the bar appears, so
    // without this dwell the wave takes over before the prompt can be read.
    const inDwell = now - waveStartMs < HINT_DWELL_MS;
    const speaking = !inDwell && now - waveLastLoudMs < SILENCE_MS;
    if (waveEl) waveEl.classList.toggle('speaking', speaking);
    for (let i = 0; i < WAVE_BARS; i++) {
      // Mirror around centre, sampling the low-mid voice bins - punchy. When
      // there's no live data the bars rest flat (hidden behind the hint).
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
  waveStartMs = 0;
  waveLevels = new Array(WAVE_BARS).fill(0);
  if (waveEl) waveEl.classList.remove('speaking');
}

// ---------- Mute ----------
muteBtn?.addEventListener('click', async () => {
  muted = !muted;
  await sendToOffscreen('MUTE', { muted });
  muteBtn.classList.toggle('active', muted);
});

// ---------- Drag-to-move ----------
const dragGrip = document.getElementById('dragGrip');
let dragging = false;

dragGrip?.addEventListener('mousedown', (e) => {
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
cancelBtn?.addEventListener('click', async () => {
  stopping = true;
  cancelBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  stopTimer();
  stopWave();
  await sendToOffscreen('CANCEL');
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  setView('cancelled');
  setTimeout(closeParent, 2000);
});

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
    const { inbox } = await chrome.storage.local.get('inbox');
    const list = Array.isArray(inbox) ? inbox : [];
    const entry = list.find((b) => b.id === id);
    if (entry) {
      // Was added as a draft from the popup - flip it to recorded/ready.
      entry.recorded = true;
      entry.hasRecording = true;
      entry.recordedAt = Date.now();
      entry.intent = intent;
      if (cloudBriefId) entry.cloudBriefId = cloudBriefId;
      if (opts.uploading) {
        entry.uploading = true;
        delete entry.uploadFailed;
        delete entry.uploadError;
      }
    } else {
      // Fallback: recording started without a pre-named draft (shouldn't
      // normally happen now, but keep the brief rather than lose it).
      list.push({ id, intent, name: '', recorded: true, hasRecording: true, addedAt: Date.now(), recordedAt: Date.now(), cloudBriefId, ...(opts.uploading ? { uploading: true } : {}) });
    }
    await chrome.storage.local.set({ inbox: list });
    chrome.runtime.sendMessage({ type: 'INBOX_CHANGED' }).catch(() => {});
    // Best-effort: bring the user back to the brief to review/export. Chrome
    // only allows openPopup in some versions/contexts; it silently no-ops
    // otherwise (the toolbar badge still nudges).
    // Carry the brief id along so background can tag this open as
    // "post-capture" - popup uses it to auto-expand the right brief.
    chrome.runtime.sendMessage({ type: 'REOPEN_POPUP', briefId: id }).catch(() => {});
  } catch (err) {
    console.warn('[brief/bar] inbox write failed:', err);
  }
  // No confirmation toast - just close the bar. The badge updates and (where
  // allowed) the popup reopens, so the user already sees the saved brief.
  closeParent();
}
