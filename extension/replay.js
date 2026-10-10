// Brief - instant replay recorder (POC)
//
// Injected (with vendor/rrweb-record.min.js) into the top frame of pages on a
// watched site, on every load. Records the DOM with rrweb and streams it to the
// worker in ~1s chunks (REPLAY_CHUNK), which keeps a short rolling buffer for
// the whole browser (replay-store.js). The buffer has to live outside the page:
// a navigation would otherwise take it down with the page, and a replay has to
// follow the user from tab to tab.
//
// A fresh full snapshot is taken every CHECKOUT_MS and whenever this tab comes
// back into view, so the stitched replay can start this tab at the exact moment
// the user switched to it.

(() => {
  // Injected again on a page that already has us (Watch switched off then on):
  // restart the existing recorder rather than add a second message listener.
  // Unless that one belongs to a copy of the extension that has since been
  // reloaded or updated: it can no longer reach the worker, so it is stopped
  // and this injection takes over.
  if (window.__briefReplay) {
    if (window.__briefReplay.alive?.()) { window.__briefReplay.start(); return; }
    try { window.__briefReplay.stop(); } catch {}
  }
  const record = window.rrwebRecord?.record;
  if (typeof record !== 'function') return;

  const CHECKOUT_MS = 30_000;
  const FLUSH_MS = 1000;
  const pageId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let stopFn = null;
  let batch = [];
  let hasFull = false;
  let timer = null;

  // False once the extension is reloaded, updated or removed under this page:
  // chrome.runtime.id goes away, and sendMessage then THROWS ("Extension
  // context invalidated") instead of rejecting.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!batch.length) return Promise.resolve();
    if (!alive()) { stop(); return Promise.resolve(); }
    const events = batch;
    const full = hasFull;
    batch = [];
    hasFull = false;
    try {
      return chrome.runtime.sendMessage({
        type: 'REPLAY_CHUNK', pageId, url: location.href, title: document.title, full, events,
      }).catch(() => {});
    } catch {
      stop();
      return Promise.resolve();
    }
  }

  function start() {
    if (stopFn) return;
    stopFn = record({
      emit(event) {
        batch.push(event);
        if (event.type === 2) hasFull = true;
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
      },
      checkoutEveryNms: CHECKOUT_MS,
      // Whatever people type stays out of the replay.
      maskAllInputs: true,
      recordCanvas: false,
      collectFonts: false,
      sampling: { mousemove: 50, scroll: 150, input: 'last' },
    });
  }

  function stop() {
    try { stopFn?.(); } catch {}
    stopFn = null;
    clearTimeout(timer);
    timer = null;
    batch = [];
    hasFull = false;
  }

  // What page-capture.js reports from the page's own world (network calls,
  // console, in-app navigation) goes into the replay as rrweb custom events
  // (type 5, tag 'brief'), on the same clock as everything else - so it is
  // trimmed and stitched with the replay, and the ticket can say when.
  const PAGE_KINDS = new Set(['network', 'console-error', 'console-warn', 'js-error', 'promise-rejection', 'nav']);
  window.addEventListener('message', (e) => {
    if (e.source !== window || !stopFn) return;
    const d = e.data;
    if (!d || !PAGE_KINDS.has(d.__brief)) return;
    const { __brief: kind, ...rest } = d;
    try { record.addCustomEvent('brief', { kind, ...rest }); } catch {}
  });

  document.addEventListener('visibilitychange', () => {
    if (!stopFn) return;
    if (document.visibilityState === 'visible') {
      try { record.takeFullSnapshot(true); } catch {}
    } else {
      flush();
    }
  });
  window.addEventListener('pagehide', () => { if (stopFn) flush(); });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'REPLAY_FLUSH') {
      flush().then(() => sendResponse({ ok: !!stopFn }));
      return true;
    }
    if (message?.type === 'REPLAY_STOP') {
      stop();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'REPLAY_PING') {
      sendResponse({ ok: !!stopFn });
      return false;
    }
    return false;
  });

  window.__briefReplay = { start, stop, alive };
  start();
})();
