// Brief — popup
//
// On open:
//   1. Fast-path: if we have a cached "mic granted" flag from a recent
//      session, reveal the UI immediately. Probe in background to refresh
//      the cache for next time.
//   2. Slow path (no cache): probe getUserMedia synchronously. If granted,
//      reveal and cache. If not, redirect to permission page.

import { makeZip } from './lib/zip.js';

const settingsBtn = document.getElementById('settingsBtn');
const briefList = document.getElementById('briefList');
const emptyState = document.getElementById('emptyState');
const addForm = document.getElementById('addForm');
const addName = document.getElementById('addName');
const addBtn = document.getElementById('addBtn');
const listHeader = document.getElementById('listHeader');
const recBadge = document.getElementById('recBadge');
const recCount = document.getElementById('recCount');
const exportBtn = document.getElementById('exportBtn');
const exportCount = document.getElementById('exportCount');
const exportDone = document.getElementById('exportDone');

// Storage key for cached mic grant. Cache is good for the extension's
// session — Chrome invalidates the underlying grant if the user revokes it.
const MIC_CACHE_KEY = 'micGrantedAt';
const MIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

// Defensive: the success overlay must never be visible on open.
exportDone.hidden = true;

(async () => {
  // Fast path: check the cache. If a recent grant exists, reveal UI now,
  // probe in the background to refresh.
  const { [MIC_CACHE_KEY]: grantedAt } = await chrome.storage.local.get(MIC_CACHE_KEY);
  const cacheFresh = grantedAt && (Date.now() - grantedAt < MIC_CACHE_TTL_MS);
  if (cacheFresh) {
    document.body.classList.add('ready');
    // Refresh the cache silently for next time (don't await — don't block UI)
    probeMic().then((ok) => {
      if (ok) {
        chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() });
      } else {
        chrome.storage.local.remove(MIC_CACHE_KEY);
      }
    });
    return;
  }
  // Slow path: must actually probe
  const ok = await probeMic();
  if (!ok) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    window.close();
    return;
  }
  await chrome.storage.local.set({ [MIC_CACHE_KEY]: Date.now() });
  document.body.classList.add('ready');
})();

async function probeMic() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err) {
    console.warn('[brief/popup] mic probe failed:', err?.name, err?.message);
    return false;
  }
}

async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (r?.ok) return;
  } catch {}
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  await new Promise((r) => setTimeout(r, 50));
}

function showInlineError(msg) {
  let bar = document.getElementById('errBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'errBar';
    bar.className = 'err-bar';
    document.getElementById('app').appendChild(bar);
  }
  bar.textContent = msg;
  bar.classList.add('show');
}

function clearInlineError() {
  const bar = document.getElementById('errBar');
  if (bar) bar.classList.remove('show');
}

async function recordForItem(itemId, recBtn) {
  clearInlineError();
  if (recBtn) { recBtn.disabled = true; recBtn.classList.add('loading'); }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) {
      showInlineError('Switch to a regular web page to record.');
      if (recBtn) { recBtn.disabled = false; recBtn.classList.remove('loading'); }
      return;
    }

    // Tear down any leftover recording infrastructure first
    try {
      await chrome.runtime.sendMessage({ type: 'RESET_BEFORE_NEW_RECORDING' });
    } catch {}

    await ensureContentScript(tab.id);

    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError || !id) {
          reject(new Error(chrome.runtime.lastError?.message || 'no_stream_id'));
        } else {
          resolve(id);
        }
      });
    });

    // Language is chosen on the bar now; pass the last-used pref as the start value.
    const { lang } = await chrome.storage.local.get('lang');

    await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_BAR',
      streamId,
      lang: lang || 'en-US',
      intent: 'brief',
      mode: 'inbox',
      itemId, // record for this specific pre-named brief
    });

    window.close();
  } catch (err) {
    console.error('[brief/popup] start failed:', err);
    showInlineError(`Could not start: ${err?.message || err}`);
    if (recBtn) { recBtn.disabled = false; recBtn.classList.remove('loading'); }
  }
}

settingsBtn?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  window.close();
});

// ---------- Inbox state + rendering ----------
let inboxExpanded = false;

