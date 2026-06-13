// Brief - popup
//
// On open:
//   1. Fast-path: if we have a cached "mic granted" flag from a recent
//      session, reveal the UI immediately. Probe in background to refresh
//      the cache for next time.
//   2. Slow path (no cache): probe getUserMedia synchronously. If granted,
//      reveal and cache. If not, redirect to permission page.

import { APP_URL, TICKETS_URL, getCloudToken, fetchAccountStatus, uploadDraft, uploadFilesToDraft, processBrief } from './cloud.js';

const briefCloudBtn = document.getElementById('briefCloudBtn');
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
const bcCreateTicket = document.getElementById('bc-create-ticket');
let bcConnected = false;
// Which tracker the paired account has: "linear" | "jira" | null (none) |
// undefined (not checked yet / offline - assume OK, the process route is the
// backstop). Refreshed from /api/me on every popup open so switching to an
// account WITHOUT a tracker is caught before filing, not after.
let bcTracker;

// The popup makes its own inbox writes (archive swipe-out, filing) and manages
// the DOM for them itself. The storage.onChanged listener below must stand down
// during those, or its full list rebuild destroys the in-progress per-row
// animation (archive) and flickers the list (filing). `bcFiling` covers the
// whole multi-brief filing run; `suppressInboxListenerUntil` is a short window
// for one-off animated writes like archive.
let bcFiling = false;
let suppressInboxListenerUntil = 0;
function suppressInboxListener(ms = 600) {
  suppressInboxListenerUntil = Date.now() + ms;
}

// Storage key for cached mic grant. Cache is good for the extension's
// session - Chrome invalidates the underlying grant if the user revokes it.
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
    // Refresh the cache silently for next time (don't await - don't block UI)
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

// Inline error bar. `action` (optional) = { linkText, url } renders a tappable
// fix-it link (e.g. "Connect a tracker →") after the message.
function showInlineError(msg, action) {
  let bar = document.getElementById('errBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'errBar';
    bar.className = 'err-bar';
    document.getElementById('app').appendChild(bar);
  }
  bar.textContent = msg;
  if (action?.linkText && action?.url) {
    bar.appendChild(document.createTextNode(' '));
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'err-link';
    a.textContent = action.linkText;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: action.url });
      window.close();
    });
    bar.appendChild(a);
  }
  bar.classList.add('show');
}

function clearInlineError() {
  const bar = document.getElementById('errBar');
  if (bar) bar.classList.remove('show');
}

