// Brief — bar (UI only)
//
// All recording happens in the offscreen document (chrome-extension origin,
// immune to page Permissions-Policy). The bar sends control messages via
// background.js and receives transcript updates + the final blob back.

import { makeZip } from './lib/zip.js';

const SAVED_AUTODISMISS_MS = 5000;

// ---------- Params ----------
const params = new URLSearchParams(location.hash.slice(1));
const streamId = params.get('streamId');
let currentLang = params.get('lang') || 'en-US';
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
const langPills = Array.from(document.querySelectorAll('.lang-pill'));
const transcriptText = document.getElementById('transcriptText');
const transcriptPanel = document.getElementById('transcriptPanel');
const errTextEl = document.getElementById('errText');

// ---------- State ----------
const briefId = itemId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let recordingStartMs = 0;
let timerInterval = null;
let muted = false;
let savedDismissTimer = null;
let transcriptFinalCache = '';
let transcriptInterimCache = '';
let transcriptChunksCache = [];
let recognizer = null;
let recognitionShouldRun = false;
// Guard: RECORDING_FINISHED can arrive twice (offscreen broadcasts via
// chrome.runtime.sendMessage which reaches the bar directly, AND background
// also tab-relays to all frames in the tab). We only want to build/download
// the zip once.
let finishHandled = false;

// ---------- Language pills (choose EN/FR for speech recognition) ----------
function paintLangPills() {
  langPills.forEach((p) => p.classList.toggle('active', p.dataset.lang === currentLang));
}
paintLangPills();
langPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const next = pill.dataset.lang;
    if (next === currentLang) return;
    currentLang = next;
    paintLangPills();
    chrome.storage.local.set({ lang: currentLang });
    // Restart recognition in the new language if we're mid-recording.
    if (recognitionShouldRun) {
      startSpeechRecognition();
    }
  });
});

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
  if (transcriptPanel) transcriptPanel.hidden = name !== 'recording';
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

// ---------- Offscreen control ----------
async function sendToOffscreen(type, extra = {}) {
  return chrome.runtime.sendMessage({ target: 'offscreen', type, ...extra });
}

// ---------- Init ----------
(async function init() {
  if (!streamId) { showError('Missing stream ID.'); return; }
  setView('loading');
  try {
    const res = await sendToOffscreen('START', { streamId, lang: currentLang });
    if (!res?.ok) {
      const err = res?.error || 'unknown_error';
      if (/NotAllowedError|not allowed|permission/i.test(err)) {
        // Mic denied at the extension origin level. Open the permission
        // page in a new tab so the user can grant it there (Jam-style),
        // and close the bar — no point keeping it on screen.
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
    // Start speech recognition here in the bar — it doesn't work in offscreen
    // documents (they're invisible and SR silently fails to produce results).
    startSpeechRecognition();
  } else if (message.type === 'TRANSCRIPT_UPDATE') {
    // Legacy path from offscreen, kept for safety
    transcriptFinalCache = message.final || '';
    transcriptInterimCache = message.interim || '';
    renderTranscript(transcriptFinalCache, transcriptInterimCache);
  } else if (message.type === 'RECORDING_FINISHED') {
    // Dedupe: this message can arrive multiple times via different relay paths
    if (finishHandled) {
      sendResponse({ ok: true });
      return false;
    }
    finishHandled = true;
    handleRecordingFinished(message).catch((err) => {
      console.error('[brief/bar] finish failed:', err);
      showError(String(err?.message || err));
    });
  }
  sendResponse({ ok: true });
  return false;
});

// ---------- Timer ----------
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const total = Math.max(0, Math.floor((Date.now() - recordingStartMs) / 1000));
    timerEl.textContent =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

// ---------- Speech recognition (in the bar, NOT in offscreen) ----------
function startSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    renderTranscript('', '', 'Speech recognition not available.');
    return;
  }
  // Tear down any previous recognizer cleanly so its onend can't auto-restart
  // a stale (wrong-language) instance.
  if (recognizer) {
    try { recognizer.onend = null; recognizer.onresult = null; recognizer.onerror = null; recognizer.stop(); } catch {}
    recognizer = null;
  }
  recognizer = new Recognition();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = currentLang;
  recognitionShouldRun = true;

  recognizer.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript;
      if (r.isFinal) {
        const trimmed = text.trim();
        if (trimmed) {
          transcriptChunksCache.push({
            tMs: Date.now() - recordingStartMs,
            text: trimmed,
          });
        }
        transcriptFinalCache += text;
      } else {
        interim += text;
      }
    }
    transcriptInterimCache = interim;
    renderTranscript(transcriptFinalCache, transcriptInterimCache);
  };

  recognizer.onerror = (e) => {
    // 'not-allowed' on some pages (Permissions-Policy blocks SR in iframes
    // on certain sites). Don't spam logs and don't restart — recording
    // continues fine without live transcription; Whisper can transcribe
    // from the audio later if needed.
    if (e.error === 'not-allowed') {
      recognitionShouldRun = false;
      renderTranscript('', '', 'Recording (live transcript unavailable on this site)');
      return;
    }
    if (e.error === 'no-speech' || e.error === 'audio-capture') {
      // Recoverable — let onend restart
      return;
    }
    console.warn('[brief/bar] SR error:', e.error);
  };

  recognizer.onend = () => {
    if (recognitionShouldRun) {
      try { recognizer.start(); } catch {}
    }
  };

  try { recognizer.start(); } catch (err) {
    console.warn('[brief/bar] SR start failed:', err);
  }
}