async function getInbox() {
  const { inbox } = await chrome.storage.local.get('inbox');
  return Array.isArray(inbox) ? inbox : [];
}
async function setInbox(list) {
  await chrome.storage.local.set({ inbox: list });
  chrome.runtime.sendMessage({ type: 'INBOX_CHANGED' }).catch(() => {});
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// A brief is "ready" to export once it has ANY evidence: a recording, an
// annotated screenshot, or a typed description.
function isReady(b) {
  return !!(b.hasRecording || b.recorded || b.screenshot || (b.description && b.description.trim()));
}

// SVG snippets
const ICON_ARCHIVE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>';
const ICON_CAM = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const ICON_VIDEO = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2z"/><path d="M15 10l6-3v10l-6-3"/></svg>';

async function screenshotForItem(itemId, btn) {
  clearInlineError();
  if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) {
      showInlineError('Switch to a regular web page to screenshot.');
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'START_SHOT', itemId });
    if (res && res.ok === false) {
      showInlineError(res.error === 'unsupported_page' ? 'Can\u2019t screenshot this page.' : `Couldn\u2019t capture: ${res.error}`);
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
      return;
    }
    // The annotator overlay is now open on the page; close the popup so the
    // user can draw. The screenshot is saved to storage when they hit Save.
    window.close();
  } catch (err) {
    showInlineError(`Couldn\u2019t capture: ${err?.message || err}`);
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
  }
}

