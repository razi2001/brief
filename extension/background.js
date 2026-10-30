// Brief - background service worker
// Thin coordinator: collects per-tab events, manages offscreen recorder,
// relays messages between bar (in content script) and offscreen.

import { installPageCapture } from './page-capture.js';
import { APP_URL } from "./config.js";
import { getDraft, setDraft, updateDraft, emptyDraft, genId, landRecording, migrateInboxToDraft } from "./draft.js";
import { fileDraft, fileDraftObject, resumeFiling, filingKeys } from "./filing.js";
import { putFile, getFile, shotKey, pruneFiles, draftKeys } from "./filestore.js";
import { isWatched, armReplay, pingReplay, stopReplay, getReplaySites, patternMatches, syncReplaySites, syncReplaySitesIfStale } from "./replay-sites.js";
import { putChunk, prune as pruneReplay, allMeta, deleteChunks, clearAll as clearReplay } from "./replay-store.js";
import { claimNudge, markUsed, markClosed } from "./nudge.js";

// ---------- Best-effort reopen the popup after a capture ----------
// Chrome only permits chrome.action.openPopup() in some versions/contexts and
// rejects it otherwise. We try it and swallow any failure - the toolbar badge
// already signals there are briefs to review, so a no-op degrades gracefully.
//
// When called with a briefId, stash a short-lived "just captured" flag in
// storage so the popup knows to auto-expand THAT brief's details panel on
// its next render. Manual popup opens (user clicks the toolbar icon) don't
// set this flag and therefore stay collapsed.
function tryOpenPopup(briefId) {
  try {
    // Always stash the signal first, even before checking openPopup support:
    // if Chrome silently denies the programmatic open, the user will manually
    // open the popup a beat later and we still want THAT open to expand the
    // just-captured brief.
    if (briefId) {
      try {
        chrome.storage.local.set({
          pendingExpandBriefId: briefId,
          pendingExpandAt: Date.now(),
        });
      } catch {}
    }
    if (!chrome.action || typeof chrome.action.openPopup !== 'function') return;
    // Small delay so the on-page "Saved ✓" state registers first.
    setTimeout(() => {
      try {
        const p = chrome.action.openPopup();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {}
    }, 350);
  } catch {}
}

// ---------- Capture entry points ----------
// Capture the visible tab, then inject the annotator overlay and hand it the
// screenshot. Capture must happen here (content scripts can't).
async function startShot(itemId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) return { ok: false, error: 'unsupported_page' };
    markUsed().catch(() => {});
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    // Mint the screenshot's id HERE and keep the clean capture in the blob
    // store under it, so "Edit drawing" can later reopen the annotator on the
    // unmarked image with the strokes editable.
    const shotId = genId();
    try {
      await putFile(shotKey(shotId), await (await fetch(dataUrl)).blob());
    } catch (err) {
      // Non-fatal: the screenshot still lands, it just won't be re-editable.
      console.warn('[brief/background] stash clean capture:', err);
    }
    // The page URL/title ride through the overlay round-trip so SHOT_SAVED can
    // pin them onto THIS screenshot, even if the user navigates away first.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {}
    await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_SHOT', itemId, dataUrl, shotId,
      pageUrl: tab.url || null, pageTitle: tab.title || null,
    });
    return { ok: true };
  } catch (err) {
    console.error('[brief/background] START_SHOT:', err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Before a new recording, ensure no stale recording infrastructure is holding
// a tabCapture stream. Close offscreen, dismiss any open bar in any tab, clear
// state. EXCEPTION: while a background upload is running, keep the document -
// its capture streams are already released (collectRecording cleans up before
// uploading), so the new recording can safely reuse it.
async function resetBeforeRecording() {
  STATE.recording = false;
  STATE.events = [];
  const s = await getRecSession();
  disarmTabs(s);
  await setRecSession(null);
  try {
    if (ACTIVE_BAR_TAB_ID != null) {
      await chrome.tabs.sendMessage(ACTIVE_BAR_TAB_ID, { type: 'CLOSE_BAR' });
    }
  } catch {}
  if (s?.capture === 'window') await closeBars();
  if ((await getUploadsPending()) === 0) {
    await closeOffscreenDocument().catch(() => {});
  }
  // Small wait for Chrome to fully release the tabCapture stream
  await new Promise((r) => setTimeout(r, 150));
}

// Right-click on a watched page: "Brief it". One item, so Chrome
// shows it right in the menu (two or more get folded into a submenu under the
// extension's name). It only exists on the org's replay sites (the only pages
// recorded), so it is rebuilt whenever that list changes. Editing the last
// minute by hand stays in the popup (+ → Replay).

// Site patterns -> Chrome match patterns (ports can't be expressed: any port).
function menuPatterns(sites) {
  const out = new Set();
  for (const p of sites) {
    const host = p.replace(/:\d+$/, '');
    if (host.startsWith('*.')) { out.add(`*://${host}/*`); out.add(`*://${host.slice(2)}/*`); }
    else out.add(`*://${host}/*`);
  }
  return [...out];
}

let menuChain = Promise.resolve();
function refreshReplayMenu() {
  menuChain = menuChain.then(async () => {
    await chrome.contextMenus.removeAll();
    const patterns = menuPatterns(await getReplaySites());
    if (!patterns.length) return;
    chrome.contextMenus.create({ id: 'brief-report', title: 'Brief it', contexts: ['all'], documentUrlPatterns: patterns });
  }).catch((err) => console.warn('[brief/background] replay menu:', err));
  return menuChain;
}
chrome.runtime.onInstalled.addListener(() => { refreshReplayMenu(); });
chrome.runtime.onStartup.addListener(() => { refreshReplayMenu(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.replaySites) refreshReplayMenu(); });

// ---------- "Brief it" (one-click report) ----------
// A shortcut or the right-click item: the last minute becomes a
// draft with no typing and nothing opened. The recorders are flushed here, the
// offscreen document rebuilds the replay, finds what looks wrong, renders the
// video and its stills (auto-report.js) and answers AUTO_REPORT_BUILT; the
// draft is then filed on its own - the one in the popup is never touched. A
// small toast on the page says what's happening. Pending reports live in
// storage, so a worker restart mid-way doesn't lose one.


// The toolbar icon tells the story, not the page: a small ring turns on the
// Brief icon while a report is being made, then a green ✓ (or a red !) badge
// for a few seconds. Several reports at once keep one ring going.
let spin = null;
let spinners = 0;
const iconBitmaps = {};
async function baseIcon(size) {
  if (!iconBitmaps[size]) {
    const res = await fetch(chrome.runtime.getURL(`icons/icon${size}.png`));
    iconBitmaps[size] = await createImageBitmap(await res.blob());
  }
  return iconBitmaps[size];
}
function spinFrame(bmp, size, k) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, size, size);
  const r = size * 0.27;
  const cx = size - r - size * 0.02, cy = size - r - size * 0.02;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.arc(cx, cy, r * 0.62, k, k + Math.PI * 1.35);
  g.strokeStyle = '#dd6936'; g.lineWidth = Math.max(1.6, size * 0.09); g.lineCap = 'round'; g.stroke();
  return g.getImageData(0, 0, size, size);
}
async function iconBusy(on) {
  spinners = Math.max(0, spinners + (on ? 1 : -1));
  if (spinners > 0 && !spin) {
    const [b16, b32] = await Promise.all([baseIcon(16), baseIcon(32)]);
    let k = 0;
    // each setIcon is an extension API call: it also keeps the worker up
    spin = setInterval(() => {
      k += 0.45;
      chrome.action.setIcon({ imageData: { 16: spinFrame(b16, 16, k), 32: spinFrame(b32, 32, k) } }).catch(() => {});
    }, 80);
  } else if (spinners === 0 && spin) {
    clearInterval(spin);
    spin = null;
    chrome.action.setIcon({ path: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' } }).catch(() => {});
  }
}
async function iconResult(ok) {
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!' }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#2e7d32' : '#cf3b2e' }).catch(() => {});
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' }).catch(() => {});
  setTimeout(() => refreshBadge(), 4000);
}