// Resolves once the recognizer has finished processing buffered audio —
// recognizer.stop() is async and the FINAL onresult events fire AFTER it
// returns. Without waiting, the last spoken words get truncated. A 2s
// safety net guards against onend never firing on flaky engines.
function stopSpeechRecognition() {
  recognitionShouldRun = false;
  const r = recognizer;
  if (!r) return Promise.resolve();
  recognizer = null;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { r.onend = null; r.onerror = null; } catch {}
      resolve();
    };
    const safety = setTimeout(finish, 2000);
    r.onend = () => { clearTimeout(safety); finish(); };
    // onresult is left attached so any buffered final chunks still land
    // in transcriptFinalCache / transcriptChunksCache before onend fires.
    try { r.stop(); } catch { clearTimeout(safety); finish(); }
  });
}

// ---------- Transcript ticker ----------
function renderTranscript(finalText, interimText, placeholder) {
  if (!transcriptText) return;
  if (placeholder) {
    transcriptText.innerHTML = `<span class="placeholder">${placeholder}</span>`;
    return;
  }
  const finalTrim = (finalText || '').trim();
  const interimTrim = (interimText || '').trim();
  if (!finalTrim && !interimTrim) {
    transcriptText.innerHTML = '<span class="placeholder">Listening…</span>';
    return;
  }
  let ticker = transcriptText.querySelector('.ticker');
  if (!ticker) {
    transcriptText.innerHTML = '<span class="ticker"></span>';
    ticker = transcriptText.querySelector('.ticker');
  }
  // Final text in cream, interim text in muted italic via .interim child
  const finalPart = finalTrim ? `<span class="final">${escapeHtml(finalTrim)}</span>` : '';
  const sep = finalTrim && interimTrim ? ' ' : '';
  const interimPart = interimTrim ? `<span class="interim">${escapeHtml(interimTrim)}</span>` : '';
  ticker.innerHTML = `${finalPart}${sep}${interimPart}`;
  // Pin right edge of growing text to viewport edge — older text scrolls left
  requestAnimationFrame(() => {
    const viewport = transcriptText.offsetWidth;
    const lineW = ticker.scrollWidth;
    const dx = Math.max(0, lineW - viewport);
    ticker.style.transform = `translateX(-${dx}px)`;
  });
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
stopBtn?.addEventListener('click', async () => {
  stopBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  stopTimer();
  setView('saving'); // show feedback immediately while transcription flushes
  await stopSpeechRecognition(); // <- wait for buffered final chunks to land
  await sendToOffscreen('STOP', {
    transcriptFinal: transcriptFinalCache,
    transcriptChunks: transcriptChunksCache,
  });
  // The finished payload comes back via RECORDING_FINISHED message
});

// ---------- Cancel ----------
cancelBtn?.addEventListener('click', async () => {
  cancelBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  stopTimer();
  stopSpeechRecognition();
  await sendToOffscreen('CANCEL');
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  setView('cancelled');
  setTimeout(closeParent, 2000);
});

closeBtn?.addEventListener('click', closeParent);
errCloseBtn?.addEventListener('click', closeParent);
document.getElementById('inboxCloseBtn')?.addEventListener('click', closeParent);

// ---------- Skill bundling ----------
// The canonical skill files ship inside the extension; we fetch them and add
// them to each brief zip so the brief is self-contained and install-free.
const SKILL_FILES = [
  'skill/SKILL.md',
  'skill/playbooks/ticket.md',
  'skill/playbooks/inbox.md',
];

async function loadSkillEntries() {
  const entries = [];
  for (const rel of SKILL_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(rel));
      const text = await res.text();
      entries.push({ name: rel, data: new TextEncoder().encode(text) });
    } catch (err) {
      console.warn('[brief/bar] could not bundle skill file', rel, err);
    }
  }
  return entries;
}

