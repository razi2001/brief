// Brief - popup (Evidence gallery + Describe, with bottom sheets)
//
// One brief at a time (extension/draft.js). Evidence holds screenshots AND the
// recording as tiles; Describe holds the description + custom fields. Editing
// happens in bottom sheets. Capture (screenshot/video) runs on the page, so those
// actions close the popup and it reopens when the capture lands.

import { APP_URL, TICKETS_URL as TICKETS_URL_BASE, getCloudToken, fetchAccountStatus, transcribeNote, TRACKER_ACTIONS, briefPageUrl, newShareId } from './cloud.js';
import { getDraft, setDraft, clearDraft, updateDraft, emptyDraft, isReadyDraft, landRecording, migrateInboxToDraft, clearAutoDescription } from './draft.js';
import { putFile, getFile, deleteFile, recKey, shotKey, replayKey, replayVoiceKey, draftKeys } from './filestore.js';
import { syncReplaySites } from './replay-sites.js';

const $ = (s, r) => (r || document).querySelector(s);
const gallery = $('#gallery');
const evCount = $('#evCount');
const descWrap = $('#descWrap');
const descField = $('#descField');
const kvList = $('#kvList');
const createBtn = $('#createBtn');
const reconnectBtn = $('#reconnectBtn');
const createMenuBtn = $('#createMenuBtn');
const createMenu = $('#createMenu');
const briefCloudBtn = $('#briefCloudBtn');
const brandMark = $('#brandMark');
const scrim = $('#scrim');
const sheet = $('#sheet');
const sheetBody = $('#sheetBody');
const sheetTitle = $('#sheetTitle');
const sheetClose = $('#sheetClose');
const sheetAction = $('#sheetAction');
const resetBtn = $('#resetBtn');
const toastEl = $('#toast');
const exportDone = $('#exportDone');
const filePick = $('#filePick');
const probeVideo = $('#probeVideo');

const MAX_SHOTS = 3;

let draft = emptyDraft();
let bcConnected = false;
let bcTracker;
let bcTrackerName = null; // the server's display name for bcTracker, or with none, for the tracker to fix
let bcTrackerIssue = null; // with no tracker, why a connected one can't file yet, when the server said
let bcTrackerAction = null; // with a tracker, 'reconnect' (still on Clerk); with none, 'reconnect' | 'pick' | 'connect'
// What the orange button does, picked in its menu and remembered:
// 'ticket' files to the tracker, 'draft' saves a draft and copies its public
// link, 'prompt' saves a draft and copies a fix prompt.
const CREATE_MODES = ['ticket', 'draft', 'prompt'];
let createDefault = 'ticket';
// The coding agent Fix prompt opens (FIX_AGENTS), asked once and remembered.
let fixAgent = null;
let currentSheet = null; // 'shot:<id>' | 'rec' | 'chooser' | 'reset' | null
let lastSig = '';

// Generic video poster when the recording's keyframe poster hasn't landed yet.
const REC_FALLBACK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='%23fbfaf7'/><rect width='320' height='26' fill='%23ece6d6'/><circle cx='14' cy='13' r='4' fill='%23dd6936'/><circle cx='28' cy='13' r='4' fill='%23d9d2c4'/><circle cx='42' cy='13' r='4' fill='%23d9d2c4'/><g fill='%23d9d2c4'><rect x='16' y='52' width='200' height='10' rx='3'/><rect x='16' y='78' width='250' height='10' rx='3'/><rect x='16' y='104' width='150' height='10' rx='3'/></g></svg>";

exportDone.hidden = true;

// ---------- helpers ----------
function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDur(ms) { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function genShotId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
let toastTimer;
const TOAST_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
// `ok` marks a done thing (filed, copied) with a check; notices stay plain.
function toast(msg, { ok = false } = {}) {
  toastEl.innerHTML = `${ok ? TOAST_CHECK : ''}<span>${esc(msg)}</span>`;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}
// The popup is focused and the click just happened, so the async clipboard
// works; the old copy command is the fallback if it ever refuses.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
async function persist(patch) {
  const updated = await updateDraft(draft.id, patch);
  if (updated) draft = updated;
  return updated;
}

// ---------- reveal ----------
// The popup starts at opacity 0 and is shown only once it is genuinely ready:
// the mic pre-flight passed AND the first render has replaced the static markup
// with real state. Revealing on the mic check alone flashed the markup's guesses
// for a beat - the Create button read "Create ticket" before the account's
// tracker was known, then corrected itself.
let micPassed = false;
let firstRender = false;
function reveal() { if (micPassed && firstRender) document.body.classList.add('ready'); }
// Whatever happens, never leave the user staring at an invisible popup.
setTimeout(() => document.body.classList.add('ready'), 1200);

// ---------- mic pre-flight ----------
const MIC_CACHE_KEY = 'micGrantedAt';
const MIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
(async () => {
  const { [MIC_CACHE_KEY]: grantedAt } = await chrome.storage.local.get(MIC_CACHE_KEY);
  if (grantedAt && Date.now() - grantedAt < MIC_CACHE_TTL_MS) {
    micPassed = true; reveal();
    probeMic().then((ok) => ok ? chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() }) : chrome.storage.local.remove(MIC_CACHE_KEY));
    return;
  }
  const ok = await probeMic();
  if (!ok) { await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }); window.close(); return; }
  await chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() });
  micPassed = true; reveal();
})();
async function probeMic() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return true; }
  catch (err) { console.warn('[brief/popup] mic probe failed:', err?.name); return false; }
}
async function ensureContentScript(tabId) {
  try { const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' }); if (r?.ok) return; } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await new Promise((r) => setTimeout(r, 50));
}

// ---------- inline error ----------
function showInlineError(msg, action) {
  const bar = $('#errBar');
  bar.textContent = msg;
  if (action?.linkText && action?.url) {
    bar.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = '#'; a.className = 'err-link'; a.textContent = action.linkText;
    a.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: action.url }); window.close(); });
    bar.appendChild(a);
  }
  if (action?.label && action?.run) {
    bar.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = '#'; a.className = 'err-link'; a.textContent = action.label;
    a.addEventListener('click', (e) => { e.preventDefault(); action.run(); });
    bar.appendChild(a);
  }
  bar.classList.add('show');
}
function clearInlineError() { $('#errBar').classList.remove('show'); $('#errBar').textContent = ''; }

// ---------- signature (background-change detection) ----------
function sig(d) {
  if (!d) return 'none';
  return [
    d.id,
    (d.screenshots || []).length,
    !!d.recording, d.recording?.poster ? 1 : 0,
    d.uploading, d.uploadFailed, d.cloudBriefId || '',
    d.transcribing, d.transcriptFailed, !!(d.transcript && d.transcript.trim()), !!d.describing,
    // only the AI's text: the reporter's own typing must not rebuild the popup on every save
    d.descriptionAuto ? (d.description || '') : '',
    !!d.filing, d.fileError ? 1 : 0,
    d.replay?.addedAt || 0, d.recording?.durationMs || 0,
  ].join('|');
}

// ---------- render ----------
function setBrandSpin(on) { brandMark?.classList.toggle('spinning', !!on); }
// Tickets handed to the worker and still being filed (see filing.js).
let ticketsInFlight = 0;
async function readTicketsInFlight() {
  try {
    const { filingDrafts = {} } = await chrome.storage.local.get('filingDrafts');
    ticketsInFlight = Object.keys(filingDrafts).length;
  } catch { ticketsInFlight = 0; }
  briefCloudBtn?.classList.toggle('sending', ticketsInFlight > 0);
}
function render() {
  renderGallery();
  updateCreate();
  renderDescState();
  setBrandSpin(!!draft.filing || !!draft.uploading);
  lastSig = sig(draft);
}