function buildItem(b) {
  const ready = isReady(b);
  const li = document.createElement('li');
  li.className = `brief-item ${ready ? 'ready' : 'draft'}`;
  li.dataset.id = b.id;

  // --- main row ---
  const row = document.createElement('div');
  row.className = 'brief-row';

  const status = document.createElement('span');
  status.className = 'brief-status';
  status.title = ready ? 'Ready' : 'No evidence yet';

  const input = document.createElement('input');
  input.className = 'brief-name-input';
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'Untitled brief';
  input.value = b.name || '';
  input.spellcheck = false;
  input.addEventListener('blur', async () => {
    const list = await getInbox();
    const entry = list.find((x) => x.id === b.id);
    if (entry && entry.name !== input.value.trim()) {
      entry.name = input.value.trim();
      await setInbox(list);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });

  // Capture controls. Compact icon buttons; they show what's been added.
  const actions = document.createElement('span');
  actions.className = 'brief-actions';

  const hasRec = !!(b.hasRecording || b.recorded);
  const recBtn = document.createElement('button');
  recBtn.className = 'cap-btn' + (hasRec ? ' done' : '');
  recBtn.title = hasRec ? 'Re-record' : 'Record voice + screen';
  recBtn.innerHTML = ICON_VIDEO;
  recBtn.addEventListener('click', () => recordForItem(b.id, recBtn));
  actions.appendChild(recBtn);

  const shotBtn = document.createElement('button');
  shotBtn.className = 'cap-btn' + (b.screenshot ? ' done' : '');
  shotBtn.title = b.screenshot ? 'Retake screenshot' : 'Screenshot + draw';
  shotBtn.innerHTML = ICON_CAM;
  shotBtn.addEventListener('click', () => screenshotForItem(b.id, shotBtn));

  actions.appendChild(shotBtn);

  // Disclosure toggle (description + video + additional data).
  const hasExtras = (b.description && b.description.trim()) || b.includeVideo || (Array.isArray(b.extra) && b.extra.length > 0);
  const toggle = document.createElement('button');
  toggle.className = 'brief-more' + (hasExtras ? ' has-extras' : '');
  toggle.title = 'Details';
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  const archive = document.createElement('button');
  archive.className = 'brief-archive';
  archive.title = 'Archive';
  archive.innerHTML = ICON_ARCHIVE;
  archive.addEventListener('click', () => archiveItem(b.id, li));

  row.appendChild(status);
  row.appendChild(input);
  row.appendChild(actions);
  row.appendChild(toggle);
  row.appendChild(archive);

  // --- detail panel ---
  const panel = buildDetailPanel(b);
  toggle.addEventListener('click', () => toggleExpand(li, toggle));

  li.appendChild(row);
  li.appendChild(panel);
  return li;
}

// Accordion: opening one brief closes the others. Sequenced so both panels
// aren't expanded at full height at the same instant (which briefly overflowed
// the list and flashed a scrollbar).
function toggleExpand(li, toggle) {
  const isOpen = li.classList.contains('expanded');

  // Collapse any open panels first.
  let hadOther = false;
  briefList.querySelectorAll('.brief-item.expanded').forEach((other) => {
    if (other !== li) hadOther = true;
    other.classList.remove('expanded');
    other.querySelector('.brief-more')?.classList.remove('open');
  });

  if (isOpen) return; // we were toggling this one closed

  const open = () => {
    li.classList.add('expanded');
    toggle.classList.add('open');
  };

  // Prevent a transient scrollbar while panels animate: briefly lock overflow,
  // restore it once the expand transition has settled.
  briefList.classList.add('animating');
  clearTimeout(briefList._animTimer);
  briefList._animTimer = setTimeout(() => {
    briefList.classList.remove('animating');
    // If the freshly-opened panel sits below the fold, ease it into view now
    // that heights are stable (no fighting the height transition).
    if (li.classList.contains('expanded')) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 320);

  // If another panel was open, wait for its collapse to progress before
  // expanding this one, so total height never spikes past the viewport.
  if (hadOther) {
    requestAnimationFrame(() => requestAnimationFrame(open));
  } else {
    open();
  }
}

// Per-brief details: text description + attach-video + key/value data.
function buildDetailPanel(b) {
  const panel = document.createElement('div');
  panel.className = 'brief-detail';

  // One "Additional data" section holding the description + key/value fields.
  const sectionTitle = document.createElement('div');
  sectionTitle.className = 'opt-data-title';
  sectionTitle.textContent = 'Additional data';
  panel.appendChild(sectionTitle);

  // Description textarea
  const descWrap = document.createElement('div');
  descWrap.className = 'opt-desc';
  const desc = document.createElement('textarea');
  desc.className = 'desc-input';
  desc.rows = 3;
  desc.placeholder = 'Describe the brief…';
  desc.value = b.description || '';
  desc.spellcheck = true;
  let descTimer = null;
  async function persistDesc() {
    const list = await getInbox();
    const entry = list.find((x) => x.id === b.id);
    if (entry && (entry.description || '') !== desc.value) {
      entry.description = desc.value;
      await setInbox(list);
      markExtras(b.id);
      refreshStatus(b.id); // description alone makes a brief ready
    }
  }
  // Persist as the user types (debounced) so a brief is saved even if they
  // click Export or close the popup without blurring the field first.
  desc.addEventListener('input', () => {
    clearTimeout(descTimer);
    descTimer = setTimeout(persistDesc, 250);
  });
  desc.addEventListener('blur', () => { clearTimeout(descTimer); persistDesc(); });
  descWrap.appendChild(desc);

  // Attach-recording — only shown when a recording exists for this brief.
  let attachWrap = null;
  if (b.hasRecording || b.recorded) {
    attachWrap = document.createElement('label');
    attachWrap.className = 'opt-check';
    const vid = document.createElement('input');
    vid.type = 'checkbox';
    vid.checked = !!b.includeVideo;
    vid.addEventListener('change', async () => {
      const list = await getInbox();
      const entry = list.find((x) => x.id === b.id);
      if (entry) { entry.includeVideo = vid.checked; await setInbox(list); markExtras(b.id); }
    });
    attachWrap.appendChild(vid);
    attachWrap.appendChild(document.createTextNode(' Attach the recording to the ticket'));
  }

  // Key/value fields under the same section + a single "+ Add field".
  const dataWrap = document.createElement('div');
  dataWrap.className = 'opt-data';

  const rows = document.createElement('div');
  rows.className = 'kv-rows';
  dataWrap.appendChild(rows);

  const extra = Array.isArray(b.extra) ? b.extra.slice() : [];

  async function persistExtra() {
    const list = await getInbox();
    const entry = list.find((x) => x.id === b.id);
    if (entry) { entry.extra = extra.filter((p) => p.key.trim() || p.value.trim()); await setInbox(list); markExtras(b.id); }
  }

  function renderRows() {
    rows.innerHTML = '';
    extra.forEach((pair, i) => {
      const r = document.createElement('div');
      r.className = 'kv-row';
      const k = document.createElement('input');
      k.className = 'kv-key'; k.placeholder = 'Label'; k.value = pair.key; k.spellcheck = false;
      k.addEventListener('input', () => { pair.key = k.value; persistExtra(); });
      const v = document.createElement('input');
      v.className = 'kv-val'; v.placeholder = 'Value'; v.value = pair.value; v.spellcheck = false;
      v.addEventListener('input', () => { pair.value = v.value; persistExtra(); });
      const del = document.createElement('button');
      del.className = 'kv-del'; del.title = 'Remove'; del.textContent = '×';
      del.addEventListener('click', async () => { extra.splice(i, 1); renderRows(); await persistExtra(); });
      r.appendChild(k); r.appendChild(v); r.appendChild(del);
      rows.appendChild(r);
    });
  }
  renderRows();

  const addKv = document.createElement('button');
  addKv.className = 'kv-add';
  addKv.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add field';
  addKv.addEventListener('click', () => { extra.push({ key: '', value: '' }); renderRows(); });
  dataWrap.appendChild(addKv);

  panel.appendChild(descWrap);
  if (attachWrap) panel.appendChild(attachWrap);
  panel.appendChild(dataWrap);
  return panel;
}

// Re-mark the disclosure dot without a full re-render.
function markExtras(id) {
  const li = briefList.querySelector(`.brief-item[data-id="${id}"]`);
  if (!li) return;
  const toggle = li.querySelector('.brief-more');
  getInbox().then((list) => {
    const b = list.find((x) => x.id === id);
    const has = b && ((b.description && b.description.trim()) || b.includeVideo || (Array.isArray(b.extra) && b.extra.length > 0));
    if (toggle) toggle.classList.toggle('has-extras', !!has);
  });
}

// Reflect ready/draft status (dot + class) without collapsing the open panel.
function refreshStatus(id) {
  const li = briefList.querySelector(`.brief-item[data-id="${id}"]`);
  if (!li) return;
  getInbox().then((list) => {
    const b = list.find((x) => x.id === id);
    if (!b) return;
    const ready = isReady(b);
    li.classList.toggle('ready', ready);
    li.classList.toggle('draft', !ready);
    const st = li.querySelector('.brief-status');
    if (st) st.title = ready ? 'Ready' : 'No evidence yet';
    updateChromeFromStorage();
  });
}
async function updateChromeFromStorage() {
  updateChrome(await getInbox());
}

async function archiveItem(id, li) {
  if (li.classList.contains('swipe-out')) return; // guard double-clicks
  li.classList.add('swipe-out');
  const list = await getInbox();
  const next = list.filter((x) => x.id !== id);
  await setInbox(next);
  // Remove ONLY this row when its exit animation ends — don't rebuild the whole
  // list (a rebuild re-runs the entry animation on every remaining row, which
  // is the flash/glitch). Update the header/export counts in place.
  const done = () => {
    li.remove();
    updateChrome(next);
    if (next.length === 0) {
      briefList.hidden = true;
      emptyState.hidden = false;
    }
  };
  let fired = false;
  const onEnd = () => { if (!fired) { fired = true; done(); } };
  li.addEventListener('animationend', onEnd, { once: true });
  // Fallback in case animationend doesn't fire (e.g. reduced-motion).
  setTimeout(onEnd, 380);
}

function updateChrome(items) {
  const ready = items.filter(isReady).length;

  listHeader.hidden = items.length === 0;
  if (ready > 0) {
    recBadge.hidden = false;
    recCount.textContent = String(ready);
  } else {
    recBadge.hidden = true;
  }

  if (ready > 0) {
    exportBtn.classList.add('is-on');
    exportCount.textContent = String(ready);
  } else {
    exportBtn.classList.remove('is-on');
  }
}

async function refreshInbox() {
  const items = await getInbox();
  briefList.innerHTML = '';
  if (items.length === 0) {
    briefList.hidden = true;
    emptyState.hidden = false;
    updateChrome(items);
    return;
  }
  emptyState.hidden = true;
  briefList.hidden = false;
  items.forEach((b) => briefList.appendChild(buildItem(b)));
  updateChrome(items);
}

// On open: render whatever's stored (drafts are kept across closes).
refreshInbox();

// ---------- Add a ticket ----------
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = addName.value.trim();
  if (!name) { addName.focus(); return; }
  const list = await getInbox();
  list.push({ id: genId(), name, recorded: false, addedAt: Date.now() });
  await setInbox(list);
  addName.value = '';
  await refreshInbox();
  // Fast path: focus the new item's Record button
  const last = briefList.lastElementChild;
  last?.querySelector('.cap-btn')?.focus();
});