// Dropped into each brief folder so any agent (Claude Code, Cursor, etc.) that
// opens it knows what this is and how to act on it.
const BRIEF_README = `# Brief

This folder is a voice+screen "brief" recorded with the Brief browser extension.
It contains everything needed to file a tracker ticket from it.

## What's here
- \`brief.json\` — transcript, screen keyframes (with timestamps), page URL/title,
  the click/scroll/keypress event log, and recording metadata.
- \`recording.webm\` — the raw screen recording with mic audio.
- \`keyframes/\` — PNG snapshots referenced by brief.json.
- \`skill/\` — the playbook for turning this brief into a high-quality ticket.

## How to act on it (for the AI agent reading this)
Read \`skill/SKILL.md\` and follow it. In short: read brief.json, scan the
keyframes (binary-search the timestamps around the moment described in the
transcript), then file ONE ticket in the user's connected tracker (Linear /
Jira / GitHub / Notion) with the screenshots embedded inline. Don't ask
clarifying questions about team/project — infer from the workspace.

When multiple briefs are processed together, see \`skill/playbooks/inbox.md\`.
`;

// ---------- Build zip + save ----------
async function handleRecordingFinished({ recordingB64, mimeType, durationMs, transcriptFinal, transcriptChunks, keyframes }) {
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});

  // Get the event list + page meta from background
  let meta = { events: [], pageUrl: null, pageTitle: null };
  try {
    meta = await chrome.runtime.sendMessage({ type: 'GET_BRIEF_META' });
  } catch {}

  // Decode recording from base64
  const recordingBytes = base64ToBytes(recordingB64);
  const recordingBlob = new Blob([recordingBytes], { type: mimeType || 'video/webm' });

  // Decode keyframes
  const keyframeEntries = [];
  const keyframeMeta = [];
  for (let i = 0; i < (keyframes || []).length; i++) {
    const k = keyframes[i];
    const bytes = base64ToBytes(k.base64);
    const name = `keyframes/keyframe-${String(i).padStart(3, '0')}.png`;
    keyframeEntries.push({ name, data: bytes });
    keyframeMeta.push({ index: i, timestamp: k.timestamp, file: name });
  }

  // brief.json
  // Pull any description / screenshot the user added in the popup for this
  // brief, so a recording brief is also self-contained with that context.
  let userDescription = '';
  let userScreenshot = '';
  let userScreenshotAnnotated = false;
  let userExtra = [];
  try {
    const { inbox } = await chrome.storage.local.get('inbox');
    const entry = (Array.isArray(inbox) ? inbox : []).find((b) => b.id === briefId);
    if (entry) {
      userDescription = entry.description || '';
      userScreenshot = entry.screenshot || '';
      userScreenshotAnnotated = !!entry.screenshotAnnotated;
      userExtra = Array.isArray(entry.extra) ? entry.extra.filter((p) => p.key.trim() || p.value.trim()) : [];
    }
  } catch {}

  const briefJson = {
    id: briefId,
    schemaVersion: 2,
    createdAt: new Date(recordingStartMs).toISOString(),
    durationMs,
    intent,
    pageUrl: meta.pageUrl,
    pageTitle: meta.pageTitle,
    userAgent: navigator.userAgent,
    transcriptLang: currentLang,
    transcript: transcriptFinal || null,
    transcriptChunks: transcriptChunks || [],
    keyframes: keyframeMeta,
    events: meta.events || [],
    description: userDescription,
    hasScreenshot: !!userScreenshot,
    screenshotAnnotated: userScreenshotAnnotated,
    extra: userExtra,
    recording: { file: 'recording.webm', mimeType: mimeType || 'video/webm', durationMs },
  };

  const briefBytes = new TextEncoder().encode(JSON.stringify(briefJson, null, 2));
  const recordingArr = new Uint8Array(await recordingBlob.arrayBuffer());

  // Bundle the skill into every brief so it's self-contained: any agent with
  // local file access can read skill/SKILL.md and file the ticket — no install.
  const skillEntries = await loadSkillEntries();

  // A short, agent-agnostic pointer so whoever opens the folder knows what to do.
  const readmeBytes = new TextEncoder().encode(BRIEF_README);

  const entries = [
    { name: 'README.md', data: readmeBytes },
    { name: 'brief.json', data: briefBytes },
    { name: 'recording.webm', data: recordingArr },
    ...keyframeEntries,
    ...skillEntries,
  ];
  // Include the user's annotated screenshot if they added one for this brief.
  if (userScreenshot) {
    try {
      const b64 = userScreenshot.split(',')[1] || '';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      entries.push({ name: 'screenshot.png', data: arr });
    } catch {}
  }
  const zipBytes = makeZip(entries);
  const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(zipBlob);

  const filename = `brief/brief-${briefId}.zip`;
  const result = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_ZIP',
    payload: { blobUrl, filename },
  });

  if (!result?.ok) {
    showError(`Save failed: ${result?.error || 'unknown'}`);
    return;
  }

  if (mode === 'inbox') {
    await finishToInbox(briefId, intent);
  } else {
    await finishWithCopy(briefId, intent);
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- Ship-now: copy prompt + auto-dismiss ----------
async function finishWithCopy(id, intent) {
  const prompt =
    `Process brief ${id} from ~/Downloads/brief/: ` +
    `unzip brief-${id}.zip and follow its skill/SKILL.md.`;
  try {
    await navigator.clipboard.writeText(prompt);
  } catch (err) {
    console.warn('[brief/bar] clipboard failed:', err);
  }
  setView('saved');
  savedDismissTimer = setTimeout(closeParent, SAVED_AUTODISMISS_MS);
}

// ---------- Inbox: mark this ticket recorded, show confirm toast ----------
async function finishToInbox(id, intent) {
  try {
    const { inbox } = await chrome.storage.local.get('inbox');
    const list = Array.isArray(inbox) ? inbox : [];
    const entry = list.find((b) => b.id === id);
    if (entry) {
      // Was added as a draft from the popup — flip it to recorded/ready.
      entry.recorded = true;
      entry.hasRecording = true;
      entry.recordedAt = Date.now();
      entry.intent = intent;
    } else {
      // Fallback: recording started without a pre-named draft (shouldn't
      // normally happen now, but keep the brief rather than lose it).
      list.push({ id, intent, name: '', recorded: true, hasRecording: true, addedAt: Date.now(), recordedAt: Date.now() });
    }
    await chrome.storage.local.set({ inbox: list });
    chrome.runtime.sendMessage({ type: 'INBOX_CHANGED' }).catch(() => {});
    // Best-effort: bring the user back to the brief to review/export. Chrome
    // only allows openPopup in some versions/contexts; it silently no-ops
    // otherwise (the toolbar badge still nudges).
    // Carry the brief id along so background can tag this open as
    // "post-capture" — popup uses it to auto-expand the right brief.
    chrome.runtime.sendMessage({ type: 'REOPEN_POPUP', briefId: id }).catch(() => {});
  } catch (err) {
    console.warn('[brief/bar] inbox write failed:', err);
  }
  // No confirmation toast — just close the bar. The badge updates and (where
  // allowed) the popup reopens, so the user already sees the saved brief.
  closeParent();
}