const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const SHEET_X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const SHEET_CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
function renderGallery() {
  const shots = Array.isArray(draft.screenshots) ? draft.screenshots : [];
  let html = '';
  shots.forEach((s, i) => {
    const hasNote = s.description && s.description.trim();
    html += `<div class="tile shot" data-shot="${s.id}">` +
      `<span class="badge">${i + 1}</span>` +
      `<button class="remove" data-rm="${s.id}" aria-label="Remove screenshot">${X_SVG}</button>` +
      `<div class="thumb"><img src="${s.dataUrl}" alt="Screenshot ${i + 1}"></div>` +
      (hasNote
        ? `<div class="note-strip"><span class="ntxt">${esc(s.description)}</span></div>`
        : `<div class="note-strip empty"><span class="ico"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>Note</div>`) +
      `</div>`;
  });

  if (draft.recording) {
    const poster = draft.recording.poster || REC_FALLBACK;
    const transcribing = draft.transcribing && !draft.uploading && !draft.uploadFailed;
    const dotCls = draft.uploading ? 'updot up' : draft.uploadFailed ? 'updot failed' : (transcribing ? 'updot up' : 'updot');
    const footLabel = draft.uploading ? 'Uploading' : draft.uploadFailed ? 'Upload failed' : (transcribing ? 'Transcribing' : 'Recording');
    html += `<div class="tile rec" data-rec="1">` +
      `<button class="remove" data-rm="rec" aria-label="Remove recording">${X_SVG}</button>` +
      `<div class="thumb"><img src="${poster}" alt="Recording"><span class="play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></div>` +
      `<div class="rec-foot"><span class="${dotCls}"></span>${footLabel}${draft.recording.durationMs && !draft.uploading && !transcribing && !draft.uploadFailed ? ` ${fmtDur(draft.recording.durationMs)}` : ''}</div>` +
      `</div>`;
  }


  if (draft.replay) {
    const sites = (draft.replay.sites || []).join(', ');
    html += `<div class="tile rep" data-rep="1" title="${esc(sites)}">` +
      `<button class="remove" data-rm="replay" aria-label="Remove replay">${X_SVG}</button>` +
      `<div class="thumb">${draft.replay.poster ? `<img src="${draft.replay.poster}" alt="Replay">` : ''}<span class="play">${PLAY_SVG}</span></div>` +
      `<div class="rec-foot"><span class="updot"></span>Replay ${fmtDur(draft.replay.durationMs)}</div>` +
      `</div>`;
  }

  const canAddShot = shots.length < MAX_SHOTS;
  const canAddVideo = !draft.recording;
  if (canAddShot || canAddVideo || !draft.replay) {
    html += `<div class="tile add" data-add="1">` +
      `<span class="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>` +
      `<span class="add-lbl">Add</span></div>`;
  }

  gallery.innerHTML = html;
  evCount.textContent = String(shots.length + (draft.recording ? 1 : 0) + (draft.replay ? 1 : 0));
}

// ---------- additional data (inline: description, plus any custom fields an
// older build added - shown so they can be edited or removed, no new ones) ----------
function readKv() {
  return [...kvList.querySelectorAll('.sheet-field')]
    .map((r) => ({ key: $('.k', r).value, value: $('.v', r).value }))
    .filter((f) => f.key.trim() || f.value.trim());
}
let kvTimer = null;
function persistKv() { clearTimeout(kvTimer); kvTimer = setTimeout(() => persist((d) => { d.extra = readKv(); }), 250); }
function renderKvRows() {
  const fields = Array.isArray(draft.extra) ? draft.extra : [];
  kvList.innerHTML = fields.map((f) => fieldRowHTML(f)).join('');
}
// Reflect the current draft into the inline fields (boot + after reset). Kept out
// of render() so background updates never clobber what the user is typing.
// shownDesc is what the field last showed from storage: a background change (the
// AI's description) only replaces it while the reporter has nothing unsaved in it.
let shownDesc = '';
function syncAdditionalData() {
  descField.value = draft.description || '';
  shownDesc = descField.value;
  renderKvRows();
  renderDescState();
}
// The AI's description arrived (or was cleared) in the background: show it,
// unless the reporter is in the field or has typed something unsaved.
function syncDescriptionFromDraft() {
  const stored = draft.description || '';
  if (stored === shownDesc || document.activeElement === descField || descField.value !== shownDesc) return;
  descField.value = stored;
  shownDesc = stored;
  renderDescState();
}
// While a narrated recording is being transcribed and summed up, the empty
// field says the description is on its way. It stays editable: typing takes over.
function renderDescState() {
  const writing = (!!draft.transcribing || !!draft.describing) && !!draft.recording && !descField.value.trim() && !(draft.description || '').trim();
  descWrap.classList.toggle('writing', writing);
  descField.placeholder = writing ? 'Writing…' : 'Describe the brief…';
}
function initAdditionalData() {
  const persistDesc = () => {
    const value = descField.value;
    shownDesc = value;
    // Any change of the reporter's own makes the text theirs: no AI summary
    // replaces it after this.
    return persist((d) => { if (d.description !== value) d.descriptionAuto = false; d.description = value; }).then(updateCreate);
  };
  let dt = null;
  descField.addEventListener('input', () => { renderDescState(); clearTimeout(dt); dt = setTimeout(persistDesc, 250); });
  descField.addEventListener('blur', () => { clearTimeout(dt); persistDesc(); });
  attachVoiceDictation(descField, descWrap, persistDesc);
  kvList.addEventListener('input', persistKv);
  kvList.addEventListener('click', (e) => { const fx = e.target.closest('.fx'); if (fx) { fx.closest('.sheet-field').remove(); persistKv(); } });
  syncAdditionalData();
}

