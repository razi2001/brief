// Brief - background service worker
// Thin coordinator: collects per-tab events, manages offscreen recorder,
// relays messages between bar (in content script) and offscreen.

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

// ---------- Inbox badge ----------
async function refreshBadge() {
  try {
    const { inbox } = await chrome.storage.local.get('inbox');
    const count = Array.isArray(inbox) ? inbox.length : 0;
    if (count === 0) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: String(count > 99 ? '99+' : count) });
      chrome.action.setBadgeBackgroundColor({ color: '#dd6936' });
      chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (err) {
    console.warn('[brief/background] badge refresh:', err);
  }
}

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

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    try { await chrome.offscreen.closeDocument(); } catch {}
  }
}

// Track which tab's bar to send relayed messages back to
let ACTIVE_BAR_TAB_ID = null;

// Background uploads running in the offscreen document. While > 0 the
// document must NOT be closed (the recording streams are already released
// at that point, so a new recording can safely reuse the same document).
let UPLOADS_PENDING = 0;

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
    await refreshBadge();
  } catch (err) {
    console.warn('[brief/background] on-install inject:', err);
  }
});

const STATE = {
  recording: false,
  briefId: null,
  events: [],
  activeTabAtStart: null,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ---------- Bar → Offscreen relay ----------
  // Bar can't message offscreen directly (different documents, no shared
  // context). Background routes by `target: 'offscreen'`.
  if (message?.target === 'offscreen') {
    (async () => {
      try {
        await ensureOffscreenDocument();
        // Remember which tab to relay results back to
        if (sender?.tab?.id) ACTIVE_BAR_TAB_ID = sender.tab.id;
        // Tag the forwarded copy - offscreen ignores untagged (direct
        // broadcast) copies so each command runs exactly once.
        const res = await chrome.runtime.sendMessage({ ...message, viaBackground: true });
        // A successful STOP starts a BACKGROUND upload in the offscreen
        // document (cloud-only) - guard it from teardown until OFFSCREEN_DONE.
        if (message.type === 'STOP' && res?.ok) UPLOADS_PENDING++;
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
          STATE.recording = true;
          STATE.briefId = message.briefId;
          STATE.events = [];
          try {
            const tab = sender?.tab
              ? { url: sender.tab.url, title: sender.tab.title, id: sender.tab.id }
              : null;
            STATE.activeTabAtStart = tab;
            if (tab?.id) {
              ACTIVE_BAR_TAB_ID = tab.id;
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  world: 'MAIN',
                  func: installConsoleCapture,
                });
              } catch (err) {
                console.warn('[brief/background] console capture inject:', err);
              }
            }
          } catch {
            STATE.activeTabAtStart = null;
          }
          sendResponse({ ok: true });
          break;

        case 'BRIEF_STOP':
          STATE.recording = false;
          // Close the offscreen document UNLESS it's still uploading to
          // Brief Cloud in the background (UPLOADS_PENDING was incremented
          // by the STOP relay before the bar could send BRIEF_STOP). This
          // also covers the legacy-relay and cancel paths, where the
          // OFFSCREEN_DONE message arrives while recording is still flagged
          // and therefore skips the close.
          if (UPLOADS_PENDING === 0) closeOffscreenDocument().catch(() => {});
          sendResponse({ ok: true });
          break;

        case 'OFFSCREEN_DONE':
          // Offscreen finished its post-recording work (upload, relay, or
          // cancel). Tear it down unless something still needs it: another
          // pending upload, or a NEW recording that reused the document.
          UPLOADS_PENDING = Math.max(0, UPLOADS_PENDING - 1);
          if (UPLOADS_PENDING === 0 && !STATE.recording) {
            closeOffscreenDocument().catch(() => {});
          }
          sendResponse({ ok: true });
          break;

        case 'UPLOAD_RESULT': {
          // Background upload settled (offscreen). Land the outcome on the
          // inbox entry so the popup can file the brief (cloudBriefId) or
          // explain a failure - works even when the popup is closed.
          try {
            const { inbox } = await chrome.storage.local.get('inbox');
            const list = Array.isArray(inbox) ? inbox : [];
            const entry = list.find((b) => b.id === message.briefId);
            if (entry) {
              entry.uploading = false;
              if (message.cloudBriefId) {
                entry.cloudBriefId = message.cloudBriefId;
                delete entry.uploadFailed;
                delete entry.uploadError;
              } else {
                entry.uploadFailed = true;
                entry.uploadError = message.error || 'upload failed';
              }
              await chrome.storage.local.set({ inbox: list });
              await refreshBadge();
            }
            sendResponse({ ok: true });
          } catch (err) {
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
          await refreshBadge();
          sendResponse({ ok: true });
          break;

        case 'START_SHOT': {
          // Capture the visible tab, then inject the annotator overlay and hand
          // it the screenshot. Capture must happen here (content scripts can't).
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab?.url || /^(chrome|edge|chrome-extension|about):/.test(tab.url)) {
              sendResponse({ ok: false, error: 'unsupported_page' });
              break;
            }
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
            // Capture the page URL/title now (the screenshot's source page) and
            // pin it to the brief entry, so the ticket always has that context
            // even if the user navigates away before filing.
            try {
              const { inbox } = await chrome.storage.local.get('inbox');
              const list = Array.isArray(inbox) ? inbox : [];
              const entry = list.find((b) => b.id === message.itemId);
              if (entry) {
                entry.pageUrl = tab.url || null;
                entry.pageTitle = tab.title || null;
                await chrome.storage.local.set({ inbox: list });
              }
            } catch {}
            // Make sure the content script is present, then inject the overlay.
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            } catch {}
            await chrome.tabs.sendMessage(tab.id, {
              type: 'INJECT_SHOT', itemId: message.itemId, dataUrl,
            });
            sendResponse({ ok: true });
          } catch (err) {
            console.error('[brief/background] START_SHOT:', err);
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'SHOT_SAVED': {
          // Store the annotated screenshot dataURL on the brief entry.
          try {
            const { inbox } = await chrome.storage.local.get('inbox');
            const list = Array.isArray(inbox) ? inbox : [];
            const entry = list.find((b) => b.id === message.itemId);
            if (entry) {
              entry.screenshot = message.dataUrl;
              entry.screenshotAnnotated = !!message.annotated;
              await chrome.storage.local.set({ inbox: list });
              await refreshBadge();
            }
            sendResponse({ ok: true });
            // Best-effort: pop the user back to the brief to review/export.
            // Pass the brief id so the popup auto-expands its details panel.
            tryOpenPopup(message.itemId);
          } catch (err) {
            sendResponse({ ok: false, error: String(err?.message || err) });
          }
          break;
        }

        case 'REOPEN_POPUP': {
          tryOpenPopup(message.briefId);
          sendResponse({ ok: true });
          break;
        }

        case 'RESET_BEFORE_NEW_RECORDING':
          // Before a new recording, ensure no stale recording infrastructure
          // is holding a tabCapture stream. Close offscreen, dismiss any
          // open bar in any tab, clear state. EXCEPTION: while a background
          // upload is running, keep the document - its capture streams are
          // already released (collectRecording cleans up before uploading),
          // so the new recording can safely reuse it.
          STATE.recording = false;
          STATE.events = [];
          try {
            if (ACTIVE_BAR_TAB_ID != null) {
              await chrome.tabs.sendMessage(ACTIVE_BAR_TAB_ID, { type: 'CLOSE_BAR' });
            }
          } catch {}
          if (UPLOADS_PENDING === 0) {
            await closeOffscreenDocument().catch(() => {});
          }
          // Small wait for Chrome to fully release the tabCapture stream
          await new Promise((r) => setTimeout(r, 150));
          sendResponse({ ok: true });
          break;

        case 'EVENT':
          if (STATE.recording && message.payload) {
            STATE.events.push(message.payload);
          }
          sendResponse({ ok: true });
          break;

        case 'GET_BRIEF_META':
          sendResponse({
            events: STATE.events.slice(),
            pageUrl: STATE.activeTabAtStart?.url || null,
            pageTitle: STATE.activeTabAtStart?.title || null,
          });
          break;

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

// ---------- Page-world console capture (injected via executeScript world:'MAIN') ----------
// Patches console.error and window error handlers. Each captured event posts a
// message that our content script picks up and forwards as an EVENT.
function installConsoleCapture() {
  if (window.__briefConsoleInstalled) return;
  window.__briefConsoleInstalled = true;

  const serialize = (a) => {
    try {
      if (a == null) return String(a);
      if (typeof a === 'string') return a.slice(0, 500);
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      return JSON.stringify(a).slice(0, 500);
    } catch {
      return String(a).slice(0, 500);
    }
  };

  const orig = console.error;
  console.error = function (...args) {
    try {
      window.postMessage({
        __brief: 'console-error',
        args: args.map(serialize),
      }, '*');
    } catch {}
    return orig.apply(this, args);
  };

  window.addEventListener('error', (e) => {
    try {
      window.postMessage({
        __brief: 'js-error',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
      }, '*');
    } catch {}
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      window.postMessage({
        __brief: 'promise-rejection',
        reason: serialize(e.reason),
      }, '*');
    } catch {}
  });

  // --- Network failures: patch fetch + XHR. Report transport errors and
  // non-2xx responses so the ticket can list what failed. ---
  const shortUrl = (u) => {
    try {
      const s = String(u);
      return s.length > 300 ? s.slice(0, 300) + '…' : s;
    } catch { return ''; }
  };
  const postNet = (method, url, status, reason) => {
    try {
      window.postMessage({
        __brief: 'network-error',
        method: (method || 'GET').toUpperCase(),
        url: shortUrl(url),
        status: status || 0,
        reason: reason || '',
      }, '*');
    } catch {}
  };

  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      return origFetch.apply(this, arguments).then((res) => {
        if (res && !res.ok) postNet(method, url, res.status, res.statusText);
        return res;
      }).catch((err) => {
        postNet(method, url, 0, (err && err.message) || 'network error');
        throw err;
      });
    };
  }

  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const open = XHR.prototype.open;
      const send = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__brief_m = method; this.__brief_u = url;
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        this.addEventListener('load', () => {
          if (this.status >= 400) postNet(this.__brief_m, this.__brief_u, this.status, this.statusText);
        });
        this.addEventListener('error', () => postNet(this.__brief_m, this.__brief_u, 0, 'network error'));
        this.addEventListener('timeout', () => postNet(this.__brief_m, this.__brief_u, 0, 'timeout'));
        return send.apply(this, arguments);
      };
    }
  } catch {}
}

// Brief Cloud pairing: receive the token from the web app (externally_connectable).
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "brief-cloud-token" && typeof msg.token === "string") {
    chrome.storage.local.set({ briefCloudToken: msg.token }, () => sendResponse({ ok: true }));
    return true; // async sendResponse
  }
});
