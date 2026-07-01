// Brief - popup (Evidence gallery + Describe, with bottom sheets)
//
// One brief at a time (extension/draft.js). Evidence holds screenshots AND the
// recording as tiles; Describe holds the description + custom fields. Editing
// happens in bottom sheets. Capture (screenshot/video) runs on the page, so those
// actions close the popup and it reopens when the capture lands.

import { APP_URL, TICKETS_URL, getCloudToken, fetchAccountStatus, uploadDraft, uploadFilesToDraft, processBrief, createDraft, briefPageUrl, transcribeNote } from './cloud.js';
import { getDraft, setDraft, clearDraft, updateDraft, emptyDraft, isReadyDraft, migrateInboxToDraft } from './draft.js';

const $ = (s, r) => (r || document).querySelector(s);
const gallery = $('#gallery');
const evCount = $('#evCount');
const descWrap = $('#descWrap');
const descField = $('#descField');
const kvList = $('#kvList');
const addFieldBtn = $('#addFieldBtn');
const createBtn = $('#createBtn');
const createMenuBtn = $('#createMenuBtn');
const createMenu = $('#createMenu');
const draftItem = $('#draftItem');
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

const MAX_SHOTS = 3;

let draft = emptyDraft();
let bcConnected = false;
let bcTracker;
let filing = false;
let currentSheet = null; // 'shot:<id>' | 'rec' | 'chooser' | 'reset' | null
let lastSig = '';

// Generic video poster when the recording's keyframe poster hasn't landed yet.
const REC_FALLBACK = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='%23fbfaf7'/><rect width='320' height='26' fill='%23ece6d6'/><circle cx='14' cy='13' r='4' fill='%23dd6936'/><circle cx='28' cy='13' r='4' fill='%23d9d2c4'/><circle cx='42' cy='13' r='4' fill='%23d9d2c4'/><g fill='%23d9d2c4'><rect x='16' y='52' width='200' height='10' rx='3'/><rect x='16' y='78' width='250' height='10' rx='3'/><rect x='16' y='104' width='150' height='10' rx='3'/></g></svg>";

exportDone.hidden = true;

// ---------- helpers ----------
function esc(s) { return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function genShotId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}
async function persist(patch) {
  const updated = await updateDraft(draft.id, patch);
  if (updated) draft = updated;
  return updated;
}

// ---------- mic pre-flight (reveal UI) ----------
const MIC_CACHE_KEY = 'micGrantedAt';
const MIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
(async () => {
  const { [MIC_CACHE_KEY]: grantedAt } = await chrome.storage.local.get(MIC_CACHE_KEY);
  if (grantedAt && Date.now() - grantedAt < MIC_CACHE_TTL_MS) {
    document.body.classList.add('ready');
    probeMic().then((ok) => ok ? chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() }) : chrome.storage.local.remove(MIC_CACHE_KEY));
    return;
  }
  const ok = await probeMic();
  if (!ok) { await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }); window.close(); return; }
  await chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() });
  document.body.classList.add('ready');
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
  bar.classList.add('show');
}
function clearInlineError() { $('#errBar').classList.remove('show'); $('#errBar').textContent = ''; }

// ---------- signature (background-change detection) ----------
function sig(d) {
  if (!d) return 'none';
  return [
    (d.screenshots || []).length,
    !!d.recording, d.recording?.poster ? 1 : 0,
    d.uploading, d.uploadFailed, d.cloudBriefId || '',
    d.transcribing, d.transcriptFailed, !!(d.transcript && d.transcript.trim()),
  ].join('|');
}

// ---------- render ----------
function setBrandSpin(on) { brandMark?.classList.toggle('spinning', !!on); }
function render() {
  renderGallery();
  updateCreate();
  setBrandSpin(filing || !!draft.uploading);
  lastSig = sig(draft);
}

const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
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
      `<div class="rec-foot"><span class="${dotCls}"></span>${footLabel}</div>` +
      `</div>`;
  }

  const canAddShot = shots.length < MAX_SHOTS;
  const canAddVideo = !draft.recording;
  if (canAddShot || canAddVideo) {
    html += `<div class="tile add" data-add="1">` +
      `<span class="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>` +
      `<span class="add-lbl">Add</span></div>`;
  }

  gallery.innerHTML = html;
  evCount.textContent = String(shots.length + (draft.recording ? 1 : 0));
}