function updateCreate() {
  const label = createBtn.querySelector('.ctk-label');
  const uploading = !!draft.uploading;
  // Filing lives on the draft (the worker runs it), so a reopened popup shows
  // the in-progress state too.
  const filing = !!draft.filing;
  const ready = isReadyDraft(draft);
  // With no tracker that can file, the button offers the fix instead.
  const fix = filing ? null : trackerFixLabel();
  // One button, doing what its menu says (createMode). With no tracker that
  // files it can't file, so it saves the draft; the fix is the link above.
  const mode = createMode();
  createBtn.dataset.mode = mode;
  createBtn.disabled = filing || uploading || !ready;
  createMenuBtn.disabled = filing || uploading || !ready;
  if (createBtn.disabled) closeCreateMenu();

  if (label) {
    if (filing) label.innerHTML = `<span class="btn-spin"></span> ${draft.filingMode === 'ticket' ? 'Filing…' : 'Saving…'}`;
    else if (uploading) label.textContent = 'Uploading…';
    else label.innerHTML = mode === 'ticket' ? esc(createLabel()) : `${MODE_ICON[mode]}${esc(mode === 'prompt' ? promptLabel() : MODE_LABEL[mode])}`;
  }
  renderCreateMenu();
}
// What the button does now: the remembered pick, except that with no tracker
// that files it can't file, so it saves a draft instead.
function createMode() {
  if (createDefault === 'ticket' && trackerFixLabel()) return 'draft';
  return createDefault;
}
const ICONS = {
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  prompt: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const MODE_ICON = { draft: svg('link'), prompt: svg('prompt') };
const MODE_LABEL = { draft: 'Share link', prompt: 'Fix prompt' };
// Where Fix prompt takes the prompt, besides the clipboard: each desktop app
// opens with it filled in, by its own link scheme, and none sends it (you
// press Enter there).
const ICONS_PROMPT = '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>';
const FIX_AGENTS = {
  claude: { name: 'Claude Code', sub: 'Opens the Claude app', icon: '<path d="M12 3v18"/><path d="M3 12h18"/><path d="m5.6 5.6 12.8 12.8"/><path d="M18.4 5.6 5.6 18.4"/>', url: (p) => `claude://code/new?q=${encodeURIComponent(p)}` },
  codex: { name: 'Codex', sub: 'Opens the Codex app', icon: ICONS_PROMPT, url: (p) => `codex://new?prompt=${encodeURIComponent(p)}` },
  cursor: { name: 'Cursor', sub: 'Opens Cursor', icon: '<path d="m4 4 7 17 2.5-7.5L21 11z"/>', url: (p) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(p)}` },
  vscode: { name: 'VS Code', sub: 'Opens Copilot in VS Code', icon: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>', url: (p) => `vscode://agents/new?prompt=${encodeURIComponent(p)}` },
  copy: { name: null, sub: 'Paste it anywhere', icon: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', url: null, title: 'Just copy' },
};
// "Fix in Codex" once an agent is picked; "Fix prompt" for just copy.
function promptLabel() {
  const name = FIX_AGENTS[fixAgent]?.name;
  return name ? `Fix in ${name}` : 'Fix prompt';
}
// The menu: the tracker, the draft and the prompt. Picking one makes it the
// button. With no tracker that files, the ticket row says why and carries the
// fix as a pill (Connect, Reconnect, Finish), which opens Settings.
const FIX_PILL = { reconnect: ['Reconnect', 'Connection expired'], pick: ['Finish', 'One step left'] };
function renderCreateMenu() {
  const fix = trackerFixLabel();
  const mode = createMode();
  const [pill, why] = FIX_PILL[bcTrackerAction] || ['Connect', 'No tracker yet'];
  const items = [
    fix
      ? { key: 'fix', icon: 'send', t: createLabel(), s: why, pill }
      : { key: 'ticket', icon: 'send', t: createLabel(), s: 'File the ticket now' },
    { key: 'draft', icon: 'link', t: 'Share link', s: 'Public page, kept in Drafts' },
    { key: 'prompt', icon: 'prompt', t: promptLabel(), s: FIX_AGENTS[fixAgent]?.name ? `Copies the prompt, opens ${FIX_AGENTS[fixAgent].name}` : 'Copies a prompt for your agent' },
  ];
  createMenu.innerHTML = items.map((it) =>
    `<button class="cm-item${it.pill ? ' cm-fix' : ''}" type="button" role="menuitemradio" data-key="${it.key}" aria-checked="${it.key === mode}"` +
    `${it.pill ? ` title="${esc(bcTrackerIssue || fix)}"` : ''}>` +
    `<span class="cm-ico">${svg(it.icon)}</span>` +
    `<span class="cm-txt"><span class="cm-t">${esc(it.t)}</span><span class="cm-s">${esc(it.s)}</span></span>` +
    (it.pill ? `<span class="cm-pill">${it.pill}</span>` : `<span class="cm-check">${svg('check')}</span>`) +
    `</button>`).join('');
}
function openCreateMenu() {
  renderCreateMenu();
  createMenu.classList.add('open');
  createMenuBtn.setAttribute('aria-expanded', 'true');
  createMenu.querySelector('[aria-checked="true"]')?.focus();
}
function closeCreateMenu() {
  createMenu.classList.remove('open');
  createMenuBtn.setAttribute('aria-expanded', 'false');
}
async function pickCreateMode(key) {
  closeCreateMenu();
  if (key === 'fix') {
    await openAppTab(`${APP_URL}/connections#tracker`, `${APP_URL}/connections*`);
    window.close();
    return;
  }
  if (!CREATE_MODES.includes(key)) return;
  // Fix prompt: which agent (asked again here, so this is also how to change it)
  if (key === 'prompt') return openAgentPicker();
  createDefault = key;
  chrome.storage.local.set({ createDefault: key }).catch(() => {});
  updateCreate();
  createBtn.focus();
}
// "Your coding agent": the agents Fix prompt can open, and just copy. Picking
// one makes Fix prompt the button, in that agent's name. `then` runs after the
// pick (from inside that click, so the copy and the app link still work).
function openAgentPicker(then) {
  const chev = '<path d="m9 6 6 6-6 6"/>';
  const check = '<path d="M20 6 9 17l-5-5"/>';
  const body = '<div class="chooser">' + Object.entries(FIX_AGENTS).map(([key, a]) =>
    `<button class="choice" type="button" data-agent="${key}">` +
    `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${a.icon}</svg></span>` +
    `<span class="ctxt"><span class="ct">${esc(a.title || a.name)}</span><span class="cs">${esc(a.sub)}</span></span>` +
    `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${key === fixAgent ? check : chev}</svg></span>` +
    `</button>`).join('') + '</div>';
  openSheet('Your coding <em>agent</em>', body, (root) => {
    root.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', () => {
      fixAgent = b.dataset.agent;
      createDefault = 'prompt';
      chrome.storage.local.set({ fixAgent, createDefault }).catch(() => {});
      closeSheet();
      updateCreate();
      if (then) then(); else createBtn.focus();
    }));
  }, 'agent');
}
// An app's own link (claude://, codex://, cursor://, vscode://), opened
// through the page the popup sits on: Chrome asks "Open <app>?" over that
// page, full size (opened from the popup, its dialog was squeezed into the
// popup's little window), and the page itself doesn't navigate. A page that
// can't take it (chrome://, the Web Store) gets it from the popup instead.
// An app that isn't installed just doesn't open; the prompt is copied anyway.
async function launchApp(url) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null && /^https?:/.test(tab.url || '')) {
      await chrome.tabs.update(tab.id, { url });
      return;
    }
  } catch {}
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
// "Create in Linear": the tracker it lands in, once known.
function createLabel() {
  const name = bcTrackerName || TRACKER_NAMES[bcTracker];
  return name ? `Create in ${name}` : 'Create ticket';
}

// ---------- sheets ----------
let sheetActionHandler = null;
function openSheet(title, bodyHTML, onReady, key, headAction, closeAsCheck) {
  currentSheet = key || null;
  sheetTitle.innerHTML = title;
  sheetBody.innerHTML = bodyHTML;
  sheetBody.scrollTop = 0;
  // For evidence editors the close reads as "done, all good" - a check, not an X.
  if (closeAsCheck) { sheetClose.innerHTML = SHEET_CHECK_SVG; sheetClose.classList.add('confirm'); sheetClose.title = 'Done'; sheetClose.setAttribute('aria-label', 'Done'); }
  else { sheetClose.innerHTML = SHEET_X_SVG; sheetClose.classList.remove('confirm'); sheetClose.title = 'Close'; sheetClose.setAttribute('aria-label', 'Close'); }
  if (headAction) {
    sheetAction.hidden = false;
    sheetAction.innerHTML = headAction.html;
    sheetAction.title = headAction.title || '';
    sheetAction.setAttribute('aria-label', headAction.title || '');
    sheetActionHandler = headAction.onClick;
  } else {
    sheetAction.hidden = true;
    sheetActionHandler = null;
  }
  scrim.classList.add('open');
  sheet.classList.add('open');
  document.body.classList.add('sheet-open');
  if (onReady) onReady(sheetBody);
  clearTimeout(sheetFitTimer);
  requestAnimationFrame(fitSheet);
}
// The popup is only as tall as the brief, and a sheet is an overlay: a sheet
// taller than the brief scrolled inside a short popup. While one is open the
// page is made tall enough to hold it (the popup window follows, up to
// Chrome's 600px), and it settles back once the sheet has slid away.
let sheetFitTimer = null;
function fitSheet() {
  if (!sheet.classList.contains('open')) return;
  // Measured without the scrollbar: with it the content is 8px narrower, so a
  // full-width screenshot is shorter and "fits", and the bar never leaves.
  // +2: the heights round, and a pixel short still shows the bar.
  sheetBody.style.overflowY = 'hidden';
  const need = sheet.getBoundingClientRect().height - sheetBody.clientHeight + sheetBody.scrollHeight + 16 + 2;
  sheetBody.style.overflowY = '';
  document.body.style.minHeight = `${Math.min(600, Math.ceil(need))}px`;
  // Fitting, it gets no scrollbar at all (an overflow:auto bar, once shown,
  // narrows the content just enough to stay); only past 600px does it scroll.
  sheetBody.classList.toggle('fits', need <= 600);
}
// (not on the sheet body's own style: that's fitSheet measuring)
new MutationObserver((muts) => {
  if (muts.some((m) => !(m.type === 'attributes' && m.target === sheetBody))) requestAnimationFrame(fitSheet);
}).observe(sheetBody, { childList: true, subtree: true, attributes: true });
sheetBody.addEventListener('load', () => requestAnimationFrame(fitSheet), true);
sheetAction.addEventListener('click', () => { if (sheetActionHandler) sheetActionHandler(); });
function closeSheet() {
  sheet.classList.remove('open');
  scrim.classList.remove('open');
  document.body.classList.remove('sheet-open');
  currentSheet = null;
  sheetFitTimer = setTimeout(() => { if (!sheet.classList.contains('open')) document.body.style.minHeight = ''; }, 260);
  // Reflect any edits made in the sheet, then re-baseline the signature so the
  // storage listener doesn't immediately rebuild on our own write.
  render();
}
scrim.addEventListener('click', closeSheet);
sheetClose.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && currentSheet) closeSheet(); });