async function recordForItem(itemId, recBtn) {
  clearInlineError();

  // Cloud-only: a recording is uploaded straight to Brief Cloud when it
  // stops - there is no local fallback anymore, so recording without a
  // pairing would lose the video. Pair first, then record.
  let cloudToken = null;
  try { cloudToken = await getCloudToken(); } catch {}
  if (!cloudToken) {
    await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
    window.close();
    return;
  }

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

    await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_BAR',
      streamId,
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

// Open the tickets page WITHOUT stacking up tabs:
//  1. a /tickets tab is already open -> focus + reload it (the new ticket shows)
//  2. any other Brief Cloud tab is open (e.g. /dashboard) -> reuse it, navigate
//     it to /tickets, focus it (don't strand the user on a stale page or open a
//     duplicate)
//  3. nothing open -> a fresh tab
async function openTicketsTab() {
  try {
    const ticketTabs = await chrome.tabs.query({ url: `${TICKETS_URL}*` });
    if (ticketTabs.length && ticketTabs[0].id != null) {
      const tab = ticketTabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch {}
      chrome.tabs.reload(tab.id);
      return;
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

// "Brief Cloud" - open the web app. Pairing is automatic: if we don't have a
// token yet, open the connect page (which mints + pushes a token when you're
// signed in, then lands you on your tickets); if we already have one, go
// straight to the tickets page (reusing an existing tab). No manual "connect"
// step, no settings page.
briefCloudBtn?.addEventListener('click', async () => {
  let token = null;
  try { token = await getCloudToken(); } catch {}
  if (token) {
    await openTicketsTab();
  } else {
    await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
  }
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
// The brand 4-point star (✦), filled with currentColor so CSS can tint it. Used
// as the live upload indicator on a brief - it spins while the recording uploads
// in the background, instead of a "uploading…" / "upload failed" text label.
const ICON_MARK = '<svg viewBox="0 0 128 128" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M64 16 C70 44, 84 58, 112 64 C84 70, 70 84, 64 112 C58 84, 44 70, 16 64 C44 58, 58 44, 64 16 Z"/></svg>';

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
  if (b.uploading) li.classList.add('uploading');
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

  // The record button doubles as the background-upload indicator: while the
  // recording uploads (offscreen), the camera icon is REPLACED by the brand ✦
  // mark spinning in place; on failure it turns red (hover for the reason,
  // click to re-record). It reverts to the camera icon once UPLOAD_RESULT lands.
  const hasRec = !!(b.hasRecording || b.recorded);
  const recBtn = document.createElement('button');
  if (b.uploading) {
    recBtn.className = 'cap-btn up-mark spinning';
    recBtn.innerHTML = ICON_MARK;
    recBtn.title = 'Uploading the recording…';
    recBtn.disabled = true;
  } else if (b.uploadFailed) {
    recBtn.className = 'cap-btn up-mark failed';
    recBtn.innerHTML = ICON_MARK;
    recBtn.title = `Upload failed: ${b.uploadError || 'unknown error'} - click to re-record`;
    recBtn.addEventListener('click', () => recordForItem(b.id, recBtn));
  } else {
    recBtn.className = 'cap-btn' + (hasRec ? ' done' : '');
    recBtn.title = hasRec ? 'Re-record' : 'Record voice + screen';
    recBtn.innerHTML = ICON_VIDEO;
    recBtn.addEventListener('click', () => recordForItem(b.id, recBtn));
  }
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

  // Attach-recording - only shown when a recording exists for this brief.
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
  // We animate + remove this single row ourselves below; keep the storage
  // listener from rebuilding the whole list and clobbering the swipe.
  suppressInboxListener();
  await setInbox(next);
  // Remove ONLY this row when its exit animation ends - don't rebuild the whole
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
  // Briefs whose recording is still uploading in the background can't be
  // filed yet (the cloud draft id hasn't landed) - they gate the button.
  const fileable = items.filter((b) => isReady(b) && !b.uploading).length;
  const uploading = items.filter((b) => isReady(b) && b.uploading).length;

  listHeader.hidden = items.length === 0;
  if (ready > 0) {
    recBadge.hidden = false;
    recCount.textContent = String(ready);
  } else {
    recBadge.hidden = true;
  }

  // "Create ticket" is THE primary action whenever briefs are ready - never
  // silently swapped for the local Export. Not paired (or the pairing died)?
  // The click opens the pair page and the user tries again - tickets are the
  // product, a zip download is not an acceptable stand-in.
  if (ready > 0) {
    if (bcCreateTicket) {
      bcCreateTicket.classList.add('is-on');
      // Reflect how many briefs will be filed (never while a send is running -
      // the in-flight progress label owns the button then).
      if (!bcCreateTicket.classList.contains('sending')) {
        if (fileable === 0 && uploading > 0) {
          bcCreateTicket.disabled = true;
          bcCreateTicket.textContent = 'Uploading…';
        } else {
          bcCreateTicket.disabled = false;
          bcCreateTicket.textContent = fileable > 1 ? `Create ${fileable} tickets` : 'Create ticket';
        }
      }
    }
    exportBtn.classList.remove('is-on');
  } else {
    exportBtn.classList.remove('is-on');
    if (bcCreateTicket) bcCreateTicket.classList.remove('is-on');
  }
}

async function refreshInbox({ expandBriefId = null } = {}) {
  const items = await getInbox();
  // Remember which briefs are expanded BEFORE we rebuild the list. Filing a
  // ticket (writes cloudBriefId) and a background upload settling both trigger
  // this refresh via storage.onChanged - without this, an open detail panel
  // would snap shut under the user mid-interaction.
  const expandedIds = new Set(
    [...briefList.querySelectorAll('.brief-item.expanded')].map((el) => el.dataset.id)
  );
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
  // Re-apply expanded state silently (no animation/scroll - this is a passive
  // refresh, not a user click).
  expandedIds.forEach((id) => {
    const li = briefList.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) {
      li.classList.add('expanded');
      li.querySelector('.brief-more')?.classList.add('open');
    }
  });
  updateChrome(items);

  // Auto-expand only when explicitly told which brief to expand (post-capture).
  // Manual opens don't pass an id and the list stays collapsed.
  if (expandBriefId) {
    const li = briefList.querySelector(`[data-id="${CSS.escape(expandBriefId)}"]`);
    const toggle = li?.querySelector('.brief-more');
    if (li && toggle && !li.classList.contains('expanded')) {
      toggleExpand(li, toggle);
    }
  }
}

// On open: render whatever's stored, and consume the post-capture signal if
// background set one. The signal is a brief id stashed in chrome.storage by
// `tryOpenPopup(briefId)` after a screenshot or recording finishes. We treat
// it as fresh only when stashed in the last 30 seconds - defensive against
// stale flags from a denied openPopup() that the user revisits hours later.
(async function bootstrapInbox() {
  let expandBriefId = null;
  try {
    const { pendingExpandBriefId, pendingExpandAt } = await chrome.storage.local.get([
      'pendingExpandBriefId', 'pendingExpandAt',
    ]);
    if (pendingExpandBriefId && pendingExpandAt && Date.now() - pendingExpandAt < 30_000) {
      expandBriefId = pendingExpandBriefId;
    }
  } catch {}
  // Always clear the flag - even if stale or missing - so a later manual
  // open doesn't accidentally expand something.
  try {
    await chrome.storage.local.remove(['pendingExpandBriefId', 'pendingExpandAt']);
  } catch {}
  await refreshInbox({ expandBriefId });
})();

// ---------- Add a ticket ----------
// Find the smallest unused "Brief N" so anonymous additions don't collide.
function nextAutoBriefName(list) {
  const used = new Set();
  for (const b of list) {
    const m = (b?.name || '').trim().match(/^brief\s+(\d+)$/i);
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Brief ${n}`;
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const list = await getInbox();
  // Empty input → auto-name "Brief N" instead of bailing. The user clearly
  // wanted to add something; making them go back to type a name is friction.
  const name = addName.value.trim() || nextAutoBriefName(list);
  list.push({ id: genId(), name, recorded: false, addedAt: Date.now() });
  await setInbox(list);
  addName.value = '';
  await refreshInbox();
  // Fast path: focus the new item's Record button
  const last = briefList.lastElementChild;
  last?.querySelector('.cap-btn')?.focus();
});

// Cloud-only: the local zip Export flow is gone. Briefs file as tickets via
// Brief Cloud, full stop - when the pairing is missing the Create ticket
// button opens the pair page instead of degrading to a download.
function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ---------- Brief Cloud: "Create ticket" ----------
//
// What we can assemble from chrome.storage.local here in the popup:
//   - brief.json: built from the stored inbox entry (same fields the local
//     export's brief.json carries), since the recording webm/keyframes/
//     transcript only ever lived in the on-disk zip written by bar.js and are
//     not available in the popup context.
//   - screenshot.png: the annotated screenshot dataURL, when present.
function bcBuildFilesAndMeta(b, page) {
  // Page context: the URL/title pinned when the screenshot was taken, else the
  // tab the user is on now (passed in). A ticket should always carry where the
  // issue happened.
  const pageUrl = b.pageUrl || page?.url || null;
  const pageTitle = b.pageTitle || page?.title || null;
  const briefJson = {
    id: b.id,
    name: b.name || '',
    createdAt: b.addedAt || Date.now(),
    source: (b.hasRecording || b.recorded) ? 'recording' : (b.screenshot ? 'screenshot' : 'text'),
    description: b.description || '',
    pageUrl,
    pageTitle,
    hasRecording: !!(b.hasRecording || b.recorded),
    hasScreenshot: !!b.screenshot,
    screenshotAnnotated: !!b.screenshotAnnotated,
    includeVideo: !!b.includeVideo,
    extra: Array.isArray(b.extra) ? b.extra.filter((p) => p.key.trim() || p.value.trim()) : [],
  };

  const files = [
    {
      name: 'brief.json',
      blob: new Blob([JSON.stringify(briefJson, null, 2)], { type: 'application/json' }),
      contentType: 'application/json',
    },
  ];

  if (b.screenshot) {
    files.push({
      name: 'screenshot.png',
      blob: new Blob([dataUrlToBytes(b.screenshot)], { type: 'image/png' }),
      contentType: 'image/png',
    });
  }

  const meta = {
    title: b.name || '',
    description: b.description || '',
    pageUrl,
    pageTitle,
    hasScreenshot: !!b.screenshot,
    keyframeCount: 0,
    transcript: undefined,
  };

  return { files, meta };
}

// The page the user is currently on - used as a fallback URL for text briefs
// that were never tied to a screenshot. Null on extension/internal pages.
async function activePageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) return null;
    return { url: tab.url, title: tab.title || null };
  } catch {
    return null;
  }
}

async function bcRefresh() {
  let token = null;
  try { token = await getCloudToken(); } catch {}
  bcConnected = !!token;
  // No connect/disconnect UI - pairing is automatic via the Brief Cloud button.
  // Re-evaluate which primary action (Create ticket vs Export) to show.
  try { updateChrome(await getInbox()); } catch {}
  if (!token) return;
  // Validate the pairing + tracker in the background (don't block the UI).
  // A dead token (account switched/revoked) flips us back to Export; an
  // account with no tracker keeps the button but gates the click with an
  // actionable "connect a tracker" message. null = network problem - keep
  // the last-known state.
  try {
    const status = await fetchAccountStatus();
    if (!status) return;
    bcConnected = status.connected;
    bcTracker = status.tracker;
    updateChrome(await getInbox());
  } catch {}
}

// Reuse the green "Copied to clipboard" success overlay (#exportDone) to
// confirm a cloud submit, then send the user straight to their briefs page in a
// new tab and close the popup - no link to click, no "filling" limbo.
function bcShowSentAndOpen(count) {
  const title = exportDone.querySelector('.export-done-title');
  const sub = exportDone.querySelector('.export-done-sub');
  if (title) title.textContent = count > 1 ? `${count} tickets queued` : 'Queued';
  if (sub) sub.textContent = 'Opening your tickets…';
  // Collapse the popup to a normal launcher height - otherwise the filed list
  // still in the DOM keeps the popup tall and the confirmation floats in a big
  // empty panel.
  document.body.classList.add('done-active');
  exportDone.hidden = false;
  // Let the confirmation animation (fade-in + rise, ~0.4s) play and linger
  // before switching tabs - openTicketsTab() activates another tab, which makes
  // the popup lose focus and close instantly, cutting the overlay off.
  setTimeout(() => { openTicketsTab(); }, 1600);
}

// File EVERY ready brief (the button says how many). Sends run sequentially so
// the button can show honest progress; briefs that fail stay in the inbox.
bcCreateTicket?.addEventListener('click', async () => {
  clearInlineError();
  const items = await getInbox();
  // Skip briefs whose recording is still uploading in the background - they
  // file once the upload lands (the button label reflects this).
  const ready = items.filter((b) => isReady(b) && !b.uploading);
  if (ready.length === 0) return;

  // Not paired (or the pairing died and was cleared)? Open the pair page -
  // it pushes a token for the signed-in account back to the extension; then
  // Create ticket just works. NEVER fall back to a local export.
  let token = null;
  try { token = await getCloudToken(); } catch {}
  if (!token) {
    await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
    window.close();
    return;
  }

  // Pre-flight: the paired account has NO tracker connected - every filing
  // would 409. Say so (with the fix) BEFORE uploading anything.
  if (bcTracker === null) {
    showInlineError('This account has no tracker connected - link Linear or Jira, then try again.', {
      linkText: 'Connect a tracker →',
      url: `${APP_URL}/connections`,
    });
    return;
  }

  bcCreateTicket.disabled = true;
  bcCreateTicket.classList.add('sending');
  // Filing writes cloudBriefId per brief (and removes sent ones at the end) -
  // hold off the storage listener so the list doesn't flicker/rebuild mid-run.
  bcFiling = true;

  const sentIds = [];
  let failure = null; // first error - shown after the loop
  for (let i = 0; i < ready.length; i++) {
    const b = ready[i];
    bcCreateTicket.innerHTML =
      '<span class="btn-spin"></span> ' +
      (ready.length > 1 ? `Filing ${i + 1} of ${ready.length}…` : 'Filing…');
    try {
      // Recordings were already uploaded as a cloud draft on stop. Screenshot/
      // text briefs upload here, once - the draft id is persisted on the inbox
      // entry so a failed filing (e.g. no tracker yet) retries the SAME draft
      // instead of uploading a duplicate.
      if (!b.cloudBriefId) {
        const page = await activePageContext();
        const { files, meta } = bcBuildFilesAndMeta(b, page);
        b.cloudBriefId = await uploadDraft(files, meta);
        const list = await getInbox();
        const entry = list.find((x) => x.id === b.id);
        if (entry) {
          entry.cloudBriefId = b.cloudBriefId;
          await setInbox(list);
        }
      } else if (b.screenshot) {
        // The draft already exists - a recording uploaded it on stop. That
        // upload only carried whatever existed at recording-stop time, so a
        // screenshot added AFTERWARDS was never in it (and this filing path
        // skips uploadDraft entirely once a draft exists). Push the screenshot
        // into the existing draft now so the ticket gets BOTH the recording and
        // the screenshot. Idempotent (x-upsert), so it's harmless when the
        // screenshot was already bundled in the recording draft.
        await uploadFilesToDraft(b.cloudBriefId, [{
          name: 'screenshot.png',
          blob: new Blob([dataUrlToBytes(b.screenshot)], { type: 'image/png' }),
          contentType: 'image/png',
        }]);
      }
      // File it - kick off processing on the uploaded brief (passing its name
      // so the dashboard can label it while filing, and the user's "attach the
      // recording" toggle so the video is embedded only when they asked).
      await processBrief(b.cloudBriefId, b.name, !!b.includeVideo);
      sentIds.push(b.id);
    } catch (err) {
      // 404 = the stored draft belongs to a PREVIOUS account pairing (the
      // user switched web accounts). Self-heal: re-upload the brief under the
      // current account and retry once. (A recording uploaded under the old
      // account can't be recovered - the ticket files from the popup's data.)
      if (err?.status === 404 && b.cloudBriefId) {
        try {
          b.cloudBriefId = null;
          const page = await activePageContext();
          const { files, meta } = bcBuildFilesAndMeta(b, page);
          b.cloudBriefId = await uploadDraft(files, meta);
          const list = await getInbox();
          const entry = list.find((x) => x.id === b.id);
          if (entry) { entry.cloudBriefId = b.cloudBriefId; await setInbox(list); }
          await processBrief(b.cloudBriefId, b.name, !!b.includeVideo);
          sentIds.push(b.id);
          continue;
        } catch (err2) {
          err = err2;
        }
      }
      failure = failure || err;
      // No tracker connected → every remaining brief would fail identically.
      if (err?.code === 'no_tracker') break;
    }
  }

  // Queued briefs leave the inbox; failed ones stay so nothing is lost.
  if (sentIds.length) {
    const after = await getInbox();
    await setInbox(after.filter((x) => !sentIds.includes(x.id)));
  }

  if (!failure) {
    // Sent briefs were just removed above (under suppression); the overlay
    // shows and the popup closes shortly, so leave the listener suppressed.
    bcShowSentAndOpen(sentIds.length);
    return;
  }

  bcFiling = false; // done filing - the explicit refresh below shows what's left
  bcCreateTicket.classList.remove('sending');
  bcCreateTicket.disabled = false;
  await refreshInbox(); // re-render what's left + restore the button label
  if (failure?.code === 'no_tracker') {
    showInlineError('No tracker connected yet - link Linear or Jira, then try again.', {
      linkText: 'Connect a tracker →',
      url: `${APP_URL}/connections`,
    });
  } else {
    showInlineError(`Couldn’t send: ${failure?.message || failure}`);
  }
});

bcRefresh();

// Live-update the list while the popup is open when a BACKGROUND upload
// settles (offscreen → background → inbox entry). Only re-render on
// upload-state changes - the popup's own writes (debounced description
// typing etc.) must not rebuild the list under the user's cursor.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.inbox) return;
  // The popup's own animated writes manage the DOM themselves - don't rebuild
  // the list out from under them (kills the archive swipe + filing flicker).
  if (bcFiling || Date.now() < suppressInboxListenerUntil) return;
  const sig = (l) =>
    (Array.isArray(l) ? l : [])
      .map((b) => [b.id, !!b.uploading, !!b.uploadFailed, b.cloudBriefId || ''].join(':'))
      .join('|');
  if (sig(changes.inbox.oldValue) !== sig(changes.inbox.newValue)) {
    refreshInbox();
  }
});