// ---------- additional data (inline: description + custom fields) ----------
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
function syncAdditionalData() {
  descField.value = draft.description || '';
  renderKvRows();
}
function initAdditionalData() {
  const persistDesc = () => persist((d) => { d.description = descField.value; }).then(updateCreate);
  let dt = null;
  descField.addEventListener('input', () => { clearTimeout(dt); dt = setTimeout(persistDesc, 250); });
  descField.addEventListener('blur', () => { clearTimeout(dt); persistDesc(); });
  attachVoiceDictation(descField, descWrap, persistDesc);
  kvList.addEventListener('input', persistKv);
  kvList.addEventListener('click', (e) => { const fx = e.target.closest('.fx'); if (fx) { fx.closest('.sheet-field').remove(); persistKv(); } });
  addFieldBtn.addEventListener('click', () => {
    kvList.insertAdjacentHTML('beforeend', fieldRowHTML({ key: '', value: '' }));
    $('.k', kvList.lastElementChild)?.focus();
  });
  syncAdditionalData();
}

function updateCreate() {
  if (filing) return;
  const label = createBtn.querySelector('.ctk-label');
  const noTracker = bcTracker === null;
  if (draft.uploading) {
    createBtn.disabled = true;
    if (label) label.textContent = 'Uploading…'; else createBtn.textContent = 'Uploading…';
    if (createMenuBtn) createMenuBtn.hidden = true;
  } else {
    const ready = isReadyDraft(draft);
    createBtn.disabled = !ready;
    // Tracker connected → the default action files directly ("Create ticket"),
    // with "Save as draft" behind the caret. No tracker → the default IS the
    // draft ("Create draft"), no caret.
    if (label) label.textContent = noTracker ? 'Create draft' : 'Create ticket';
    // Caret ("Save as draft") only once we know a tracker is connected. While
    // status is still unknown (bcTracker === undefined) keep it hidden.
    if (createMenuBtn) createMenuBtn.hidden = !bcTracker || !ready;
  }
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
}
sheetAction.addEventListener('click', () => { if (sheetActionHandler) sheetActionHandler(); });
function closeSheet() {
  sheet.classList.remove('open');
  scrim.classList.remove('open');
  document.body.classList.remove('sheet-open');
  currentSheet = null;
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
  const body =
    `<div class="shot-preview"><img src="${s.dataUrl}" alt="Screenshot ${idx + 1}"></div>` +
    `<div class="field-label">Note</div>` +
    `<div class="ai-wrap" id="shotNoteWrap"><textarea class="ai-field has-mic" id="shotNote" placeholder="Add a note for this screenshot">${esc(s.description || '')}</textarea></div>`;
  const retake = async () => {
    await persist((d) => { d.screenshots = (d.screenshots || []).filter((x) => x.id !== id); });
    takeScreenshot(); // captures a fresh one (closes the popup)
  };
  openSheet(`Screenshot <em>${idx + 1}</em>`, body, (root) => {
    const ta = $('#shotNote', root);
    ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch {}
    const persistNote = () => persist((d) => { const h = (d.screenshots || []).find((x) => x.id === id); if (h) h.description = ta.value; });
    let t = null;
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(persistNote, 250); });
    attachVoiceDictation(ta, $('#shotNoteWrap', root), persistNote);
  }, 'shot:' + id, { html: REFRESH_SVG, title: 'Retake', onClick: retake }, true);
}

// ---------- recording sheet ----------
function openRec() {
  const r = draft.recording;
  if (!r) return;
  const poster = r.poster || REC_FALLBACK;
  // While transcribing: a non-editable animated placeholder (user can't type into
  // it). When done: the editable field. The swap happens once (see the storage
  // listener), so it never glitches.
  const phold = draft.transcriptFailed ? 'Auto-transcription failed - type it here' : 'Transcript';
  const trBlock = draft.transcribing
    ? `<div class="transcribing" id="trState" role="status" aria-live="polite"><span class="tr-dots"><i></i><i></i><i></i></span><span class="tr-label">Transcribing</span></div>`
    : `<div class="ai-wrap"><textarea class="ai-field transcript has-mic" id="recTranscript" placeholder="${phold}">${esc(draft.transcript || '')}</textarea></div>`;
  const body =
    `<img class="rec-poster" src="${poster}" alt="Recording preview">` +
    `<div class="field-label">Transcript</div>` +
    `<div id="trWrap">${trBlock}</div>` +
    `<div class="toggle-row"><span class="lbl">Attach the video to the ticket</span>` +
      `<button class="switch${draft.includeVideo ? ' on' : ''}" id="recAttach" role="switch" aria-checked="${!!draft.includeVideo}"><span class="knob"></span></button></div>`;
  openSheet('Recording', body, (root) => {
    const ta = $('#recTranscript', root);
    if (ta) {
      let t = null;
      const persistTr = () => persist((d) => { d.transcript = ta.value; });
      ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(persistTr, 250); });
      // Same voice-record mic as a screenshot note: dictate corrections/additions
      // straight into the transcript.
      attachVoiceDictation(ta, ta.parentElement, persistTr);
    }
    const sw = $('#recAttach', root);
    sw.addEventListener('click', async () => {
      await persist((d) => { d.includeVideo = !d.includeVideo; });
      sw.classList.toggle('on', draft.includeVideo);
      sw.setAttribute('aria-checked', String(!!draft.includeVideo));
    });
  }, 'rec', { html: REFRESH_SVG, title: 'Re-record', onClick: () => recordBrief() }, true);
}