// ---------- shot sheet ----------
function openShot(id) {
  const idx = (draft.screenshots || []).findIndex((s) => s.id === id);
  if (idx < 0) return;
  const s = draft.screenshots[idx];
  // The picture with Edit on it, like the recording's: it opens the screenshot
  // editor (draw, crop) in its own tab, every mark still editable.
  const body =
    `<button class="shot-preview shot-open" id="shotEdit" type="button" title="Edit" aria-label="Edit the screenshot"><img src="${s.dataUrl}" alt="Screenshot ${idx + 1}"><span class="rec-edit">${EDIT_SVG}Edit</span></button>` +
    `<div class="field-label">Note</div>` +
    `<div class="ai-wrap" id="shotNoteWrap"><textarea class="ai-field has-mic" id="shotNote" placeholder="Add a note for this screenshot">${esc(s.description || '')}</textarea></div>`;
  openSheet(`Screenshot <em>${idx + 1}</em>`, body, (root) => {
    $('#shotEdit', root).addEventListener('click', async () => {
      await openEditorTab(chrome.runtime.getURL(`image.html#${encodeURIComponent(id)}`)).catch(() => {});
      window.close();
    });
    const ta = $('#shotNote', root);
    ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    const persistNote = () => persist((d) => { const h = (d.screenshots || []).find((x) => x.id === id); if (h) h.description = ta.value; });
    let t = null;
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(persistNote, 250); });
    attachVoiceDictation(ta, $('#shotNoteWrap', root), persistNote);
  }, 'shot:' + id, null, true);
}

// ---------- recording sheet ----------
// While transcribing: a non-editable animated placeholder (the user can't type
// into it). When done: the editable field. Kept separate from the sheet body so
// the swap can happen in place - rebuilding the sheet would restart the video.
function transcriptBlockHTML() {
  const phold = draft.transcriptFailed ? 'Auto-transcription failed - type it here' : 'Transcript';
  return draft.transcribing
    ? `<div class="transcribing" id="trState" role="status" aria-live="polite"><span class="tr-dots"><i></i><i></i><i></i></span><span class="tr-label">Transcribing</span></div>`
    : `<div class="ai-wrap"><textarea class="ai-field transcript has-mic" id="recTranscript" placeholder="${phold}">${esc(draft.transcript || '')}</textarea></div>`;
}
function wireTranscript(root) {
  const ta = $('#recTranscript', root);
  if (!ta) return;
  let t = null;
  const persistTr = () => persist((d) => { d.transcript = ta.value; });
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(persistTr, 250); });
  // Same voice-record mic as a screenshot note: dictate corrections/additions
  // straight into the transcript.
  attachVoiceDictation(ta, ta.parentElement, persistTr);
}


async function openRec() {
  const r = draft.recording;
  if (!r) return;
  const poster = r.poster || REC_FALLBACK;
  // The recording itself, playing muted on a loop (sharp, unlike the still),
  // with Edit on it: that opens it full size in its own tab to watch, trim,
  // crop or voice over. The popup is no place for that: a fixed little window
  // with no working fullscreen that dies the moment it loses focus. A brief
  // whose video is no longer on this device just shows the still.
  let blob = null;
  try { blob = await getFile(recKey(draft.id)); } catch {}
  const preview = blob
    ? `<div class="rec-preview" id="recPlay" role="button" tabindex="0" title="Edit" aria-label="Edit the recording">` +
        `<video class="rec-vid" muted playsinline loop autoplay preload="auto" poster="${poster}"></video>` +
        (r.durationMs ? `<span class="rec-dur">${fmtDur(r.durationMs)}</span>` : '') +
        `<span class="rec-edit">${EDIT_SVG}Edit</span>` +
      `</div>`
    : `<img class="rec-poster" src="${poster}" alt="Recording preview">`;
  const body =
    preview +
    `<div class="field-label">Transcript</div>` +
    `<div id="trWrap">${transcriptBlockHTML()}</div>` +
    `<div class="toggle-row"><span class="lbl">Attach the video to the ticket</span>` +
      `<button class="switch${draft.includeVideo ? ' on' : ''}" id="recAttach" role="switch" aria-checked="${!!draft.includeVideo}"><span class="knob"></span></button></div>`;
  openSheet('Recording', body, (root) => {
    wireTranscript(root);
    const vid = $('.rec-vid', root);
    if (vid && blob) vid.src = URL.createObjectURL(blob);
    const edit = () => { openEditorTab(chrome.runtime.getURL(`player.html#${encodeURIComponent(draft.id)}`)).catch(() => {}); };
    $('#recPlay', root)?.addEventListener('click', edit);
    $('#recPlay', root)?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
    const sw = $('#recAttach', root);
    sw.addEventListener('click', async () => {
      await persist((d) => { d.includeVideo = !d.includeVideo; });
      sw.classList.toggle('on', draft.includeVideo);
      sw.setAttribute('aria-checked', String(!!draft.includeVideo));
    });
  }, 'rec', { html: REFRESH_SVG, title: 'Re-record', onClick: () => recordBrief() }, true);
}

// Editors open as a child of the tab you were on: closing one returns there.
async function openEditorTab(url) {
  let opener = null;
  try { [opener] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch {}
  return chrome.tabs.create({ url, ...(opener?.id != null ? { openerTabId: opener.id } : {}) });
}

// ---------- replay sheet ----------
// The same shape as the recording's: the still (tap = watch and edit), a note,
// and whether it is attached to the ticket. Not attached, it still informs the
// write-up (steps) but isn't kept on the brief.
function openRep() {
  const r = draft.replay;
  if (!r) return;
  const attach = r.attach !== false;
  const body =
    `<button class="rec-preview" id="repPlay" type="button" title="Edit" aria-label="Edit the replay">` +
      (r.poster ? `<img class="rec-vid" src="${r.poster}" alt="Replay preview">` : '') +
      `<span class="rec-edit">${EDIT_SVG}Edit</span>` +
    `</button>` +
    `<div class="field-label">Note</div>` +
    `<div class="ai-wrap" id="repNoteWrap"><textarea class="ai-field has-mic" id="repNote" placeholder="Add a note for this replay">${esc(r.note || '')}</textarea></div>` +
    `<div class="toggle-row"><span class="lbl">Attach the replay to the ticket</span>` +
      `<button class="switch${attach ? ' on' : ''}" id="repAttach" role="switch" aria-checked="${attach}"><span class="knob"></span></button></div>`;
  const again = async () => {
    await openEditorTab(chrome.runtime.getURL(`replay.html#at=${Date.now()}&pick=${encodeURIComponent(draft.id)}`));
    window.close();
  };
  openSheet('Replay', body, (root) => {
    $('#repPlay', root).addEventListener('click', async () => {
      await openEditorTab(chrome.runtime.getURL(`replay.html#draft=${encodeURIComponent(draft.id)}`));
      window.close();
    });
    const ta = $('#repNote', root);
    let t = null;
    const persistNote = () => persist((d) => { if (d.replay) d.replay.note = ta.value; });
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(persistNote, 250); });
    attachVoiceDictation(ta, $('#repNoteWrap', root), persistNote);
    const sw = $('#repAttach', root);
    sw.addEventListener('click', async () => {
      await persist((d) => { if (d.replay) d.replay.attach = d.replay.attach === false; });
      const on = draft.replay?.attach !== false;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
    });
  }, 'rep', { html: REFRESH_SVG, title: 'Take the last 60s again', onClick: again }, true);
}