// Helpers to bundle the skill + write a zip for non-recording briefs ----------
const SKILL_FILES = ['skill/SKILL.md', 'skill/playbooks/ticket.md', 'skill/playbooks/inbox.md'];
async function loadSkillEntries() {
  const out = [];
  for (const rel of SKILL_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(rel));
      out.push({ name: rel, data: new TextEncoder().encode(await res.text()) });
    } catch {}
  }
  return out;
}
function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function briefReadme(b) {
  const parts = [];
  parts.push('# Brief\n');
  parts.push('A brief captured with the Brief extension. Read skill/SKILL.md and follow it to file a tracker ticket.\n');
  parts.push('## Contents');
  if (b.description && b.description.trim()) parts.push('- `brief.json` → `description`: the user\u2019s typed description of the issue.');
  if (b.screenshot) parts.push('- `screenshot.png`: a screenshot of the page. **Any red markings are drawn by the user to point at where the issue is** — treat them as the focus, not part of the UI.');
  parts.push('- `skill/`: the playbook for turning this into a ticket.');
  parts.push('\n## How to act on it');
  parts.push('Read `skill/SKILL.md` and follow it. File ONE ticket in the connected tracker. Don\u2019t mention the brief or these files in the ticket itself.');
  return parts.join('\n') + '\n';
}

