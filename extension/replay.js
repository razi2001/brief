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

  // ---- images the page shows from blob: URLs ----
  // A blob: URL lives only as long as the page (often less: apps revoke it
  // once the image loads), so a replay of `<img src="blob:...">` - an icon, an
  // avatar - plays blank. Its pixels are kept instead, as a custom event
  // ('brief-blob' {url, data}), and the editor puts them back in place
  // (replay-merge inlineBlobImages). Re-sent with every full snapshot, so the
  // rolling buffer never loses one that loaded before its window.
  const BLOB_MAX = 300_000;
  const BLOB_TOTAL = 4_000_000;
  const blobs = new Map(); // url -> data: URL, or null once tried
  let blobBytes = 0;
  const emitBlob = (url, data) => { if (stopFn) { try { record.addCustomEvent('brief-blob', { url, data }); } catch {} } };
  const readBlob = (url) => fetch(url).then((r) => r.blob()).then((b) => (b.size > BLOB_MAX ? null : new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => res(null);
    fr.readAsDataURL(b);
  }))).catch(() => null);
  async function keepBlob(img, url) {
    if (blobs.has(url) || blobBytes > BLOB_TOTAL) return;
    blobs.set(url, null);
    let data = null;
    try {
      // drawn from the element: works even after the app revoked the URL
      if (img.complete && img.naturalWidth) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        data = c.toDataURL('image/png');
      }
    } catch {}
    if (!data || data.length > BLOB_MAX * 1.4) data = await readBlob(url);
    if (!data || data.length > BLOB_MAX * 1.4) return;
    blobs.set(url, data);
    blobBytes += data.length;
    emitBlob(url, data);
  }
  const watchImg = (img) => {
    const url = img.getAttribute('src') || '';
    if (!url.startsWith('blob:') || blobs.has(url)) return;
    if (img.complete) keepBlob(img, url);
    else img.addEventListener('load', () => keepBlob(img, url), { once: true });
  };
  const scanBlobs = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === 'IMG') watchImg(root);
    for (const img of root.querySelectorAll('img[src^="blob:"]')) watchImg(img);
  };
  let blobObserver = null;

  function start() {
    if (stopFn) return;
    stopFn = record({
      emit(event) {
        batch.push(event);
        if (event.type === 2) {
          hasFull = true;
          // a fresh snapshot: its blob images travel with it
          queueMicrotask(() => { for (const [u, d] of blobs) if (d) emitBlob(u, d); });
        }
        if (!timer) timer = setTimeout(flush, FLUSH_MS);
      },
      checkoutEveryNms: CHECKOUT_MS,
      // Whatever people type stays out of the replay.
      maskAllInputs: true,
      recordCanvas: false,
      collectFonts: false,
      sampling: { mousemove: 50, scroll: 150, input: 'last' },
    });
    scanBlobs(document.documentElement);
    blobObserver = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') scanBlobs(m.target);
        else for (const n of m.addedNodes) scanBlobs(n);
      }
    });
    blobObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  }

  function stop() {
    try { blobObserver?.disconnect(); } catch {}
    blobObserver = null;
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