// ---------- add chooser ----------
function openAddChooser() {
  const shots = (draft.screenshots || []).length;
  const canShot = shots < MAX_SHOTS;
  const canVid = !draft.recording;
  const canUp = canShot || canVid;
  const canRep = !draft.replay;
  const upSub = canShot && canVid ? 'Image or video' : canShot ? 'Image' : canVid ? 'Video' : 'Limit reached';
  const repSub = canRep ? 'The last 60 seconds' : 'Already added';
  const body = `<div class="chooser">` +
    `<button class="choice" id="chShot" ${canShot ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-4 4-2-2-4 4"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Screenshot</span><span class="cs">${canShot ? `${shots} of ${MAX_SHOTS}` : 'Limit reached'}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `<button class="choice" id="chVid" ${canVid ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m10 8 6 4-6 4z"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Video</span><span class="cs">${canVid ? 'Record the screen' : 'Already added'}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `<button class="choice" id="chRep" ${canRep ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Replay</span><span class="cs">${esc(repSub)}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `<button class="choice" id="chUp" ${canUp ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Upload</span><span class="cs">${upSub}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `</div>`;
  openSheet('Add to <em>brief</em>', body, (root) => {
    if (canShot) $('#chShot', root).addEventListener('click', () => takeScreenshot());
    if (canVid) $('#chVid', root).addEventListener('click', () => recordBrief());
    if (canRep) $('#chRep', root).addEventListener('click', async () => {
      await openEditorTab(chrome.runtime.getURL(`replay.html#at=${Date.now()}&pick=${encodeURIComponent(draft.id)}`));
      window.close();
    });
    if (canUp) $('#chUp', root).addEventListener('click', () => pickFiles(canShot, canVid));
  }, 'chooser');
}

// ---------- describe sheet (description + custom fields together) ----------
function fieldRowHTML(f) {
  return `<div class="sheet-field">` +
    `<input class="k" placeholder="Field" value="${esc((f && f.key) || '')}" autocomplete="off">` +
    `<input class="v" placeholder="Value" value="${esc((f && f.value) || '')}" autocomplete="off">` +
    `<button class="fx" type="button" aria-label="Remove field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`;
}

// ---------- reset ----------
function openReset() {
  const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"/></svg>';
  const body = `<div class="sheet-actions"><button class="s-btn danger" id="resetConfirm">${TRASH}Reset brief</button></div>`;
  openSheet('Reset the <em>brief</em>?', body, (root) => {
    $('#resetConfirm', root).addEventListener('click', async () => {
      // The video and the clean captures go with it.
      for (const k of draftKeys(draft)) deleteFile(k).catch(() => {});
      await clearDraft();
      draft = emptyDraft();
      await setDraft(draft);
      lastSig = sig(draft);
      syncAdditionalData();
      closeSheet();
      toast('Brief reset');
    });
  }, 'reset');
}

// ---------- capture ----------
// Video records the window picked in Chrome's picker, so it films whichever
// tab is in front, browser around it included (the bar and the event log
// follow the tabs too, see followTab in background.js).
async function recordBrief() {
  clearInlineError();
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) { showInlineError('Switch to a regular web page to record.'); return; }
    try { await chrome.runtime.sendMessage({ type: 'RESET_BEFORE_NEW_RECORDING' }); } catch {}
    await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_BAR', streamId: '', intent: 'brief', mode: 'inbox', itemId: draft.id, capture: 'window' });
    window.close();
  } catch (err) { console.error('[brief/popup] start failed:', err); showInlineError(`Could not start: ${err?.message || err}`); }
}

async function takeScreenshot() {
  clearInlineError();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) { showInlineError('Switch to a regular web page to screenshot.'); return; }
    const res = await chrome.runtime.sendMessage({ type: 'START_SHOT', itemId: draft.id });
    if (res && res.ok === false) { showInlineError(res.error === 'unsupported_page' ? 'Can’t screenshot this page.' : `Couldn’t capture: ${res.error}`); return; }
    window.close();
  } catch (err) { showInlineError(`Couldn’t capture: ${err?.message || err}`); }
}

// ---------- upload (an image or a video from disk) ----------
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // Supabase object cap
const IMAGE_MAX_EDGE = 1600;
const VIDEO_EXT = { 'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

function pickFiles(images, videos) {
  const accept = [];
  if (images) accept.push('image/*');
  if (videos) accept.push(...Object.keys(VIDEO_EXT));
  filePick.accept = accept.join(',');
  filePick.value = '';
  filePick.click();
}
filePick.addEventListener('change', () => {
  const files = [...(filePick.files || [])];
  if (files.length) addFiles(files);
});

async function addFiles(files) {
  clearInlineError();
  const images = files.filter((f) => f.type.startsWith('image/'));
  const videos = files.filter((f) => f.type.startsWith('video/'));
  const room = Math.max(0, MAX_SHOTS - (draft.screenshots || []).length);
  let lastShotId = null;
  for (const f of images.slice(0, room)) {
    let dataUrl;
    try { dataUrl = await imageToPngDataUrl(f); } catch { showInlineError(`Couldn’t read ${f.name}`); continue; }
    const id = genShotId();
    // The picked image IS the clean capture - stash it so Edit drawing works.
    try { await putFile(shotKey(id), await (await fetch(dataUrl)).blob()); } catch {}
    const saved = await persist((d) => {
      if (!Array.isArray(d.screenshots)) d.screenshots = [];
      if (d.screenshots.length >= MAX_SHOTS) return;
      d.screenshots.push({ id, dataUrl, annotated: false, strokes: [], description: '', pageUrl: null, pageTitle: null, addedAt: Date.now() });
    });
    if (saved && saved.screenshots.some((s) => s.id === id)) lastShotId = id;
  }
  if (images.length > room) toast(`${MAX_SHOTS} screenshots max`);
  if (videos.length) {
    if (draft.recording) toast('One video per brief');
    else await addVideoFile(videos[0]);
  }
  closeSheet();
  if (lastShotId && !videos.length) openShot(lastShotId);
}

// Uploaded images join the screenshot pipeline as-is (PNG data URLs, filed as
// screenshots/<id>.png), bounded so a big photo doesn't blow storage quota.
async function imageToPngDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c.toDataURL('image/png');
}

// A video file takes the recording's slot and its exact upload path: the popup
// can't upload it (it dies on blur), so the file is parked in IndexedDB and the
// offscreen document uploads it in the background - keyframes, poster and
// transcript included - reporting back through UPLOAD_RESULT like a capture.
async function addVideoFile(file) {
  const ext = VIDEO_EXT[file.type];
  if (!ext) { showInlineError('Use an MP4, WebM or MOV video.'); return; }
  if (file.size > MAX_VIDEO_BYTES) { showInlineError('Video is over 50 MB.'); return; }
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }
  const meta = await probeVideoFile(file);
  try { await putFile(recKey(draft.id), file); }
  catch (err) { showInlineError(`Couldn’t read the video: ${err?.message || err}`); return; }
  await persist((d) => { landRecording(d, { uploading: true, durationMs: meta.durationMs, poster: meta.poster, source: 'upload' }); });
  render();
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: draft.id, key: recKey(draft.id), name: `recording.${ext}`, mimeType: file.type });
  } catch (err) { res = { ok: false, error: String(err?.message || err) }; }
  if (!res?.ok) {
    await persist((d) => { d.uploading = false; d.transcribing = false; d.uploadFailed = true; d.uploadError = res?.error || 'upload failed'; });
    render();
    showInlineError(`Couldn’t upload the video: ${res?.error || 'unknown error'}`);
  }
}

// Duration + an early poster so the tile shows a real frame right away.
// Best-effort with a short timeout; the offscreen uploader produces the
// definitive poster and duration from the file itself.
function probeVideoFile(file) {
  return new Promise((resolve) => {
    const v = probeVideo;
    const url = URL.createObjectURL(file);
    let done = false;
    let durationMs = 0;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      v.onloadedmetadata = v.onseeked = v.onerror = null;
      try { v.removeAttribute('src'); v.load(); } catch {}
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const t = setTimeout(() => finish({ durationMs, poster: null }), 4000);
    v.onloadedmetadata = () => {
      durationMs = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0;
      try { v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 2); }
      catch { finish({ durationMs, poster: null }); }
    };
    v.onseeked = () => {
      let poster = null;
      try {
        const scale = Math.min(1, 320 / (v.videoWidth || 320));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((v.videoWidth || 320) * scale));
        c.height = Math.max(1, Math.round((v.videoHeight || 200) * scale));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        poster = c.toDataURL('image/jpeg', 0.72);
      } catch {}
      finish({ durationMs, poster });
    };
    v.onerror = () => finish({ durationMs, poster: null });
    v.src = url;
  });
}

