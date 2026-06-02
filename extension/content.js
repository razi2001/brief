// Brief — content script
// 1. On INJECT_BAR message, creates the floating bar iframe overlay
// 2. During recording, captures user events (click/key/scroll) on this tab

(() => {
  if (window.__briefInjected) return;
  window.__briefInjected = true;

  let active = false;
  let startedAt = 0;
  let iframeEl = null;
  // Dragged bar position as viewport fractions {leftPct, topPct}, or null for
  // the default bottom-center spot. Set by the bar via 'posChanged' messages.
  let barPosPct = null;

  // ---------- Message router ----------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'INJECT_BAR') {
      injectBar(message.streamId, message.lang || 'en-US', message.intent || 'brief', message.mode || 'ship', message.itemId || '');
    } else if (message?.type === 'INJECT_SHOT') {
      injectShot(message.itemId || '', message.dataUrl || '');
    } else if (message?.type === 'BRIEF_START') {
      active = true;
      startedAt = message.startedAt || Date.now();
    } else if (message?.type === 'BRIEF_STOP') {
      active = false;
    } else if (message?.type === 'CLOSE_BAR') {
      removeBar();
    }
    return false;
  });

  // ---------- Screenshot annotator overlay ----------
  let shotEl = null;
  let shotImg = '';
  function injectShot(itemId, dataUrl) {
    if (shotEl) return;
    shotImg = dataUrl;
    const url = chrome.runtime.getURL('shot.html') + '#itemId=' + encodeURIComponent(itemId);
    shotEl = document.createElement('iframe');
    shotEl.id = '__brief_shot__';
    shotEl.src = url;
    Object.assign(shotEl.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      border: '0',
      background: 'transparent',
      zIndex: '2147483647',
      colorScheme: 'normal',
    });
    (document.body || document.documentElement).appendChild(shotEl);
    window.addEventListener('message', onShotMessage);
  }

  function onShotMessage(e) {
    if (!shotEl || e.source !== shotEl.contentWindow) return;
    const m = e.data;
    if (!m || m.app !== 'brief-shot') return;
    if (m.type === 'ready') {
      // hand the captured image into the overlay
      shotEl.contentWindow.postMessage({ app: 'brief-shot', type: 'image', dataUrl: shotImg }, '*');
    } else if (m.type === 'save') {
      // Relay the annotated PNG to the background to store on the brief.
      chrome.runtime.sendMessage({
        type: 'SHOT_SAVED', itemId: m.itemId, dataUrl: m.dataUrl, annotated: !!m.annotated,
      }).catch(() => {});
      removeShot();
    } else if (m.type === 'cancel') {
      removeShot();
    }
  }

  function removeShot() {
    if (shotEl) {
      window.removeEventListener('message', onShotMessage);
      shotEl.remove();
      shotEl = null;
      shotImg = '';
    }
  }

  // ---------- Iframe injection ----------
  function injectBar(streamId, lang, intent, mode, itemId) {
    // If a bar is already on-screen, ignore — recording's in progress
    if (iframeEl) return;
    const hashParts = [
      `streamId=${encodeURIComponent(streamId)}`,
      `lang=${encodeURIComponent(lang)}`,
      `intent=${encodeURIComponent(intent)}`,
      `mode=${encodeURIComponent(mode || 'ship')}`,
      `itemId=${encodeURIComponent(itemId || '')}`,
    ];
    const url = chrome.runtime.getURL('bar.html') + '#' + hashParts.join('&');

    iframeEl = document.createElement('iframe');
    iframeEl.id = '__brief_iframe__';
    iframeEl.src = url;
    iframeEl.allow = 'microphone; camera; display-capture; clipboard-write';
    iframeEl.scrolling = 'no';
    // Fixed, compact size with a GENEROUS height that comfortably fits both the
    // collapsed bar and the expanded (transcript) state. The size is constant —
    // we never recompute it from zoom-scaled measurements, which was the source
    // of the drift. The bar lays out bottom-anchored inside; extra height is
    // transparent + click-through (body is pointer-events:none, the bar is auto).
    Object.assign(iframeEl.style, {
      position: 'fixed',
      bottom: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '400px',
      height: '135px',
      border: '0',
      background: 'transparent',
      zIndex: '2147483647',
      colorScheme: 'normal',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxShadow: 'none',
      transition: 'opacity 0.18s ease',
    });
    (document.body || document.documentElement).appendChild(iframeEl);

    // Restore a previously dragged position (viewport fractions). The iframe
    // keeps its fixed size; only its left/top move.
    try {
      chrome.storage.local.get('barPos', ({ barPos }) => {
        if (barPos && typeof barPos.leftPct === 'number' && typeof barPos.topPct === 'number') {
          barPosPct = barPos;
          requestAnimationFrame(() => applyIframePos(barPosPct.leftPct, barPosPct.topPct));
        }
      });
    } catch {}

    window.addEventListener('message', onIframeMessage);
    window.addEventListener('resize', onViewportResize);
  }

  // Move the (fixed-size) iframe to a viewport-fraction position, clamped so it
  // stays fully on-screen. Percentages keep it put across zoom.
  function applyIframePos(leftPct, topPct) {
    if (!iframeEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = iframeEl.offsetWidth || 400;
    const h = iframeEl.offsetHeight || 135;
    const maxLeftPct = vw > w ? ((vw - w) / vw) * 100 : 0;
    const maxTopPct = vh > h ? ((vh - h) / vh) * 100 : 0;
    const L = Math.max(0, Math.min(maxLeftPct, leftPct));
    const T = Math.max(0, Math.min(maxTopPct, topPct));
    iframeEl.style.left = `${L}%`;
    iframeEl.style.top = `${T}%`;
    iframeEl.style.right = '';
    iframeEl.style.bottom = '';
    iframeEl.style.transform = ''; // drop the default translateX centering
  }

  function persistPosition() {
    if (!barPosPct) return;
    try { chrome.storage.local.set({ barPos: barPosPct }); } catch {}
  }

  // Keep a dragged iframe on-screen when the viewport changes (incl. zoom).
  function onViewportResize() {
    if (!iframeEl || !barPosPct) return;
    applyIframePos(barPosPct.leftPct, barPosPct.topPct);
  }

  // ---------- Drag (page-level; moves the whole iframe) ----------
  let dragData = null; // {grabX, grabY, startLeft, startTop}

  function onDragMove(e) {
    if (!dragData || !iframeEl) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = iframeEl.offsetWidth || 400;
    const h = iframeEl.offsetHeight || 135;
    // New top-left = cursor minus where inside the iframe it was grabbed.
    let left = e.clientX - dragData.grabX;
    let top = e.clientY - dragData.grabY;
    left = Math.max(0, Math.min(vw - w, left));
    top = Math.max(0, Math.min(vh - h, top));
    iframeEl.style.left = `${(left / vw) * 100}%`;
    iframeEl.style.top = `${(top / vh) * 100}%`;
    iframeEl.style.right = '';
    iframeEl.style.bottom = '';
    iframeEl.style.transform = '';
  }

  function onDragUp() {
    if (!dragData) return;
    dragData = null;
    if (iframeEl) {
      iframeEl.style.pointerEvents = 'auto';
      const rect = iframeEl.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      barPosPct = { leftPct: (rect.left / vw) * 100, topPct: (rect.top / vh) * 100 };
      persistPosition();
    }
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragUp, true);
  }

  function onIframeMessage(e) {
    if (!iframeEl || e.source !== iframeEl.contentWindow) return;
    const msg = e.data;
    if (!msg || msg.app !== 'brief') return;
    if (msg.type === 'close') {
      fadeOutAndRemove();
    } else if (msg.type === 'dragStart') {
      // The grab point inside the iframe (CSS px from the iframe's top-left).
      dragData = { grabX: Number(msg.grabX) || 0, grabY: Number(msg.grabY) || 0 };
      // Let the cursor pass through the iframe to the page during the drag.
      iframeEl.style.pointerEvents = 'none';
      document.addEventListener('mousemove', onDragMove, true);
      document.addEventListener('mouseup', onDragUp, true);
    }
  }

  function fadeOutAndRemove() {
    if (!iframeEl) return;
    iframeEl.style.opacity = '0';
    setTimeout(removeBar, 280);
  }

  function removeBar() {
    if (iframeEl) {
      window.removeEventListener('message', onIframeMessage);
      iframeEl.remove();
      iframeEl = null;
    }
  }

  // ---------- Event capture ----------
  function describeElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
        : '';
    const text = (el.innerText || el.value || '').trim().slice(0, 80);
    return { tag, selector: `${tag}${id}${cls}`, text };
  }

  function report(eventType, detail) {
    if (!active) return;
    chrome.runtime
      .sendMessage({
        type: 'EVENT',
        payload: {
          type: eventType,
          tMs: Date.now() - startedAt,
          url: location.href,
          ...detail,
        },
      })
      .catch(() => {});
  }

  document.addEventListener(
    'click',
    (e) => {
      // Ignore clicks inside the bar iframe (different document, won't bubble here anyway)
      const el = describeElement(e.target);
      if (el) report('click', { element: el, x: e.clientX, y: e.clientY });
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target?.tagName || '').toUpperCase());
      report('key', {
        key: e.key.length === 1 ? '<char>' : e.key,
        isInput,
      });
    },
    true,
  );

  let scrollTimer = null;
  document.addEventListener(
    'scroll',
    () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        report('scroll', { y: window.scrollY });
      }, 250);
    },
    { capture: true, passive: true },
  );

  // ---------- Page-world console capture forwarding ----------
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d.__brief !== 'string') return;
    if (d.__brief === 'console-error') {
      report('console-error', { args: d.args });
    } else if (d.__brief === 'js-error') {
      report('js-error', {
        message: d.message,
        filename: d.filename,
        lineno: d.lineno,
        colno: d.colno,
      });
    } else if (d.__brief === 'promise-rejection') {
      report('promise-rejection', { reason: d.reason });
    } else if (d.__brief === 'network-error') {
      report('network-error', {
        method: d.method,
        url: d.url,
        status: d.status,
        reason: d.reason,
      });
    }
  });
})();