/**
 * What happened to the last few one-click reports, for the popup to say why
 * one didn't go through (and for the worker console: [brief/report]).
 */
async function reportLog(entry) {
  console.log('[brief/report]', entry.ok ? 'ok' : 'failed', entry.error || '', entry.detail || '');
  const { autoReportLog = [] } = await chrome.storage.local.get('autoReportLog');
  await chrome.storage.local.set({ autoReportLog: [{ at: Date.now(), ...entry }, ...autoReportLog].slice(0, 10) });
}

/** A message to the offscreen document that was just created may beat its listener: try again. */
async function askOffscreen(message, tries = 4) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ target: 'offscreen', viaBackground: true, ...message });
      if (r) return r;
    } catch (err) { last = err; }
    await new Promise((res) => setTimeout(res, 250 * (i + 1)));
  }
  throw last || new Error('the offscreen document did not answer');
}

// `via`: 'nudge' when the "Seen a bug?" card asked for it (the create request
// says so, for the activity log).
async function startAutoReport(tab, { via } = {}) {
  const page = (() => { try { return new URL(tab?.url || '').host; } catch { return ''; } })();
  try {
    await startup;
    const { briefCloudToken } = await chrome.storage.local.get('briefCloudToken');
    if (!briefCloudToken) {
      await reportLog({ ok: false, error: 'Brief isn’t connected: open the extension to sign in', page });
      await chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` }).catch(() => {});
      return;
    }
    if (!tab?.url) return;
    markUsed().catch(() => {});
    // Only Replay sites are recorded.
    if (!(await isWatched(tab.url))) {
      await reportLog({ ok: false, error: `${page || 'This page'} isn’t recorded: add it under Settings, Replay`, page });
      iconResult(false);
      return;
    }
    const at = Date.now();
    const draftId = genId();
    const { autoReports = {} } = await chrome.storage.local.get('autoReports');
    autoReports[draftId] = { at, tabId: tab.id, page, ...(via ? { via } : {}) };
    await chrome.storage.local.set({ autoReports });
    iconBusy(true);

    // everything recorded so far, in the buffer
    const { replayLiveTabs = [], replayFocus = [] } = await chrome.storage.session.get(['replayLiveTabs', 'replayFocus']);
    await Promise.all(replayLiveTabs.map((id) => Promise.race([
      chrome.tabs.sendMessage(id, { type: 'REPLAY_FLUSH' }, { frameId: 0 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ])));
    await ensureOffscreenDocument();
    await bumpUploadsPending(1);
    try {
      await askOffscreen({ type: 'AUTO_REPORT_BUILD', draftId, at, focus: replayFocus });
    } catch (err) {
      await bumpUploadsPending(-1);
      await dropAutoReport(draftId);
      iconBusy(false);
      iconResult(false);
      await reportLog({ ok: false, error: 'Couldn’t start the report', detail: String(err?.message || err), page });
    }
  } catch (err) {
    iconBusy(false);
    iconResult(false);
    await reportLog({ ok: false, error: 'Something went wrong', detail: String(err?.message || err), page });
  }
}

async function dropAutoReport(draftId) {
  const { autoReports = {} } = await chrome.storage.local.get('autoReports');
  const entry = autoReports[draftId];
  delete autoReports[draftId];
  await chrome.storage.local.set({ autoReports });
  return entry;
}

/** The offscreen document built it: file it as a draft, on its own. */
async function autoReportBuilt(draftId, result) {
  const entry = await dropAutoReport(draftId);
  if (!entry) return;
  iconBusy(false);
  if (!result?.ok) {
    iconResult(false);
    await reportLog({ ok: false, error: result?.error === 'Nothing recorded in the last minute' ? 'Nothing was recorded in the last minute' : 'Couldn’t build the report', detail: result?.error, page: entry.page });
    return;
  }
  const d = { ...emptyDraft(), id: draftId, createdAt: entry.at, autoReport: true, replay: result.replay, ...(entry.via ? { via: entry.via } : {}) };
  const res = await fileDraftObject(d, 'draft');
  iconResult(res.ok);
  await reportLog(res.ok
    ? { ok: true, page: entry.page, detail: result.renderError ? `filed without video: ${result.renderError}` : `${result.suspects} suspect(s)` }
    : { ok: false, error: 'Couldn’t file the draft', detail: res.error, page: entry.page });
}

chrome.commands?.onCommand.addListener(async (command, tab) => {
  if (command !== 'report-now') return;
  const active = tab?.id != null ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  await startAutoReport(active);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'brief-report') await startAutoReport(tab);
});

// ---------- "Seen a bug?" (nudge.js) ----------
// A page loaded in front: the card goes there if this browser has made
// nothing for a week. Pairing starts the week.
chrome.storage.onChanged.addListener((changes, area) => {
  const t = area === 'local' && changes.briefCloudToken;
  if (t && t.newValue && t.newValue !== t.oldValue) markUsed().catch(() => {});
});

async function maybeNudge(tab) {
  const [{ briefCloudToken }, sites, rec] = await Promise.all([
    chrome.storage.local.get('briefCloudToken'), getReplaySites(), getRecSession(),
  ]);
  const show = await claimNudge({
    url: tab.url, paired: !!briefCloudToken, recording: !!rec || STATE.recording, sites, appUrl: APP_URL,
  });
  if (show) await chrome.tabs.sendMessage(tab.id, { type: 'NUDGE_SHOW' }, { frameId: 0 }).catch(() => {});
}

// Brief it on the card: the last minute on a Replay site, like the right-click
// item. Anywhere else there's no last minute to send, so a screenshot, like the
// popup's (it lands on the current draft, which the popup then shows).
async function nudgeBriefIt(tab) {
  if (!tab?.id || !tab.url) return;
  if (await isWatched(tab.url)) { await startAutoReport(tab, { via: 'nudge' }); return; }
  await startup;
  let d = await getDraft();
  if (!d) { d = emptyDraft(); await setDraft(d); }
  await chrome.storage.session.set({ nudgeShot: { itemId: d.id, at: Date.now() } });
  await startShot(d.id);
}

// ---------- Draft badge ----------
// No badge for a brief simply being in progress - that shows in the popup, and a
// dot on the orange icon only ever rendered as a muddy blob. The icon stays
// clean; we surface a badge ONLY for a real alert (the recording upload failed,
// or a filing that ran after the popup closed failed), as a legible red "!".
async function refreshBadge() {
  try {
    const d = await getDraft();
    const text = (d?.uploadFailed || d?.fileError) ? '!' : '';
    chrome.action.setBadgeText({ text });
    if (text) {
      chrome.action.setBadgeBackgroundColor({ color: '#cf3b2e' });
      chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (err) {
    console.warn('[brief/background] badge refresh:', err);
  }
}

// ---------- Instant replay: per-tab buffer (POC) ----------
// Which tabs have a recorder that answers a ping (replayLiveTabs: the replay
// editor flushes them before reading the buffer). Re-checked on every page
// load, every tab switch and every change to the site list.
const LIVE_KEY = 'replayLiveTabs';
let liveChain = Promise.resolve();

async function liveReplayTabs() {
  const r = await chrome.storage.session.get(LIVE_KEY);
  return new Set(r[LIVE_KEY] || []);
}

function setReplayLive(tabId, live) {
  liveChain = liveChain.then(async () => {
    const set = await liveReplayTabs();
    if (live) set.add(tabId); else set.delete(tabId);
    await chrome.storage.session.set({ [LIVE_KEY]: [...set] });
  }).catch((err) => console.warn('[brief/background] replay live:', err));
  return liveChain;
}


// Bring one tab in line with the site list: arm or stop, then paint what is
// actually running.
async function syncReplayTab(tabId, url) {
  const watched = !!url && (await isWatched(url));
  let live = await pingReplay(tabId);
  if (watched && !live) {
    try { await armReplay(tabId); } catch {} // restricted page, tab gone
    live = await pingReplay(tabId);
  } else if (!watched && live) {
    await stopReplay(tabId);
    live = false;
  }
  await setReplayLive(tabId, live);
}

// The browser-wide buffer: chunks land in replay-store, and a log of which tab
// was in front lets the viewer stitch tabs in the order the user saw them.
const FOCUS_KEY = 'replayFocus';
const FOCUS_RETAIN_MS = 300_000;
let focusChain = Promise.resolve();
let lastPrune = 0;

function logFocus(tabId) {
  focusChain = focusChain.then(async () => {
    const now = Date.now();
    const r = await chrome.storage.session.get(FOCUS_KEY);
    const log = (r[FOCUS_KEY] || []).filter((e) => e.t > now - FOCUS_RETAIN_MS);
    if (log[log.length - 1]?.tabId !== tabId) log.push({ t: now, tabId });
    await chrome.storage.session.set({ [FOCUS_KEY]: log });
  }).catch(() => {});
  return focusChain;
}

async function logFocusedWindowTab() {
  try {
    const w = await chrome.windows.getLastFocused({ populate: false });
    const [t] = await chrome.tabs.query({ active: true, windowId: w.id });
    if (t?.id != null) await logFocus(t.id);
  } catch {}
}

async function storeReplayChunk(tabId, m) {
  const r = await chrome.storage.session.get(FOCUS_KEY);
  if (!(r[FOCUS_KEY] || []).length) await logFocusedWindowTab();
  await putChunk({ tabId, pageId: m.pageId, url: m.url, title: m.title, full: m.full, events: m.events });
  if (Date.now() - lastPrune > 10_000) { lastPrune = Date.now(); await pruneReplay(); }
}

// Nothing recorded from a site stays once it is off the list.
async function purgeUnwatchedReplay() {
  const sites = await getReplaySites();
  const metas = await allMeta();
  await deleteChunks(metas.filter((m) => !sites.some((p) => patternMatches(p, m.url || ''))).map((m) => m.id));
}

chrome.runtime.onStartup.addListener(() => { clearReplay().catch(() => {}); syncReplaySites().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { syncReplaySites().catch(() => {}); });
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }).then(([t]) => {
    if (t?.id == null) return;
    logFocus(t.id);
    queueFollowTab(t.id);
  }).catch(() => {});
});

// A navigation tears the old page (and its recorder) down: drop the dot now,
// CONTENT_READY puts it back once the new page's recorder is up.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setReplayLive(tabId, false);
});
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  chrome.windows.getLastFocused().then((w) => { if (w.id === windowId) logFocus(tabId); }).catch(() => {});
  chrome.tabs.get(tabId).then((t) => syncReplayTab(tabId, t.url)).catch(() => {});
  queueFollowTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { setReplayLive(tabId, false); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.replaySites) return;
  chrome.tabs.query({}).then((tabs) => {
    for (const t of tabs) if (t.id != null && /^https?:/.test(t.url || '')) syncReplayTab(t.id, t.url);
  }).catch(() => {});
  purgeUnwatchedReplay().catch(() => {});
});

// Filing runs in THIS worker (filing.js). If the worker is starting up, no filing
// is in flight - so a draft still flagged `filing` was interrupted (the worker was
// recycled mid-flow). Unstick it and say so, instead of a popup frozen on
// "Filing…" forever.
async function clearStaleFiling() {
  const d = await getDraft();
  if (d?.filing) {
    await updateDraft(d.id, (x) => { x.filing = false; x.fileError = x.fileError || 'Filing was interrupted. Try again.'; });
  }
}

// Blobs (the recording, each screenshot's clean capture) outlive the draft that
// owns them when a brief is filed mid-flight or the browser dies. Startup is the
// safe moment to drop whatever the current draft no longer references.
async function pruneOrphanBlobs() {
  // ...except what drafts still being filed in the background need.
  try { await pruneFiles([...draftKeys(await getDraft()), ...(await filingKeys())]); }
  catch (err) { console.warn('[brief/background] blob prune:', err); }
}

// Worker startup: migrate any legacy multi-brief inbox to the single draft, drop
// a stale filing flag, sweep orphaned blobs, refresh the badge. Handlers that
// touch the filing state await this so the startup pass can't race them.
const startup = migrateInboxToDraft()
  .then(clearStaleFiling)
  .then(pruneOrphanBlobs)
  .then(() => resumeFiling())
  .then(async () => {
    const { autoReports = {} } = await chrome.storage.local.get('autoReports');
    const live = Object.fromEntries(Object.entries(autoReports).filter(([, r]) => Date.now() - r.at < 10 * 60_000));
    await chrome.storage.local.set({ autoReports: live });
    for (let i = 0; i < Object.keys(live).length; i++) iconBusy(true);
  })
  .then(() => refreshBadge())
  .catch(() => {});

// ---------- Offscreen document lifecycle ----------
const OFFSCREEN_PATH = 'offscreen.html';

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) return await chrome.offscreen.hasDocument();
  // Fallback for older Chrome
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts && contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Capture mic + tab audio/video for Brief recording.',
  });
}

// Close it unless it still has work: an upload or a render (uploadsPending),
// or a capture being set up or running. A recording now starts in Chrome's
// picker, which can stay open a long while; the last recording's upload
// finishing meanwhile used to take the document - and the new capture - down
// with it ("the message channel closed before a response was received").
async function closeOffscreenIfIdle() {
  if ((await getUploadsPending()) > 0) return;
  let busy = false;
  try { busy = !!(await chrome.runtime.sendMessage({ target: 'offscreen', viaBackground: true, type: 'BUSY' }))?.busy; } catch {}
  if (!busy) await closeOffscreenDocument();
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    try { await chrome.offscreen.closeDocument(); } catch {}
  }
}

// Track which tab's bar to send relayed messages back to
let ACTIVE_BAR_TAB_ID = null;

// Background uploads running in the offscreen document. While > 0 the document
// must NOT be closed (the recording streams are already released at that point,
// so a new recording can safely reuse the same document).
//
// Persisted in chrome.storage.session, NOT an in-memory variable: MV3 recycles
// the service worker after ~30s idle, and a slow upload (a big video to a slow
// server) easily outlives that. An in-memory counter would reset to 0 on the
// restart, after which the next event would close the offscreen and abort the
// in-flight fetch ("Failed to fetch"). session storage is in-memory but survives
// worker restarts and clears on browser close - exactly the lifetime we want.
const UPLOADS_KEY = 'uploadsPending';
async function getUploadsPending() {
  try { return (await chrome.storage.session.get(UPLOADS_KEY))[UPLOADS_KEY] || 0; }
  catch { return 0; }
}
async function bumpUploadsPending(delta) {
  const next = Math.max(0, (await getUploadsPending()) + delta);
  try { await chrome.storage.session.set({ [UPLOADS_KEY]: next }); } catch {}
  return next;
}

// ---------- Live recording session ----------
// The bar is an iframe INSIDE the recorded page, so a reload (or navigation)
// destroys it while the offscreen recorder keeps capturing - and nothing could
// stop the recording any more: it just vanished from the extension. We remember
// the live session here so the content script of the new page can ask for its
// bar back (CONTENT_READY → resume), and so a closed tab still stops + saves
// what was recorded. Session storage: survives worker restarts, dies with the
// browser (a recording never outlives the browser anyway).
const REC_KEY = 'recSession';
async function getRecSession() {
  try { return (await chrome.storage.session.get(REC_KEY))[REC_KEY] || null; } catch { return null; }
}
async function setRecSession(s) {
  try {
    if (s) await chrome.storage.session.set({ [REC_KEY]: s });
    else await chrome.storage.session.remove(REC_KEY);
  } catch {}
}
// Read-modify-write, one at a time: a tab switch, a mute and a page load can
// land together, and the last write would otherwise drop the others' changes.
let recSessionChain = Promise.resolve();
function updateRecSession(fn) {
  const run = recSessionChain.then(async () => {
    const s = await getRecSession();
    if (!s) return null;
    const next = fn(s);
    if (next) await setRecSession(next);
    return next;
  });
  recSessionChain = run.catch(() => {});
  return run;
}

// ---------- Window recording: the bar and the log follow the active tab ----------
// A window recording (capture 'window') films whatever tab is in front. Every
// tab it can film has the bar from the start (put up when it starts, or as a
// page begins to load: BAR_CHECK), so switching or loading a page never waits
// for one; the bar of the tab in front is the one in charge (`tabId`). Every
// tab visited gets the same event capture as the first one (`tabs` in the
// session: the ones to disarm at the end). A window picked in Chrome's picker
// only shows its own tabs; a whole screen shows every window; a tab picked
// there is just a tab recording.
const RECORDABLE_PAGE = /^(https?|file):/i;

function barInScope(s, tab) {
  if (!s || !tab) return false;
  if (tab.id === s.tabId) return true;
  return s.capture === 'window' && s.surface !== 'browser' && (s.surface === 'monitor' || tab.windowId === s.windowId);
}

function barResume(s) {
  return { itemId: s.briefId, startedAt: s.startedAt, muted: !!s.muted, intent: s.intent || 'brief', capture: s.capture || 'tab' };
}

// Put the bar up in every tab the recording can film (the ones open when it
// starts; pages loaded later ask for theirs).
async function showBars(s) {
  const tabs = await chrome.tabs.query(s.surface === 'monitor' ? {} : { windowId: s.windowId }).catch(() => []);
  for (const t of tabs) {
    if (t.id === s.tabId || t.discarded || !RECORDABLE_PAGE.test(t.url || '') || !barInScope(s, t)) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => {})
      .then(() => chrome.tabs.sendMessage(t.id, { type: 'INJECT_BAR', streamId: '', intent: s.intent || 'brief', mode: 'inbox', itemId: s.briefId, capture: s.capture, resume: { startedAt: s.startedAt, muted: !!s.muted } }))
      .catch(() => {});
  }
}

// ...and take them all down when it ends (the bar that ended it closes itself).
async function closeBars(exceptTabId) {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(tabs.filter((t) => t.id !== exceptTabId && RECORDABLE_PAGE.test(t.url || ''))
    .map((t) => chrome.tabs.sendMessage(t.id, { type: 'CLOSE_BAR' }).catch(() => {})));
}

async function followTab(tabId) {
  const s = await getRecSession();
  if (!s || s.capture !== 'window' || s.surface === 'browser' || s.tabId === tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !RECORDABLE_PAGE.test(tab.url || '')) return; // no bar on chrome:// pages
  if (s.surface === 'window' ? tab.windowId !== s.windowId
    : (await chrome.windows.getLastFocused().catch(() => null))?.id !== tab.windowId) return;
  const next = await updateRecSession((x) => x.tabId === tabId ? null
    : { ...x, tabId, tabs: [...new Set([...(x.tabs || [x.tabId]), tabId])] });
  if (!next) return;
  ACTIVE_BAR_TAB_ID = tabId;
  // In the log as "went to <page>", so the ticket reads in the order seen.
  const now = Date.now();
  recordEvent({ type: 'nav', tMs: now - next.startedAt, at: now, url: tab.url, title: tab.title || '' });
  await armTab(tabId, next);
  // Normally already there; a no-op then.
  chrome.tabs.sendMessage(tabId, {
    type: 'INJECT_BAR', streamId: '', intent: next.intent || 'brief', mode: 'inbox', itemId: next.briefId,
    capture: 'window', resume: { startedAt: next.startedAt, muted: !!next.muted },
  }).catch(() => {});
}
let followChain = Promise.resolve();
function queueFollowTab(tabId) {
  followChain = followChain.then(() => followTab(tabId)).catch((err) => console.warn('[brief/background] follow tab:', err));
  return followChain;
}

// The page's console + network capture first, THEN the content script's
// switch: the capture announces the page as it installs, and on a tab we only
// switched to that would read as the page being opened again.
async function armTab(tabId, s) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch {}
  try { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: installPageCapture }); } catch {}
  await chrome.tabs.sendMessage(tabId, { type: 'BRIEF_START', startedAt: s.startedAt }).catch(() => {});
}

// Every tab the recording armed stops logging (a tab left armed would feed
// the next recording its events).
function disarmTabs(s) {
  for (const id of new Set([...(s?.tabs || []), s?.tabId].filter((x) => x != null))) {
    chrome.tabs.sendMessage(id, { type: 'BRIEF_STOP' }).catch(() => {});
  }
}

// An event the worker itself adds to the recording's log.
function recordEvent(ev) {
  if (STATE.recording) STATE.events.push(ev);
  persistRecEvent(ev);
}

// The recording's event log (clicks, page changes, network calls, console) -
// what becomes the ticket's technical logs. It used to live only in STATE, so a
// worker recycled mid-recording (MV3 does that after ~30s without events) lost
// everything collected so far, and dropped what came after (STATE.recording was
// false again). Kept in session storage too, flushed in small batches.
const REC_EVENTS_KEY = 'recEvents';
const REC_EVENTS_MAX = 5000;
let recEventsQueue = [];
let recEventsChain = Promise.resolve();
function persistRecEvent(ev) {
  recEventsQueue.push(ev);
  if (recEventsQueue.length > 1) return recEventsChain; // a flush is already queued
  recEventsChain = recEventsChain.then(async () => {
    await new Promise((r) => setTimeout(r, 250));
    const batch = recEventsQueue;
    recEventsQueue = [];
    try {
      const prev = (await chrome.storage.session.get(REC_EVENTS_KEY))[REC_EVENTS_KEY] || [];
      await chrome.storage.session.set({ [REC_EVENTS_KEY]: prev.concat(batch).slice(-REC_EVENTS_MAX) });
    } catch {}
  });
  return recEventsChain;
}
async function getRecEvents() {
  await recEventsChain;
  try {
    const stored = (await chrome.storage.session.get(REC_EVENTS_KEY))[REC_EVENTS_KEY];
    return stored && stored.length >= STATE.events.length ? stored : STATE.events.slice();
  } catch { return STATE.events.slice(); }
}
async function clearRecEvents() {
  recEventsQueue = [];
  await recEventsChain;
  try { await chrome.storage.session.remove(REC_EVENTS_KEY); } catch {}
}
// The page the recording started on, from the session when STATE was lost.
async function recPage() {
  if (STATE.activeTabAtStart) return { pageUrl: STATE.activeTabAtStart.url || null, pageTitle: STATE.activeTabAtStart.title || null };
  const s = await getRecSession();
  return { pageUrl: s?.pageUrl || null, pageTitle: s?.pageTitle || null };
}

// Stop + save the live recording from here - the bar isn't around to do it (its
// tab was closed, or it never came back after a navigation and the recording
// overran the cap). Mirrors bar.js stopAndSave + finishToInbox: STOP the
// offscreen recorder (it uploads in the background), land the recording on the
// draft, and have the popup open on the recording next time.
async function stopRecordingFromBackground() {
  const s = await getRecSession();
  if (!s) return;
  disarmTabs(s);
  await setRecSession(null);
  if (s.capture === 'window') closeBars();
  STATE.recording = false;
  if (!(await hasOffscreenDocument())) return;
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ target: 'offscreen', viaBackground: true, type: 'STOP', briefId: s.briefId, intent: s.intent || 'brief' });
  } catch (err) {
    console.warn('[brief/background] stop from worker:', err);
  }
  // (not_recording: a bar already stopped it, and may still be uploading)
  if (!res?.ok) { closeOffscreenIfIdle().catch(() => {}); return; }
  const landed = landStoppedRecording(s.briefId);
  await bumpUploadsPending(1);
  try {
    await landed;
    await chrome.storage.local.set({ pendingOpen: { kind: 'rec', at: Date.now() } });
  } catch (err) {
    console.warn('[brief/background] draft write after worker stop:', err);
  }
  await refreshBadge();
}

// The recorder took a STOP, from the bar or from the worker: land the recording
// on the draft (a fresh one if there is none), its upload and transcription
// pending. Both start at once in the offscreen document and report back through
// updateDraft too, so queueing this first means it can't wipe what they bring
// back.
function landStoppedRecording(briefId) {
  return updateDraft(briefId, (d) => landRecording(d, { uploading: true }), { create: true })
    .catch((err) => console.warn('[brief/background] land the recording:', err));
}

// The recorded tab went away. Mid-recording: stop + save what we have. During
// the countdown (streams prepared, GO never sent): drop the prepared capture so
// it doesn't hold the tab-capture stream hostage. A window recording goes on:
// the bar moves to the tab Chrome shows next, and closing the window ends the
// capture itself (CAPTURE_ENDED).
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const s = await getRecSession();
    if (s?.capture === 'window') {
      await updateRecSession((x) => (x.tabs || []).includes(tabId) ? { ...x, tabs: x.tabs.filter((id) => id !== tabId) } : null);
      return;
    }
    if (s && s.tabId === tabId) { await stopRecordingFromBackground(); return; }
    if (tabId === ACTIVE_BAR_TAB_ID && (await hasOffscreenDocument()) && (await getUploadsPending()) === 0) {
      try { await chrome.runtime.sendMessage({ target: 'offscreen', viaBackground: true, type: 'CANCEL' }); } catch {}
    }
  } catch (err) {
    console.warn('[brief/background] tab removed:', err);
  }
});

// On install / update, inject the content script into already-open tabs.
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      if (/^(chrome|edge|chrome-extension|about|file|view-source):/i.test(tab.url)) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        });
      } catch {}
    }
    if (details?.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }).catch(() => {});
    }
    await migrateInboxToDraft().catch(() => {});
    await refreshBadge();
  } catch (err) {
    console.warn('[brief/background] on-install inject:', err);
  }
});

const STATE = {
  recording: false,
  briefId: null,
  startedAt: 0,
  events: [],
  activeTabAtStart: null,
};

// Open a URL from the SERVICE WORKER instead of the popup. The popup dies the
// moment it loses focus, taking its timers with it - so a "show the
// confirmation, then open the brief" delay run in the popup silently dropped
// the tab whenever the user clicked away. The worker outlives the popup, so the
// link always opens. An already-open tab on that URL is focused + reloaded
// rather than duplicated.
async function openOrFocusTab(url) {
  try {
    const [existing] = await chrome.tabs.query({ url });
    if (existing?.id != null) {
      await chrome.tabs.update(existing.id, { active: true });
      try { await chrome.windows.update(existing.windowId, { focused: true }); } catch {}
      chrome.tabs.reload(existing.id);
      return;
    }
  } catch { /* fall through to a plain create */ }
  try { await chrome.tabs.create({ url }); } catch (err) { console.error('[brief/background] open tab:', err); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ---------- Instant replay: a recorded chunk from a watched page ----------
  if (message?.type === 'REPLAY_CHUNK') {
    const tabId = sender?.tab?.id;
    if (tabId == null || sender.frameId !== 0) { sendResponse({ ok: false }); return false; }
    storeReplayChunk(tabId, message)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => { console.warn('[brief/background] replay chunk:', err); sendResponse({ ok: false }); });
    return true;
  }

  // ---------- Open a tab on the popup's behalf ----------
  if (message?.type === 'OPEN_TAB' && typeof message.url === 'string') {
    const { url } = message;
    const delay = Math.min(Math.max(Number(message.delayMs) || 0, 0), 3000);
    if (delay) setTimeout(() => { openOrFocusTab(url); }, delay);
    else openOrFocusTab(url);
    sendResponse({ ok: true });
    return false;
  }

  // ---------- Bar → Offscreen relay ----------
  // Bar can't message offscreen directly (different documents, no shared
  // context). Background routes by `target: 'offscreen'`.
  if (message?.target === 'offscreen') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        // Remember which tab to relay results back to (the mic levels, every
        // 40ms). Only a bar on screen: a window recording has a bar in every
        // tab it visited, and one starting up behind (a reload, or the bars
        // shown when the recording starts) asks GET_REC_STATE too - it took
        // the levels, and the bar on screen went flat.
        if (sender?.tab?.id && sender.tab.active) ACTIVE_BAR_TAB_ID = sender.tab.id;
        // Tag the forwarded copy - offscreen ignores untagged (direct
        // broadcast) copies so each command runs exactly once.
        const res = await chrome.runtime.sendMessage({ ...message, viaBackground: true });
        // A successful STOP starts a BACKGROUND upload in the offscreen
        // document (cloud-only) - guard it from teardown until OFFSCREEN_DONE.
        if (message.type === 'STOP' && res?.ok) {
          const landed = landStoppedRecording(message.briefId);
          await bumpUploadsPending(1);
          await landed;
        }
        // Remember mute so a bar resumed after a page reload shows the right state.
        if (message.type === 'MUTE') await updateRecSession((s) => ({ ...s, muted: !!message.muted }));
        sendResponse(res);
      } catch (err) {
        console.error('[brief/background] offscreen relay:', err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // ---------- Offscreen → Bar relay ----------
  // Offscreen sends {target: 'relayToBar', payload: {...}} - we forward the
  // payload to the bar's tab. The bar receives ONCE (via chrome.tabs.sendMessage)
  // - not duplicated through broadcast.
  if (message?.target === 'relayToBar') {
    (async () => {
      try {
        if (ACTIVE_BAR_TAB_ID != null && message.payload) {
          await chrome.tabs.sendMessage(ACTIVE_BAR_TAB_ID, message.payload);
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  (async () => {
    try {
      switch (message?.type) {
        case 'BRIEF_START':
          markUsed().catch(() => {});
          STATE.recording = true;
          STATE.briefId = message.briefId;
          STATE.startedAt = message.startedAt || Date.now();
          STATE.events = [];
          await clearRecEvents();
          try {
            const tab = sender?.tab
              ? { url: sender.tab.url, title: sender.tab.title, id: sender.tab.id }
              : null;
            STATE.activeTabAtStart = tab;
            if (tab?.id) {
              ACTIVE_BAR_TAB_ID = tab.id;
              const capture = message.capture === 'window' ? 'window' : 'tab';
              const session = {
                briefId: message.briefId, tabId: tab.id, startedAt: STATE.startedAt, muted: false, intent: 'brief', pageUrl: tab.url || null, pageTitle: tab.title || null,
                capture, surface: message.surface || null, windowId: sender.tab.windowId, tabs: [tab.id],
              };
              await setRecSession(session);
              if (capture === 'window') showBars(session);
              // The bar's runtime.sendMessage never reaches content scripts (only
              // tabs.sendMessage lands there) - arm the page's click/key/error
              // capture from here, or the event log stays empty.
              chrome.tabs.sendMessage(tab.id, { type: 'BRIEF_START', startedAt: STATE.startedAt }).catch(() => {});
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  world: 'MAIN',
                  func: installPageCapture,
                });
              } catch (err) {
                console.warn('[brief/background] console capture inject:', err);
              }
              // A window recording: the user may have switched tabs during the countdown.
              if (capture === 'window') {
                chrome.tabs.query({ active: true, lastFocusedWindow: true })
                  .then(([t]) => { if (t?.id != null) queueFollowTab(t.id); }).catch(() => {});
              }
            }
          } catch {
            STATE.activeTabAtStart = null;
          }
          sendResponse({ ok: true });
          break;

        case 'BRIEF_STOP': {
          STATE.recording = false;
          const ended = await getRecSession();
          disarmTabs(ended);
          await setRecSession(null);
          if (ended?.capture === 'window') closeBars(sender?.tab?.id);
          if (ACTIVE_BAR_TAB_ID != null) chrome.tabs.sendMessage(ACTIVE_BAR_TAB_ID, { type: 'BRIEF_STOP' }).catch(() => {});
          // Close the offscreen document UNLESS it's still uploading to
          // Brief Cloud in the background (the pending-uploads count was bumped
          // by the STOP relay before the bar could send BRIEF_STOP). This
          // also covers the legacy-relay and cancel paths, where the
          // OFFSCREEN_DONE message arrives while recording is still flagged
          // and therefore skips the close. A NEW capture being set up (a bar
          // from an older recording can send this late) keeps it too.
          closeOffscreenIfIdle().catch(() => {});
          sendResponse({ ok: true });
          break;
        }

        case 'RENDER_REPLAY':
          // The replay editor saved: render the replay to a video in the
          // offscreen document. Counted like an upload, so nothing closes the
          // document mid-render (a new recording just shares it).
          try {
            await ensureOffscreenDocument();
            await bumpUploadsPending(1);
            const r = await chrome.runtime.sendMessage({ target: 'offscreen', viaBackground: true, type: 'RENDER_REPLAY', draftId: message.draftId, rev: message.rev });
            if (!r?.ok) await bumpUploadsPending(-1);
            sendResponse({ ok: !!r?.ok });
          } catch (err) {
            await bumpUploadsPending(-1);
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;

        case 'REPLAY_VIDEO_DONE':
          await updateDraft(message.draftId, (d) => {
            if (d.replay?.video?.rev !== message.rev) return;
            d.replay.video = { rev: message.rev, status: message.status, bytes: message.bytes || 0, ms: message.ms || 0 };
          }).catch(() => {});
          sendResponse({ ok: true });
          break;

        case 'OFFSCREEN_DONE':
          // Offscreen finished its post-recording work (upload, relay, or
          // cancel). Tear it down unless something still needs it: another
          // pending upload, or a NEW recording that reused the document -
          // already recording, or still in Chrome's picker or its countdown.
          {
            const remaining = await bumpUploadsPending(-1);
            if (remaining === 0 && !STATE.recording) {
              closeOffscreenIfIdle().catch(() => {});
            }
          }
          sendResponse({ ok: true });
          break;

        case 'UPLOAD_RESULT': {
          // Background upload settled (offscreen). Land the outcome on the draft
          // (id-matched) so the popup can file the brief (cloudBriefId) or explain
          // a failure - works even when the popup is closed.
          try {
            await updateDraft(message.briefId, (d) => {
              d.uploading = false;
              if (message.cloudBriefId) {
                d.cloudBriefId = message.cloudBriefId;
                d.uploadFailed = false;
                d.uploadError = null;
              } else {
                d.uploadFailed = true;
                d.uploadError = message.error || 'upload failed';
              }
            });
            await refreshBadge();
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'RECORDING_POSTER': {
          // The offscreen doc made a poster (first keyframe). Land it on the
          // draft's recording (id-matched) so the tile shows a real frame.
          try {
            await updateDraft(message.briefId, (d) => {
              if (d.recording) {
                d.recording.poster = message.poster || null;
                if (message.durationMs) d.recording.durationMs = message.durationMs;
              }
            });
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'TRANSCRIPT_RESULT': {
          // The offscreen doc transcribed the recording's audio (alongside the
          // upload, so this often lands first). Land it on the draft (id-matched)
          // so the popup shows it, editable.
          try {
            await updateDraft(message.briefId, (d) => {
              d.transcribing = false;
              if (typeof message.transcript === 'string' && message.transcript.trim()) {
                d.transcript = message.transcript.trim();
                d.transcriptFailed = false;
              } else if (message.error) {
                d.transcriptFailed = true;
              } // empty + no error = genuinely no speech; leave transcript ''
            });
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'CONTENT_READY': {
          // A page finished loading. If it's the tab we're recording, the page
          // reloaded (or navigated) mid-recording: the capture is still running
          // in the offscreen document, so hand the new page its bar back in
          // resume mode, re-arm console capture, and carry the session over.
          const tabId = sender?.tab?.id;
          // Instant replay: a page on a watched site gets its rolling buffer on
          // every load. Fire and forget, it must not hold up the resume answer.
          if (tabId != null && sender.frameId === 0 && sender.tab?.url) {
            syncReplaySitesIfStale(10 * 60_000)
              .catch(() => {})
              .then(() => syncReplayTab(tabId, sender.tab.url))
              .catch((err) => console.warn('[brief/background] replay sync:', err));
            if (sender.tab.active) maybeNudge(sender.tab).catch((err) => console.warn('[brief/background] nudge:', err));
          }
          const s = await getRecSession();
          if (!s || tabId == null) { sendResponse({ ok: true }); break; }
          if (s.tabId !== tabId) {
            if (s.capture === 'window' && (s.tabs || []).includes(tabId)) {
              // A tab this window recording visited reloaded: keep logging it.
              try { await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: installPageCapture }); } catch {}
              sendResponse({ ok: true, arm: { startedAt: s.startedAt } });
            } else {
              sendResponse({ ok: true });
            }
            // The page in front loaded (a new tab that just got its address):
            // the bar goes there if the recording can see it.
            if (s.capture === 'window' && sender.tab?.active) queueFollowTab(tabId);
            break;
          }
          STATE.recording = true;
          STATE.briefId = s.briefId;
          STATE.startedAt = s.startedAt;
          ACTIVE_BAR_TAB_ID = tabId;
          try {
            await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: installPageCapture });
          } catch (err) {
            console.warn('[brief/background] console capture re-inject:', err);
          }
          sendResponse({ ok: true, resume: { itemId: s.briefId, startedAt: s.startedAt, muted: !!s.muted, intent: s.intent || 'brief', capture: s.capture || 'tab' } });
          break;
        }

        case 'EDITOR_CLOSED': {
          // An editor is done. In this order, so nothing steals focus from the
          // popup (a popup closes the instant it loses focus): close the editor
          // tab, wait until it is gone, go back to the tab it was opened from
          // (not whichever neighbour Chrome picks), then open the popup there.
          const editorTab = sender?.tab?.id;
          sendResponse({ ok: true });
          setTimeout(async () => {
            if (editorTab != null) await chrome.tabs.remove(editorTab).catch(() => {});
            if (message.backTo != null) await chrome.tabs.update(message.backTo, { active: true }).catch(() => {});
            if (message.windowId != null) await chrome.windows.update(message.windowId, { focused: true }).catch(() => {});
            // (a one-click report came from the page, not the popup: it stays shut)
            if (message.popup !== false) setTimeout(() => {
              chrome.action.openPopup(message.windowId != null ? { windowId: message.windowId } : undefined).catch(() => {});
            }, 200);
          }, Math.max(0, Number(message.delay) || 0));
          break;
        }

        case 'BAR_CHECK': {
          // A page is starting to load (content.js runs at document_start):
          // does it get the recording bar? The tab in charge does, and during
          // a window recording so does every tab the recording can film.
          const s = await getRecSession();
          sendResponse({ ok: true, resume: barInScope(s, sender?.tab) ? barResume(s) : null });
          break;
        }

        case 'CAPTURE_ENDED': {
          // A window recording's capture ended on Chrome's side ("Stop sharing",
          // the window closed). The bar saves it like a Stop; with no bar on
          // screen (the tab in front can't host one), save it from here.
          const s = await getRecSession();
          const barTab = s?.tabId ?? ACTIVE_BAR_TAB_ID;
          let handled = false;
          if (barTab != null) {
            try { handled = !!(await chrome.tabs.sendMessage(barTab, { target: 'bar', type: 'CAPTURE_ENDED' }))?.ok; } catch {}
          }
          if (!handled) await stopRecordingFromBackground();
          sendResponse({ ok: true });
          break;
        }

        case 'RECORDING_OVERRUN':
          // The offscreen recorder ran well past the cap with no bar to stop it
          // (the recorded tab never came back). Stop + save from here.
          await stopRecordingFromBackground();
          sendResponse({ ok: true });
          break;

        case 'NUDGE_BRIEF_IT':
          await nudgeBriefIt(sender?.tab);
          sendResponse({ ok: true });
          break;

        case 'NUDGE_CLOSED':
          await markClosed();
          sendResponse({ ok: true });
          break;

        case 'REPORT_NOW': {
          // One-click report for a given tab (the e2e suite sends this; a
          // popup button could too).
          const tab = message.tabId != null ? await chrome.tabs.get(message.tabId).catch(() => null) : null;
          await startAutoReport(tab);
          sendResponse({ ok: true });
          break;
        }

        case 'AUTO_REPORT_BUILT':
          await startup;
          await autoReportBuilt(message.draftId, message.result);
          sendResponse({ ok: true });
          break;

        case 'FILE_DRAFT': {
          // The popup asked to create the brief. Run it HERE (see filing.js) so
          // the flow survives the popup closing. The brief page opens after a
          // beat so the popup's confirmation can play if it's still around.
          await startup;
          markUsed().catch(() => {});
          const result = await fileDraft(message.mode === 'ticket' ? 'ticket' : 'draft', {
            openTab: (url) => setTimeout(() => { openOrFocusTab(url); }, 1200),
          });
          await refreshBadge();
          sendResponse(result);
          break;
        }

        case 'UPLOAD_VIDEO_FILE': {
          // The popup picked a video file and parked it in IndexedDB. The
          // offscreen document uploads it (it outlives the popup) through the
          // same path as a captured recording - keyframes, poster, transcript.
          markUsed().catch(() => {});
          try {
            await ensureOffscreenDocument();
            const res = await chrome.runtime.sendMessage({
              target: 'offscreen', viaBackground: true, type: 'UPLOAD_FILE',
              briefId: message.briefId, key: message.key, name: message.name, mimeType: message.mimeType,
            });
            if (res?.ok) await bumpUploadsPending(1);
            sendResponse(res || { ok: false, error: 'no response from uploader' });
          } catch (err) {
            console.error('[brief/background] UPLOAD_VIDEO_FILE:', err);
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'OPEN_PERMISSION_PAGE':
          // Bar requests it when the offscreen mic call failed - we close
          // the offscreen doc and pop open the permission tab.
          closeOffscreenDocument().catch(() => {});
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }).catch(() => {});
          sendResponse({ ok: true });
          break;

        case 'INBOX_CHANGED':
        case 'DRAFT_CHANGED':
          await refreshBadge();
          sendResponse({ ok: true });
          break;

        case 'START_SHOT':
          sendResponse(await startShot(message.itemId));
          break;

        case 'SHOT_SAVED': {
          // Land the annotated screenshot on the current draft (id-matched).
          // A shotId that's already in the draft is an EDIT: replace the image
          // and strokes in place, keeping the note, the page context and the
          // slot (and bypassing the cap - it isn't a new screenshot).
          try {
            const shotId = message.shotId || genId();
            const strokes = Array.isArray(message.strokes) ? message.strokes : [];
            let added = false;
            // a screenshot the "Seen a bug?" card started: its brief says so
            const { nudgeShot } = await chrome.storage.session.get('nudgeShot');
            const viaNudge = nudgeShot?.itemId === message.itemId && Date.now() - nudgeShot.at < 15 * 60_000;
            if (nudgeShot) await chrome.storage.session.remove('nudgeShot');
            await updateDraft(message.itemId, (d) => {
              if (viaNudge && !d.cloudBriefId) d.via = 'nudge';
              if (!Array.isArray(d.screenshots)) d.screenshots = [];
              const existing = d.screenshots.find((s) => s.id === shotId);
              if (existing) {
                existing.dataUrl = message.dataUrl;
                existing.annotated = !!message.annotated;
                existing.strokes = strokes;
                added = true;
                return;
              }
              if (d.screenshots.length >= 3) return; // hard cap: 3 screenshots per brief
              d.screenshots.push({
                id: shotId,
                dataUrl: message.dataUrl,
                annotated: !!message.annotated,
                strokes,
                description: '',
                pageUrl: message.pageUrl || null,
                pageTitle: message.pageTitle || null,
                addedAt: Date.now(),
              });
              // Pin the brief-level page context from the first capture.
              if (!d.pageUrl) { d.pageUrl = message.pageUrl || null; d.pageTitle = message.pageTitle || null; }
              added = true;
            });
            // Tell the popup to open this shot's note editor on its next render.
            if (added) { try { await chrome.storage.local.set({ pendingOpen: { kind: 'shot', id: shotId, at: Date.now() } }); } catch {} }
            await refreshBadge();
            sendResponse({ ok: true });
            // Best-effort: pop the user back to the brief to review.
            tryOpenPopup(message.itemId);
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'EDIT_SHOT': {
          // Reopen the annotator on a screenshot already in the brief: same
          // overlay, but it loads that shot's CLEAN capture from the blob store
          // and replays the strokes, so Undo and Clear act on the existing
          // marks. The overlay needs a regular page to sit on, same as capturing.
          try {
            const d = await getDraft();
            const shot = (d?.screenshots || []).find((s) => s.id === message.shotId);
            if (!shot) { sendResponse({ ok: false, error: 'shot_missing' }); break; }
            if (!(await getFile(shotKey(shot.id)))) {
              // Captured before this existed, or the blob was pruned - there is
              // no unmarked image to go back to.
              sendResponse({ ok: false, error: 'original_missing' });
              break;
            }
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) {
              sendResponse({ ok: false, error: 'unsupported_page' });
              break;
            }
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            } catch {}
            await chrome.tabs.sendMessage(tab.id, {
              type: 'INJECT_SHOT', itemId: d.id, shotId: shot.id,
              strokes: Array.isArray(shot.strokes) ? shot.strokes : [],
              pageUrl: shot.pageUrl || null, pageTitle: shot.pageTitle || null,
            });
            sendResponse({ ok: true });
          } catch (err) {
            console.error('[brief/background] EDIT_SHOT:', err);
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'REOPEN_POPUP': {
          // A recording just landed - have the popup open its sheet on next render.
          try { await chrome.storage.local.set({ pendingOpen: { kind: 'rec', at: Date.now() } }); } catch {}
          tryOpenPopup(message.briefId);
          sendResponse({ ok: true });
          break;
        }

        case 'RESET_BEFORE_NEW_RECORDING':
          await resetBeforeRecording();
          sendResponse({ ok: true });
          break;

        case 'EVENT': {
          // A worker recycled mid-recording comes back with STATE empty: the
          // live session (session storage) says whether this tab is recording.
          if (!STATE.recording && message.payload) {
            const s = await getRecSession();
            if (s && (sender?.tab?.id === s.tabId || (s.tabs || []).includes(sender?.tab?.id))) {
              STATE.recording = true;
              STATE.briefId = s.briefId;
              STATE.startedAt = s.startedAt;
            }
          }
          if (STATE.recording && message.payload) {
            STATE.events.push(message.payload);
            persistRecEvent(message.payload);
          }
          sendResponse({ ok: true });
          break;
        }

        case 'GET_BRIEF_META':
          sendResponse({ events: await getRecEvents(), ...(await recPage()) });
          break;

        case 'GET_UPLOAD_CONTEXT': {
          // The offscreen document can't touch chrome.storage (only
          // chrome.runtime is available there), so it asks US for everything
          // the background upload needs: the pairing token, this brief's draft
          // fields, and the page meta/event log we collected during recording.
          try {
            const { briefCloudToken } = await chrome.storage.local.get('briefCloudToken');
            const d = await getDraft();
            const entry = d && d.id === message.briefId ? d : null;
            // A video picked from a file (or that file, edited) was not
            // captured here: the last recording's page and event log are not
            // its own.
            const uploaded = entry?.recording?.source === 'upload';
            sendResponse({
              token: briefCloudToken || null,
              entry,
              meta: uploaded
                ? { events: [], pageUrl: null, pageTitle: null, source: 'upload' }
                : { events: await getRecEvents(), ...(await recPage()) },
            });
          } catch (err) {
            sendResponse({ token: null, entry: null, meta: { events: [], pageUrl: null, pageTitle: null }, error: String(err?.message || err) });
          }
          break;
        }

        case 'open-url':
          // The bar runs as a content script and has no chrome.tabs access, so
          // it asks us to open a filed ticket in a new tab on click.
          if (typeof message.url === 'string' && /^https?:\/\//i.test(message.url)) {
            chrome.tabs.create({ url: message.url }).catch(() => {});
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'invalid_url' });
          }
          break;

        default:
          sendResponse({ ok: false, error: 'unknown_message' });
      }
    } catch (err) {
      console.error('[brief/background]', err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

// Brief Cloud pairing: the web app pushes/revokes the token (externally_connectable).
//
// Defense in depth: manifest "externally_connectable.matches" already restricts
// which origins Chrome will deliver here, but we ALSO re-check the sender against
// an explicit allowlist before touching the stored pairing token. That way a
// pairing token can only be planted or wiped by the real Brief Cloud web app, not
// by any other allowlisted-but-unexpected origin. APP_URL covers the active
// backend (cloud.get-brief.app in prod, http://localhost:3000 when ENV="local").
const BRIEF_CLOUD_ORIGINS = new Set([
  "https://cloud.get-brief.app",
  APP_URL,
]);

function isTrustedBriefCloudSender(sender) {
  let origin = sender?.origin || null;
  if (!origin && sender?.url) {
    try { origin = new URL(sender.url).origin; } catch { origin = null; }
  }
  return !!origin && BRIEF_CLOUD_ORIGINS.has(origin);
}

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!isTrustedBriefCloudSender(sender)) {
    sendResponse({ ok: false, error: "untrusted_sender" });
    return; // ignore anything that is not the Brief Cloud web app
  }
  if (msg && msg.type === "brief-cloud-token" && typeof msg.token === "string") {
    chrome.storage.local.set({ briefCloudToken: msg.token }, () => sendResponse({ ok: true }));
    return true; // async sendResponse
  }
  if (msg && msg.type === "brief-cloud-disconnect") {
    // The user signed out on the web - the extension mirrors the session, so
    // drop the pairing. Creating a ticket from here on opens the pair page.
    chrome.storage.local.remove("briefCloudToken", () => sendResponse({ ok: true }));
    return true;
  }
});