// ---------- filing ----------
// The worker does the actual work (filing.js): the popup dies the instant it
// loses focus, so an upload + file flow run here was dropped whenever the user
// clicked away after Create. We ask, mirror progress from the draft's `filing`
// flag; the result lands behind the cloud button.
// Display names for the trackers this build knows. /api/me sends the name too,
// and that wins, so a tracker added after this build still reads right; with
// neither, it files fine and reads as "your tracker".
const TRACKER_NAMES = {
  linear: 'Linear', jira: 'Jira', github: 'GitHub', gitlab: 'GitLab', azure: 'Azure DevOps',
  clickup: 'ClickUp', notion: 'Notion', trello: 'Trello', asana: 'Asana', monday: 'Monday',
};
function trackerName() { return bcTrackerName || TRACKER_NAMES[bcTracker] || 'your tracker'; }
// `mode`: 'ticket' files straight to the connected tracker; 'draft' writes the
// brief up with no ticket, and copies `kind`: its public link, or a prompt for
// a coding agent to fix it. Both are handed to the worker and land behind the
// cloud button.
async function startFiling(mode, kind = 'link') {
  clearInlineError();
  if (!isReadyDraft(draft) || draft.uploading || draft.filing) return;
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }
  // The link is copied now, before anything uploads: its id is picked here
  // and the server takes it, so the page is there by the time anyone opens
  // it. Kept on the draft, so a retry after a failure keeps the same link.
  let done = 'Ticket queued';
  let launchAfter = null;
  if (mode === 'draft') {
    const shareId = draft.shareId || newShareId();
    const url = briefPageUrl(shareId);
    const prompt = kind === 'prompt' ? fixPrompt(draft.description, `${url}.md`) : null;
    const copied = await copyText(prompt ?? url);
    await persist((d) => { d.shareId = shareId; });
    // Fix prompt also opens the agent's app with it, once the brief is
    // handed off (Chrome's "Open <app>?" takes focus, and the popup goes).
    const agent = kind === 'prompt' ? FIX_AGENTS[fixAgent] : null;
    if (agent?.url) launchAfter = agent.url(prompt);
    done = !copied ? 'Couldn’t copy. It’s in Drafts'
      : kind !== 'prompt' ? 'Link copied'
      : agent?.name ? `Prompt copied, opening ${agent.name}` : 'Prompt copied';
  }

  // Optimistic UI; the worker owns the flow (and the draft's flag) from here.
  draft.filing = true; draft.filingMode = mode; draft.filingKind = kind; draft.fileError = null;
  render();
  let res = null;
  try { res = await chrome.runtime.sendMessage({ type: 'FILE_DRAFT', mode }); }
  catch (err) { res = { ok: false, error: String(err?.message || err) }; }
  if (res?.ok) {
    // Ticket or draft, the same: no tab and no wait. The worker finishes it in
    // the background (the cloud spins until it lands) and this popup is already
    // on a fresh draft.
    flyToCloud(createBtn);
    toast(done, { ok: !done.startsWith('Couldn’t') });
    if (launchAfter) await launchApp(launchAfter);
    return;
  }
  if (res?.error === 'already_filing') return; // an earlier ask is still running; the draft flag shows it
  const d = await getDraft();
  if (d) draft = d;
  render();
  showInlineError(`Couldn’t create brief: ${res?.error || 'unknown error'}`);
}

// What a coding agent gets: the bug in the reporter's words, the report itself
// as Markdown (/b/<id>.md waits for the write-up, and lists every screenshot
// and recording by URL), and the way back: a ticket on whoever runs the agent,
// a PR, and the fix posted on the ticket (or in the chat).
function fixPrompt(description, mdUrl) {
  const first = (description || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const what = first.length > 160 ? `${first.slice(0, 157).replace(/\s+\S*$/, '')}…` : first;
  return [
    what ? `Fix this bug: ${what}` : 'Fix the bug in this report.',
    `The full report (steps, expected and actual, technical notes, screenshots): ${mdUrl}`,
    'If it makes sense, create a ticket for it in our tracker and assign it to me.',
    'Find the cause in this codebase, fix it, and add a test that would have caught it.',
    'Once it is done, open a PR and send me the link. Then comment "Here is the fix" with the PR link on the ticket, or here if there is no ticket.',
  ].join('\n\n');
}

// What Create offers when no tracker can file: the fix the server named, or a
// plain connect. Null while a tracker files, or before a paired account's
// status is known.
function trackerFixLabel() {
  if (bcTracker !== null) return null;
  const name = bcTrackerName || 'your tracker';
  if (bcTrackerAction === 'reconnect') return `Reconnect ${name}`;
  if (bcTrackerAction === 'pick') return `Finish connecting ${name}`;
  if (bcTrackerAction === 'connect' || bcConnected) return 'Connect a tracker';
  return null;
}

// The primary action: file to the connected tracker. With none that can file
// it opens the tracker row in Connections (the draft is kept, and Save as
// draft still works). If we don't yet know the tracker status (fast click on
// open), resolve it first.
async function primaryCreate() {
  if (bcTracker === undefined) {
    try {
      const st = await fetchAccountStatus();
      if (st) {
        bcConnected = st.connected; bcTracker = st.tracker; bcTrackerName = st.trackerName ?? null;
        bcTrackerIssue = st.tracker ? null : st.trackerIssue ?? null;
        bcTrackerAction = st.connected ? st.trackerAction ?? null : null;
        renderReconnect();
      }
    } catch { /* unknown: try to file, the server says if there's no tracker */ }
    updateCreate();
  }
  const mode = createMode();
  if (mode === 'draft') return startFiling('draft', 'link');
  if (mode === 'prompt') return fixAgent ? startFiling('draft', 'prompt') : openAgentPicker(() => startFiling('draft', 'prompt'));
  if (trackerFixLabel()) {
    await openAppTab(`${APP_URL}/connections#tracker`, `${APP_URL}/connections*`);
    window.close();
    return;
  }
  startFiling('ticket');
}

// A ticket that failed in the background while a new draft was already in
// progress: say so, and offer it back (the two swap, nothing is dropped).
function showFailedDraft(failed) {
  showInlineError(`A ticket didn’t file: ${failed.fileError || 'unknown error'}`, {
    label: 'Bring it back',
    run: async () => {
      const now = await getDraft();
      await chrome.storage.local.set({ failedDraft: now && isReadyDraft(now) ? { ...now, fileError: null } : null });
      await setDraft({ ...failed, fileError: null });
      if (!(now && isReadyDraft(now))) await chrome.storage.local.remove('failedDraft');
      clearInlineError();
    },
  });
}

// ---------- tickets tab + cloud button ----------
// A filed ticket goes to the list behind the cloud button: a dot flies there
// from Create, the button lands it, and a dot stays until the list is opened.
function flyToCloud(fromEl = createBtn) {
  const from = fromEl.getBoundingClientRect();
  const to = briefCloudBtn.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'fly-dot';
  dot.style.left = `${from.left + from.width / 2 - 6}px`;
  dot.style.top = `${from.top + from.height / 2 - 6}px`;
  document.body.appendChild(dot);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const fly = dot.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 40}px) scale(1.15)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0.2 },
  ], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
  fly.onfinish = () => {
    dot.remove();
    briefCloudBtn.classList.remove('landed');
    void briefCloudBtn.offsetWidth; // restart the animation
    briefCloudBtn.classList.add('landed', 'unseen');
    setTimeout(() => briefCloudBtn.classList.remove('landed'), 700);
  };
}
chrome.storage.local.get('ticketsUnseen').then(({ ticketsUnseen }) => {
  if (ticketsUnseen) briefCloudBtn?.classList.add('unseen');
}).catch(() => {});

// Take `url` in a Brief Cloud tab already open, rather than piling up tabs:
// one already on `prefer` (URL patterns) first, else any app tab, else a new one.
async function openAppTab(url, prefer) {
  try {
    for (const pattern of [prefer, `${APP_URL}/*`]) {
      const tabs = await chrome.tabs.query({ url: pattern });
      if (tabs.length && tabs[0].id != null) {
        const tab = tabs[0];
        await chrome.tabs.update(tab.id, { active: true, url });
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
        return;
      }
    }
  } catch {}
  await chrome.tabs.create({ url }).catch(() => {});
}