// ---------- add chooser ----------
function openAddChooser() {
  const shots = (draft.screenshots || []).length;
  const canShot = shots < MAX_SHOTS;
  const canVid = !draft.recording;
  const body = `<div class="chooser">` +
    `<button class="choice" id="chShot" ${canShot ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 17-5-5-4 4-2-2-4 4"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Screenshot</span><span class="cs">${canShot ? `${shots} of ${MAX_SHOTS}` : 'Limit reached'}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `<button class="choice" id="chVid" ${canVid ? '' : 'disabled'}>` +
      `<span class="cico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m10 8 6 4-6 4z"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg></span>` +
      `<span class="ctxt"><span class="ct">Video</span><span class="cs">${canVid ? 'Record the screen' : 'Already added'}</span></span>` +
      `<span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></span></button>` +
    `</div>`;
  openSheet('Add to <em>brief</em>', body, (root) => {
    if (canShot) $('#chShot', root).addEventListener('click', () => takeScreenshot());
    if (canVid) $('#chVid', root).addEventListener('click', () => recordBrief());
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
async function recordBrief() {
  clearInlineError();
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) { showInlineError('Switch to a regular web page to record.'); return; }
    try { await chrome.runtime.sendMessage({ type: 'RESET_BEFORE_NEW_RECORDING' }); } catch {}
    await ensureContentScript(tab.id);
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError || !id) reject(new Error(chrome.runtime.lastError?.message || 'no_stream_id')); else resolve(id);
      });
    });
    await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_BAR', streamId, intent: 'brief', mode: 'inbox', itemId: draft.id });
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

// ---------- filing ----------
async function activePageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) return null;
    return { url: tab.url, title: tab.title || null };
  } catch { return null; }
}
function buildScreenshotFiles(d) {
  return (d.screenshots || []).map((s) => ({ name: `screenshots/${s.id}.png`, blob: new Blob([dataUrlToBytes(s.dataUrl)], { type: 'image/png' }), contentType: 'image/png' }));
}
function buildOverrides(d) {
  return {
    title: d.name || '',
    includeVideo: !!d.includeVideo,
    transcript: d.transcript || '',
    description: d.description || '',
    extra: (d.extra || []).filter((p) => (p.key || '').trim() || (p.value || '').trim()),
    screenshots: (d.screenshots || []).map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated })),
  };
}
function buildBriefJsonAndMeta(d, page) {
  const pageUrl = d.pageUrl || page?.url || null;
  const pageTitle = d.pageTitle || page?.title || null;
  const briefJson = {
    id: d.id, name: d.name || '', createdAt: d.createdAt || Date.now(),
    source: d.recording ? 'recording' : ((d.screenshots || []).length ? 'screenshot' : 'text'),
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
function openBrief(shareId) {
  const t = exportDone.querySelector('.export-done-title');
  const s = exportDone.querySelector('.export-done-sub');
  if (t) t.textContent = 'Brief created';
  if (s) s.textContent = 'Opening your brief…';
  exportDone.hidden = false;
  setTimeout(() => {
    if (shareId) chrome.tabs.create({ url: briefPageUrl(shareId) }).catch(() => {});
    else openTicketsTab();
    window.close();
  }, 1200);
}
function failCreate(err) {
  filing = false;
  setBrandSpin(false);
  createBtn.disabled = false;
  if (createMenuBtn) createMenuBtn.disabled = false;
  updateCreate(); // restores the right label ("Create ticket" / "Create draft") + caret
  showInlineError(`Couldn’t create brief: ${err?.message || err}`);
}

// Direct-file confirmation: the ticket was queued to the tracker and is written
// in the background; land on /tickets where it appears (writing -> filed). A
// filed ticket isn't a draft, so there's no Brief page to open.
function showFiledAndOpen() {
  const t = exportDone.querySelector('.export-done-title');
  const s = exportDone.querySelector('.export-done-sub');
  const tracker = bcTracker === 'jira' ? 'Jira' : bcTracker === 'linear' ? 'Linear' : 'your tracker';
  if (t) t.textContent = `Filing to ${tracker}`;
  if (s) s.textContent = 'Opening your tickets…';
  exportDone.hidden = false;
  setTimeout(() => { openTicketsTab(); window.close(); }, 1200);
}
function closeCreateMenu() { if (createMenu) createMenu.hidden = true; }
// Ensure the brief is uploaded as a cloud draft (creates it + uploads brief.json
// and screenshots on first send, or pushes new screenshots into an existing
// draft). Shared by filing and "save as draft".
async function ensureUploaded() {
  const shotFiles = buildScreenshotFiles(draft);
  if (!draft.cloudBriefId) {
    const page = await activePageContext();
    const { files, meta } = buildBriefJsonAndMeta(draft, page);
    const id = await uploadDraft([...files, ...shotFiles], meta);
    await persist((d) => { d.cloudBriefId = id; });
  } else if (shotFiles.length) {
    await uploadFilesToDraft(draft.cloudBriefId, shotFiles);
  }
}

// One action. Always creates the Brief page; if a tracker is connected it also
// files the ticket (the brief page becomes the linked record). Either way we
// land on the brief page, which shows the "writing…" state and resolves itself.
async function createBrief() {
  clearInlineError();
  closeCreateMenu();
  if (!isReadyDraft(draft) || draft.uploading) return;
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }

  filing = true;
  setBrandSpin(true);
  createBtn.disabled = true;
  if (createMenuBtn) createMenuBtn.disabled = true;
  const label = createBtn.querySelector('.ctk-label');
  if (label) label.innerHTML = '<span class="btn-spin"></span> Creating…';

  let shareId = null;
  const run = async () => {
    await ensureUploaded();
    // Always create ONE Brief (a draft + its page). The owner sends it to a
    // tracker from the page when ready, so a capture is never two tickets at
    // once - it's one Brief that progresses draft -> filed.
    shareId = await createDraft(draft.cloudBriefId, buildOverrides(draft));
  };

  try {
    await run();
  } catch (err) {
    if (err?.status === 404 && draft.cloudBriefId) {
      try { await persist((d) => { d.cloudBriefId = null; }); await run(); }
      catch (err2) { return failCreate(err2); }
    } else { return failCreate(err); }
  }
  await clearDraft();
  draft = emptyDraft();
  await setDraft(draft);
  openBrief(shareId);
}

// The primary "Create ticket" action. With a tracker connected we file directly
// (queued, written in the background) and land on /tickets. With no tracker the
// primary IS the draft. If we don't yet know the tracker status (fast click on
// open), resolve it first so we route correctly.
async function primaryCreate() {
  if (bcTracker === undefined) {
    try {
      const st = await fetchAccountStatus();
      if (st) { bcConnected = st.connected; bcTracker = st.tracker; }
    } catch { /* fall through: treat as draft, which always works */ }
    updateCreate();
  }
  if (bcTracker) fileTicket();
  else createBrief();
}

// File the brief DIRECTLY to the connected tracker (Linear/Jira). The /process
// route queues it and writes it in the background; we don't open a Brief page
// (a filed ticket isn't a draft) - we land on /tickets where it shows up.
async function fileTicket() {
  clearInlineError();
  closeCreateMenu();
  if (!isReadyDraft(draft) || draft.uploading) return;
  let token = null; try { token = await getCloudToken(); } catch {}
  if (!token) { await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {}); window.close(); return; }

  filing = true;
  setBrandSpin(true);
  createBtn.disabled = true;
  if (createMenuBtn) createMenuBtn.disabled = true;
  const label = createBtn.querySelector('.ctk-label');
  if (label) label.innerHTML = '<span class="btn-spin"></span> Filing…';

  const run = async () => {
    await ensureUploaded();
    await processBrief(draft.cloudBriefId, buildOverrides(draft));
  };

  try {
    await run();
  } catch (err) {
    if (err?.status === 404 && draft.cloudBriefId) {
      try { await persist((d) => { d.cloudBriefId = null; }); await run(); }
      catch (err2) { return failCreate(err2); }
    } else { return failCreate(err); }
  }
  await clearDraft();
  draft = emptyDraft();
  await setDraft(draft);
  showFiledAndOpen();
}

// ---------- tickets tab + cloud button ----------
async function openTicketsTab() {
  try {
    const ticketTabs = await chrome.tabs.query({ url: `${TICKETS_URL}*` });
    if (ticketTabs.length && ticketTabs[0].id != null) {
      const tab = ticketTabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
      chrome.tabs.reload(tab.id); return;
    }
    const appTabs = await chrome.tabs.query({ url: `${APP_URL}/*` });
    if (appTabs.length && appTabs[0].id != null) {
      const tab = appTabs[0];
      await chrome.tabs.update(tab.id, { active: true, url: TICKETS_URL });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
      return;
    }
  } catch {}
  await chrome.tabs.create({ url: TICKETS_URL }).catch(() => {});
}
briefCloudBtn?.addEventListener('click', async () => {
  let token = null; try { token = await getCloudToken(); } catch {}
  if (token) await openTicketsTab();
  else await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
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
async function bcRefresh() {
  let token = null; try { token = await getCloudToken(); } catch {}
  bcConnected = !!token;
  if (!token) return;
  try { const status = await fetchAccountStatus(); if (!status) return; bcConnected = status.connected; bcTracker = status.tracker; updateCreate(); } catch {}
}

// ---------- wiring ----------
gallery.addEventListener('click', async (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    const id = rm.getAttribute('data-rm');
    const tile = rm.closest('.tile');
    if (tile) { tile.classList.add('removing'); await new Promise((r) => setTimeout(r, 230)); }
    if (id === 'rec') { await persist((d) => { d.recording = null; d.cloudBriefId = null; d.transcript = ''; d.transcribing = false; d.transcriptFailed = false; d.includeVideo = false; }); toast('Recording removed'); }
    else { await persist((d) => { d.screenshots = (d.screenshots || []).filter((x) => x.id !== id); }); toast('Screenshot removed'); }
    renderGallery(); updateCreate(); lastSig = sig(draft);
    return;
  }
  if (e.target.closest('[data-add]')) return openAddChooser();
  if (e.target.closest('[data-rec]')) return openRec();
  const shot = e.target.closest('[data-shot]');
  if (shot) return openShot(shot.getAttribute('data-shot'));
});
createBtn.addEventListener('click', primaryCreate);
createMenuBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (createMenu) createMenu.hidden = !createMenu.hidden; });
draftItem?.addEventListener('click', createBrief);
document.addEventListener('click', (e) => {
  if (createMenu && !createMenu.hidden && !e.target.closest('.create-wrap')) closeCreateMenu();
});
resetBtn?.addEventListener('click', openReset);

// ---------- boot ----------
(async function boot() {
  await migrateInboxToDraft().catch(() => {});
  const existing = await getDraft();
  if (existing) draft = existing;
  else { draft = emptyDraft(); await setDraft(draft); }
  render();
  initAdditionalData();
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
  if (area !== 'local' || !changes.draft || filing) return;
  getDraft().then((d) => {
    // Storage is the source of truth. If it momentarily reads empty (e.g. mid
    // reset, between clear and set), do NOT fabricate a fresh-id draft here -
    // it would diverge from what's stored and silently break every later save.
    if (!d) return;
    if (sig(d) === lastSig) return;
    draft = d;
    render();
    // If the recording sheet is open, patch it IN PLACE so a freshly-arrived
    // transcript or poster shows without re-opening the sheet (which glitched).
    if (currentSheet === 'rec') {
      // When the transcribing state flips (transcribing -> ready/failed), rebuild
      // the sheet once so the animation swaps to the editable field. Otherwise
      // patch in place so a poster/transcript arriving doesn't disrupt the user.
      const showingTranscribing = !!document.getElementById('trState');
      if (showingTranscribing !== !!draft.transcribing) {
        openRec();
      } else {
        const tf = document.getElementById('recTranscript');
        if (tf && document.activeElement !== tf && draft.transcript && draft.transcript.trim()) tf.value = draft.transcript;
        const pf = document.querySelector('#sheetBody .rec-poster');
        if (pf && draft.recording?.poster) pf.src = draft.recording.poster;
      }
    }
  });
});