// Build + download a zip for a brief that has NO recording (screenshot/text).
// Recording briefs already wrote their own zip on disk via the bar.
async function writeBriefZip(b) {
  const skillEntries = await loadSkillEntries();
  const briefJson = {
    id: b.id,
    name: b.name || '',
    createdAt: b.addedAt || Date.now(),
    source: b.screenshot ? 'screenshot' : 'text',
    description: b.description || '',
    hasScreenshot: !!b.screenshot,
    screenshotAnnotated: !!b.screenshotAnnotated,
    extra: Array.isArray(b.extra) ? b.extra.filter((p) => p.key.trim() || p.value.trim()) : [],
  };
  const entries = [
    { name: 'README.md', data: new TextEncoder().encode(briefReadme(b)) },
    { name: 'brief.json', data: new TextEncoder().encode(JSON.stringify(briefJson, null, 2)) },
    ...skillEntries,
  ];
  if (b.screenshot) entries.push({ name: 'screenshot.png', data: dataUrlToBytes(b.screenshot) });

  const zipBytes = makeZip(entries);
  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(blob);
  const res = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_ZIP',
    payload: { blobUrl, filename: `brief/brief-${b.id}/brief-${b.id}.zip` },
  });
  URL.revokeObjectURL(blobUrl);
  if (!res?.ok) throw new Error(res?.error || 'zip_write_failed');
}