// The cloud button opens the list the last capture landed in: Drafts after a
// draft, Tickets otherwise.
async function openTicketsTab() {
  const { unseenView } = await chrome.storage.local.get('unseenView').catch(() => ({}));
  const TICKETS_URL = unseenView === 'drafts' ? `${APP_URL}/drafts` : TICKETS_URL_BASE;
  await openAppTab(TICKETS_URL, [`${TICKETS_URL_BASE}*`, `${APP_URL}/drafts*`]);
}
// Not paired yet, the cloud button reads "Connect": a click opens the pairing
// page instead of the tickets list.
function renderCloudLink() {
  briefCloudBtn?.classList.toggle('unlinked', !bcConnected);
  briefCloudBtn?.setAttribute('aria-label', bcConnected ? 'Open Brief Cloud' : 'Connect to Brief Cloud');
}

// A tracker that files but should be reconnected (Linear, Jira or GitHub still
// held by Clerk): a slim link above Create, which stays enabled. It opens the
// tracker row of Connections.
// A tracker that files but should be reconnected (still on Clerk). With none
// that files, the fix is the first item of Create's menu instead, and a dot
// on its ▾ says so.
function renderReconnect() {
  if (!reconnectBtn) return;
  const show = bcTrackerAction === 'reconnect' && !!bcTracker;
  reconnectBtn.hidden = !show;
  if (show) reconnectBtn.querySelector('.reconnect-label').textContent = `Reconnect ${trackerName()}`;
}
reconnectBtn?.addEventListener('click', async () => {
  await openAppTab(`${APP_URL}/connections#tracker`, `${APP_URL}/connections*`);
  window.close();
});
briefCloudBtn?.addEventListener('click', async () => {
  let token = null; try { token = await getCloudToken(); } catch {}
  if (token) await openTicketsTab();
  else await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
  chrome.storage.local.remove(['ticketsUnseen', 'unseenView']).catch(() => {});
  window.close();
});

// ---------- voice dictation (description + screenshot notes) ----------
function attachVoiceDictation(textarea, container, onCommit) {
  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1.5a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0v-7a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'desc-mic'; btn.title = 'Record a voice note'; btn.setAttribute('aria-label', 'Record a voice note'); btn.innerHTML = MIC;
  container.appendChild(btn);

  let msgEl = null;
  function flash(text) {
    if (!msgEl) { msgEl = document.createElement('div'); msgEl.className = 'desc-mic-msg'; container.appendChild(msgEl); }
    msgEl.textContent = text;
    msgEl.classList.add('show');
    setTimeout(() => { if (msgEl) msgEl.classList.remove('show'); }, 2200);
  }

  let state = 'idle', rec = null, stream = null, chunks = [], capTimer = null;
  let meterCtx = null, meterRaf = null;
  function setState(s) {
    state = s;
    btn.classList.toggle('rec', s === 'recording'); btn.classList.toggle('busy', s === 'busy');
    btn.title = s === 'recording' ? 'Stop recording' : 'Record a voice note';
    btn.innerHTML = s === 'recording' ? '<span class="mic-stop"></span>' : s === 'busy' ? '<span class="mic-spin"></span>' : MIC;
  }
  function teardown() { stopMeter(); if (capTimer) { clearTimeout(capTimer); capTimer = null; } if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } rec = null; chunks = []; }

  // Live voice halo: an analyser drives a ring around the mic that grows and
  // brightens with your voice, so the button visibly "hears" you.
  function startMeter(s) {
    try {
      meterCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = meterCtx.createAnalyser();
      analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.85;
      meterCtx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lvl = 0;
      const draw = () => {
        analyser.getByteFrequencyData(data);
        let peak = 0;
        for (let i = 2; i < 28; i++) if (data[i] > peak) peak = data[i];
        const target = Math.min(1, Math.pow(peak / 255, 1.3));
        lvl += (target - lvl) * 0.18; // ease so the ring glides, never jumps
        const spread = (2 + lvl * 6).toFixed(2);
        const alpha = (0.1 + lvl * 0.28).toFixed(3);
        btn.style.boxShadow = `0 0 0 ${spread}px rgba(221, 105, 54, ${alpha})`;
        meterRaf = requestAnimationFrame(draw);
      };
      draw();
    } catch { meterCtx = null; }
  }
  function stopMeter() {
    if (meterRaf) cancelAnimationFrame(meterRaf);
    meterRaf = null; btn.style.boxShadow = '';
    if (meterCtx) { meterCtx.close().catch(() => {}); meterCtx = null; }
  }

  async function start() {
    let s; try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { flash('Allow mic access'); return; }
    stream = s; chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    try { rec = new MediaRecorder(stream, { mimeType: mime }); } catch { teardown(); flash('Recording unavailable'); return; }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = onStop; rec.start(); setState('recording'); startMeter(stream);
    capTimer = setTimeout(() => { if (state === 'recording') stop(); }, 60000);
  }
  function stop() { if (capTimer) { clearTimeout(capTimer); capTimer = null; } try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {} }
  async function onStop() {
    const blob = new Blob(chunks, { type: 'audio/webm' }); teardown();
    if (!blob.size) { setState('idle'); return; }
    setState('busy');
    try {
      const text = await transcribeNote(blob);
      if (text) {
        const cur = (textarea.value || '').trim();
        textarea.value = cur ? `${cur} ${text}` : text;
        textarea.dispatchEvent(new Event('input'));
        textarea.focus();
        try { textarea.setSelectionRange(textarea.value.length, textarea.value.length); } catch {}
        await onCommit();
      } else { flash('Didn’t catch that'); }
    } catch (err) { console.warn('[brief/popup] dictation failed:', err); flash('Transcription failed'); }
    finally { setState('idle'); }
  }
  btn.addEventListener('click', () => { if (state === 'recording') stop(); else if (state === 'idle') start(); });
}

// ---------- account status ----------
// Whether the caret shows depends on which tracker the account has, and that
// costs a network round trip. Asking first and rendering after meant the popup
// painted, then grew a caret ~700ms later while the primary button shrank to
// make room. So: remember the last answer, open in that shape, and only touch
// the DOM if the truth turns out to be different.
// Stored as { tracker, trackerName, trackerIssue, trackerAction }. A cache
// written before trackerName, trackerIssue or trackerAction existed still reads
// fine: the name falls back to TRACKER_NAMES and the action to none (a plain
// "Connect a tracker" once the account reads as paired), until the next
// /api/me answer rewrites it.
const TRACKER_CACHE_KEY = 'bcTrackerCache';
async function readTrackerCache() {
  try {
    const { [TRACKER_CACHE_KEY]: c } = await chrome.storage.local.get(TRACKER_CACHE_KEY);
    if (!c || typeof c !== 'object') return { tracker: undefined, trackerName: null, trackerIssue: null, trackerAction: null }; // undefined = never asked
    return {
      tracker: c.tracker ?? null,
      trackerName: typeof c.trackerName === 'string' ? c.trackerName : null,
      trackerIssue: typeof c.trackerIssue === 'string' ? c.trackerIssue : null,
      trackerAction: TRACKER_ACTIONS.includes(c.trackerAction) ? c.trackerAction : null,
    };
  } catch { return { tracker: undefined, trackerName: null, trackerIssue: null, trackerAction: null }; }
}
function writeTrackerCache(tracker, trackerName, trackerIssue, trackerAction) {
  try {
    return chrome.storage.local.set({
      [TRACKER_CACHE_KEY]: {
        tracker: tracker ?? null,
        trackerName: trackerName ?? null,
        trackerIssue: trackerIssue ?? null,
        trackerAction: trackerAction ?? null,
      },
    });
  } catch { return Promise.resolve(); }
}

async function bcRefresh() {
  let token = null; try { token = await getCloudToken(); } catch {}
  bcConnected = !!token;
  renderCloudLink();
  // Not paired: there is no tracker to have, so don't leave a remembered caret
  // waiting for the next open.
  if (!token) {
    await writeTrackerCache(null, null, null, null);
    bcTrackerName = null; bcTrackerIssue = null; bcTrackerAction = null;
    updateCreate(); renderReconnect();
    return;
  }
  try {
    const status = await fetchAccountStatus();
    if (!status) return;
    bcConnected = status.connected;
    renderCloudLink();
    const tracker = status.tracker ?? null;
    const name = status.trackerName ?? null;
    const issue = tracker ? null : status.trackerIssue ?? null;
    const action = status.connected ? status.trackerAction ?? null : null;
    await writeTrackerCache(tracker, name, issue, action);
    bcTrackerName = name;
    bcTrackerIssue = issue;
    bcTrackerAction = action;
    // The label can change without the tracker changing (a reconnect becomes
    // a pick), so always; it only rewrites the button's own text.
    bcTracker = tracker;
    updateCreate();
    renderReconnect();
  } catch {}
}

// ---------- wiring ----------
gallery.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    const id = rm.getAttribute('data-rm');
    const tile = rm.closest('.tile');
    if (tile) { tile.classList.add('removing'); await new Promise((r) => setTimeout(r, 230)); }
    if (id === 'replay') {
      await persist((d) => { d.replay = null; });
      deleteFile(replayKey(draft.id)).catch(() => {});
      deleteFile(replayVoiceKey(draft.id)).catch(() => {});
      toast('Replay removed');
    } else if (id === 'rec') {
      await persist((d) => { clearAutoDescription(d); d.recording = null; d.cloudBriefId = null; d.transcript = ''; d.transcribing = false; d.describing = false; d.transcriptFailed = false; d.includeVideo = false; });
      deleteFile(recKey(draft.id)).catch(() => {});
      toast('Recording removed');
    } else {
      await persist((d) => { d.screenshots = (d.screenshots || []).filter((x) => x.id !== id); });
      deleteFile(shotKey(id)).catch(() => {});
      toast('Screenshot removed');
    }
    renderGallery(); updateCreate(); syncDescriptionFromDraft(); renderDescState(); lastSig = sig(draft);
    return;
  }
  if (e.target.closest('[data-add]')) return openAddChooser();
  if (e.target.closest('[data-rec]')) return openRec();
  if (e.target.closest('[data-rep]')) return openRep();
  const shot = e.target.closest('[data-shot]');
  if (shot) return openShot(shot.getAttribute('data-shot'));
});
createBtn.addEventListener('click', () => { closeCreateMenu(); primaryCreate(); });
createMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (createMenu.classList.contains('open')) closeCreateMenu(); else openCreateMenu();
});
createMenu.addEventListener('click', (e) => {
  const it = e.target.closest('.cm-item');
  if (it) pickCreateMode(it.dataset.key);
});
document.addEventListener('click', (e) => {
  if (createMenu.classList.contains('open') && !e.target.closest('#createMenu')) closeCreateMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && createMenu.classList.contains('open')) { e.stopPropagation(); closeCreateMenu(); createMenuBtn.focus(); }
}, true);
resetBtn?.addEventListener('click', openReset);

// ---------- boot ----------
(async function boot() {
  await migrateInboxToDraft().catch(() => {});
  const existing = await getDraft();
  if (existing) draft = existing;
  else { draft = emptyDraft(); await setDraft(draft); }
  // The tracker we saw last time, read before the first paint, so the Create
  // button opens at its final width instead of settling once /api/me answers.
  ({ tracker: bcTracker, trackerName: bcTrackerName, trackerIssue: bcTrackerIssue, trackerAction: bcTrackerAction } = await readTrackerCache());
  // and what the button does, as picked last time
  try {
    const { createDefault: picked, fixAgent: agent } = await chrome.storage.local.get(['createDefault', 'fixAgent']);
    if (CREATE_MODES.includes(picked)) createDefault = picked;
    if (Object.hasOwn(FIX_AGENTS, agent)) fixAgent = agent;
  } catch {}
  renderReconnect();
  // Same for the cloud button: open already reading "Connect" when unpaired.
  bcConnected = !!(await getCloudToken().catch(() => null));
  renderCloudLink();
  // Filing runs in the worker, so it can finish - or fail - while the popup is
  // closed. Unstick a flag left by a worker recycled mid-flow, and surface a
  // failure once (the badge showed "!" until now).
  if (draft.filing && Date.now() - (draft.filingStartedAt || 0) > 120000) {
    await persist((d) => { d.filing = false; d.fileError = d.fileError || 'Filing was interrupted. Try again.'; });
  }
  render();
  initAdditionalData();
  // Replay sites are set per org on the web app; pick up changes on open.
  syncReplaySites().catch(() => {});
  firstRender = true; reveal();
  readTicketsInFlight();
  try {
    const { failedDraft } = await chrome.storage.local.get('failedDraft');
    if (failedDraft) showFailedDraft(failedDraft);
  } catch {}
  // A one-click report (shortcut / right-click) that didn't go through: say
  // why, once - the toolbar icon could only show "!".
  try {
    const { autoReportLog = [], autoReportSeen = 0 } = await chrome.storage.local.get(['autoReportLog', 'autoReportSeen']);
    const last = autoReportLog[0];
    if (last && !last.ok && last.at > autoReportSeen && Date.now() - last.at < 30 * 60_000) {
      showInlineError(`Brief it didn’t work: ${last.error}${last.detail ? ` (${last.detail})` : ''}`);
    }
    if (last) await chrome.storage.local.set({ autoReportSeen: last.at });
  } catch {}
  if (draft.fileError && !draft.filing) {
    showInlineError(`Couldn’t create brief: ${draft.fileError}`);
    await persist((d) => { d.fileError = null; });
    lastSig = sig(draft);
  }
  // After capturing a screenshot or recording, open its editor automatically so
  // the user can add a note / review it right away.
  try {
    const { pendingOpen } = await chrome.storage.local.get('pendingOpen');
    await chrome.storage.local.remove('pendingOpen');
    if (pendingOpen && Date.now() - pendingOpen.at < 30000) {
      if (pendingOpen.kind === 'shot' && (draft.screenshots || []).some((s) => s.id === pendingOpen.id)) openShot(pendingOpen.id);
      else if (pendingOpen.kind === 'rec' && draft.recording) openRec();
    }
  } catch {}
  bcRefresh();
})();

// Live updates when a BACKGROUND change settles (upload, transcript, poster).
chrome.storage.onChanged.addListener((changes, area) => {
  // A ticket handed to the server is only queued: the agent writes and files
  // it there afterwards, so nothing here says "created" (the cloud's dot leads
  // to the list, where its real state shows).
  if (area === 'local' && changes.filingDrafts) readTicketsInFlight();
  if (area === 'local' && changes.briefCloudToken) bcRefresh();
  if (area === 'local' && changes.failedDraft?.newValue) showFailedDraft(changes.failedDraft.newValue);
  if (area !== 'local' || !changes.draft) return;
  getDraft().then((d) => {
    // Storage is the source of truth. If it momentarily reads empty (e.g. mid
    // reset, between clear and set), do NOT fabricate a fresh-id draft here -
    // it would diverge from what's stored and silently break every later save.
    if (!d) return;
    if (sig(d) === lastSig) return;
    // A different draft (the last one was filed and a fresh one started while
    // the popup stayed open): its description and fields replace the old ones.
    const fresh = d.id !== draft?.id;
    draft = d;
    render();
    if (fresh) syncAdditionalData();
    else syncDescriptionFromDraft();
    // If the recording sheet is open, patch it IN PLACE so a freshly-arrived
    // transcript or poster shows without re-opening the sheet (which glitched).
    if (currentSheet === 'rec') {
      // When the transcribing state flips (transcribing -> ready/failed), rebuild
      // the sheet once so the animation swaps to the editable field. Otherwise
      // patch in place so a poster/transcript arriving doesn't disrupt the user.
      const showingTranscribing = !!document.getElementById('trState');
      const wrap = document.getElementById('trWrap');
      if (showingTranscribing !== !!draft.transcribing && wrap) {
        // Swap JUST the transcript block - reopening the sheet would restart the
        // video the reporter may be watching.
        wrap.innerHTML = transcriptBlockHTML();
        wireTranscript(wrap);
      } else {
        const tf = document.getElementById('recTranscript');
        if (tf && document.activeElement !== tf && draft.transcript && draft.transcript.trim()) tf.value = draft.transcript;
        const pf = document.querySelector('#sheetBody .rec-poster');
        if (pf && draft.recording?.poster) pf.src = draft.recording.poster;
        const pv = document.querySelector('#sheetBody video.rec-vid');
        if (pv && draft.recording?.poster) pv.poster = draft.recording.poster;
      }
    }
  });
});