// For a RECORDING brief, anything the user adds after the recording is saved
// (description, screenshot, key/value extras, the "attach the recording"
// toggle) lives only in the popup until export. The recording's on-disk zip
// predates those edits and we don't have the video bytes to rewrite it, so we
// drop a small companion zip next to it carrying the post-record state. The
// skill always looks for this companion and merges its fields over the main
// brief.json — it is the source of truth for late edits.
async function writeCompanionZip(b) {
  const briefJson = {
    id: b.id,
    name: b.name || '',
    companionFor: `brief-${b.id}.zip`,
    note: 'Extra context added after the recording was saved. Merge these fields over the main brief.json.',
    description: b.description || '',
    hasScreenshot: !!b.screenshot,
    screenshotAnnotated: !!b.screenshotAnnotated,
    extra: Array.isArray(b.extra) ? b.extra.filter((p) => p.key.trim() || p.value.trim()) : [],
    // The user's choice for whether to attach the recording to the ticket.
    // Lives here (not in the prompt) so the agent reads it from disk.
    attachRecording: !!b.includeVideo,
  };
  const entries = [
    { name: 'brief.json', data: new TextEncoder().encode(JSON.stringify(briefJson, null, 2)) },
  ];
  if (b.screenshot) entries.push({ name: 'screenshot.png', data: dataUrlToBytes(b.screenshot) });
  const blob = new Blob([makeZip(entries)], { type: 'application/zip' });
  const blobUrl = URL.createObjectURL(blob);
  const res = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_ZIP',
    payload: { blobUrl, filename: `brief/brief-${b.id}/brief-${b.id}-extra.zip` },
  });
  URL.revokeObjectURL(blobUrl);
  if (!res?.ok) throw new Error(res?.error || 'companion_write_failed');
}

// ---------- Export (all ready briefs) ----------
exportBtn.addEventListener('click', async () => {
  const items = await getInbox();
  const ready = items.filter(isReady);
  const notReady = items.filter((b) => !isReady(b));
  if (ready.length === 0) return;

  exportBtn.disabled = true;

  // 1) Make sure every ready brief has a zip on disk. Recording briefs already
  //    do; screenshot/text-only briefs are written here, now. A recording brief
  //    gets a small companion zip if the user added anything after the
  //    recording — screenshot, description, extras, or the attach-recording
  //    toggle. The companion is the only on-disk channel for those late edits,
  //    and the skill reads it as the source of truth.
  const hasLateState = (b) =>
    !!b.screenshot ||
    !!(b.description && b.description.trim()) ||
    (Array.isArray(b.extra) && b.extra.some((p) => p.key.trim() || p.value.trim())) ||
    !!b.includeVideo;
  try {
    for (const b of ready) {
      if (b.hasRecording || b.recorded) {
        if (hasLateState(b)) await writeCompanionZip(b);
      } else {
        await writeBriefZip(b);
      }
    }
  } catch (err) {
    exportBtn.disabled = false;
    showInlineError(`Couldn\u2019t prepare a brief: ${err?.message || err}`);
    return;
  }

  // 2) Build the prompt. Skill knows HOW; prompt only carries WHICH briefs,
  //    WHERE they live, and (for multi-brief batches) the parallelization
  //    rule. Everything else — description, additional-data key/values, the
  //    attach-recording toggle, the red-screenshot note, even the list of
  //    kinds present — lives on disk (main brief.json or its companion) or
  //    in the skill itself. The agent reads it from there.
  const describe = (b, i) => {
    const name = (b.name && b.name.trim()) || `Untitled brief ${i + 1}`;
    return `${b.id} ("${name}")`;
  };
  const named = ready.map(describe).join('; ');
  const firstId = ready[0].id;
  const multi = ready.length > 1;
  const prompt =
    `Process these briefs from ~/Downloads/brief/: ${named}. ` +
    `Each brief lives in its own folder (~/Downloads/brief/brief-<id>/). ` +
    `Start with ~/Downloads/brief/brief-${firstId}/brief-${firstId}.zip — unzip it and follow its skill/SKILL.md.` +
    (multi
      ? ` Parallelize: dispatch each brief to its own sub-agent and process them concurrently — one sub-agent per brief, all running at once.`
      : '');
  try { await navigator.clipboard.writeText(prompt); } catch {}

  // 3) Animate ready rows out, keep not-ready drafts.
  exportBtn.classList.remove('is-on');
  const readyIds = new Set(ready.map((b) => b.id));
  const rows = Array.from(briefList.children).filter((row) => readyIds.has(row.dataset.id));
  rows.forEach((row, i) => setTimeout(() => row.classList.add('swipe-out'), i * 90));

  const totalSwipe = rows.length * 90 + 360;
  setTimeout(async () => {
    await setInbox(notReady);
    exportDone.hidden = false;
    setTimeout(() => window.close(), 1700);
  }, totalSwipe);
});
