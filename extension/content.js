// Brief - content script
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
      // `resume`: the bar of a recording already running (a window recording
      // puts one in every tab). Only the bar: logging starts with BRIEF_START,
      // on the tabs the user actually visits.
      injectBar(message.streamId, message.intent || 'brief', message.mode || 'ship', message.itemId || '', message.resume, message.capture);
    } else if (message?.type === 'SHOT_COUNTDOWN') {
      shotCountdown(Number(message.seconds) || 3, message.itemId || '');
      sendResponse({ ok: true });
      return false;
    } else if (message?.type === 'INJECT_SHOT') {
      injectShot(message.itemId || '', message.dataUrl || '', message.pageUrl || '', message.pageTitle || '',
        message.shotId || '', message.strokes || []);
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

  // ---------- Screenshot countdown ----------
  // A small dark banner at the foot of the page: "Screenshot in 3", Cancel.
  // At zero it leaves (and the page repaints without it) before the
  // screenshot is asked for, so it is never in the picture.
  let cdHost = null, cdTimer = null;
  function endCountdown() {
    clearInterval(cdTimer); cdTimer = null;
    const h = cdHost; cdHost = null;
    if (h) h.remove();
  }
  function shotCountdown(seconds, itemId) {
    endCountdown();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;left:0;right:0;bottom:24px;z-index:2147483647;display:flex;justify-content:center;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .b { pointer-events:auto; display:flex; align-items:center; gap:12px; height:40px; padding:0 6px 0 14px; border-radius:12px;
        background:#221d18; color:#f5f1e8; font:500 13px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; letter-spacing:-.005em;
        box-shadow:0 0 0 1px rgba(255,255,255,.06), 0 12px 32px -8px rgba(0,0,0,.45);
        animation:in 260ms cubic-bezier(.23,1,.32,1) both; }
      .b.out { animation:out 160ms ease both; }
      @keyframes in { from { opacity:0; transform:translateY(10px) scale(.98); } }
      @keyframes out { to { opacity:0; transform:translateY(6px); } }
      svg { width:16px; height:16px; color:#dd6936; flex:none; }
      .n { display:inline-block; min-width:9px; font-variant-numeric:tabular-nums; font-weight:600; }
      .n.tick { animation:tick 300ms cubic-bezier(.23,1,.32,1); }
      @keyframes tick { from { opacity:.2; transform:translateY(-3px); } }
      button { all:unset; cursor:pointer; height:28px; padding:0 10px; border-radius:8px; color:#c9c2b6; font:500 12.5px/28px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }
      button:hover { background:rgba(255,255,255,.08); color:#fff; }
      @media (prefers-reduced-motion: reduce) { .b, .b.out, .n.tick { animation:none; } }
    </style>
    <div class="b" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
      <span>Screenshot in <span class="n">${seconds}</span></span><button type="button">Cancel</button></div>`;
    (document.body || document.documentElement).appendChild(host);
    cdHost = host;
    const n = root.querySelector('.n');
    root.querySelector('button').addEventListener('click', () => { endCountdown(); dropPreload(); });
    preloadShot(itemId);
    let left = seconds;
    cdTimer = setInterval(() => {
      left--;
      if (left > 0) { n.textContent = String(left); n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); return; }
      // Zero: the banner goes at once (no fade: the screenshot shouldn't wait
      // for it), and the screenshot is asked for as soon as the page has drawn
      // one frame without it. A tab that isn't drawing (you switched away) runs
      // no frames, hence the short fallback.
      endCountdown();
      // if the picture never comes (taken in another tab, or failed), the hidden editor goes
      preloadTimer = setTimeout(dropPreload, 8000);
      let sent = false;
      const ask = () => { if (sent) return; sent = true; try { chrome.runtime.sendMessage({ type: 'SHOT_COUNTDOWN_DONE', itemId }); } catch {} };
      requestAnimationFrame(() => setTimeout(ask, 0));
      setTimeout(ask, 60);
    }, 1000);
  }

  // ---------- Screenshot annotator overlay ----------
  let shotEl = null;
  let shotImg = '';
  let shotPageUrl = '';
  let shotPageTitle = '';
  let shotId = '';
  let shotStrokes = [];
  // `dataUrl` empty + a `shotId` set = editing an existing screenshot: the
  // overlay loads that shot's clean capture itself and replays `strokes`.
  // The editor is an iframe that takes a moment to load. During a countdown it
  // is loaded ahead, hidden (not in the picture, not in your way, no focus),
  // so at zero it only has to be shown and handed the picture.
  let shotReady = false, shotPreloaded = false, preloadTimer = null;
  function createShotFrame(itemId, hidden) {
    shotReady = false;
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
    }, hidden ? { visibility: 'hidden', pointerEvents: 'none' } : {});
    (document.body || document.documentElement).appendChild(shotEl);
    window.addEventListener('message', onShotMessage);
  }
  function preloadShot(itemId) {
    if (shotEl) return;
    createShotFrame(itemId, true);
    shotPreloaded = true;
  }
  function dropPreload() {
    clearTimeout(preloadTimer); preloadTimer = null;
    if (shotPreloaded) { shotPreloaded = false; removeShot(); }
  }
  function postShotImage() {
    shotEl?.contentWindow?.postMessage({
      app: 'brief-shot', type: 'image', dataUrl: shotImg, shotId, strokes: shotStrokes,
    }, '*');
  }
  function injectShot(itemId, dataUrl, pageUrl, pageTitle, id, strokes) {
    const reuse = !!shotEl && shotPreloaded;
    if (shotEl && !reuse) return;
    shotImg = dataUrl;
    shotPageUrl = pageUrl || '';
    shotPageTitle = pageTitle || '';
    shotId = id || '';
    shotStrokes = Array.isArray(strokes) ? strokes : [];
    if (reuse) {
      clearTimeout(preloadTimer); preloadTimer = null;
      shotPreloaded = false;
      shotEl.style.visibility = '';
      shotEl.style.pointerEvents = '';
      if (shotReady) postShotImage();
      return;
    }
    createShotFrame(itemId, false);
  }
  function onShotMessage(e) {
    if (!shotEl || e.source !== shotEl.contentWindow) return;
    const m = e.data;
    if (!m || m.app !== 'brief-shot') return;
    if (m.type === 'ready') {
      // hand the captured image (or the shot to edit) into the overlay; a
      // preloaded one gets it when the picture is taken
      shotReady = true;
      if (!shotPreloaded) postShotImage();
    } else if (m.type === 'save') {
      // Relay the annotated PNG (with its source page context) to the background
      // to append to - or replace on - the current draft's screenshots.
      chrome.runtime.sendMessage({
        type: 'SHOT_SAVED', itemId: m.itemId, shotId: m.shotId || '', dataUrl: m.dataUrl,
        annotated: !!m.annotated, strokes: m.strokes || [],
        pageUrl: shotPageUrl, pageTitle: shotPageTitle,
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
      shotPageUrl = '';
      shotPageTitle = '';
      shotId = '';
      shotStrokes = [];
    }
  }

  // ---------- Iframe injection ----------
  // `resume` ({ startedAt, muted }) puts the bar back for a recording that is
  // already running in the offscreen document (this page reloaded mid-recording,
  // or a window recording followed the user to this tab).
  function injectBar(streamId, intent, mode, itemId, resume, capture) {
    // If a bar is already on-screen, ignore - recording's in progress
    if (iframeEl) return;
    const hashParts = [
      `streamId=${encodeURIComponent(streamId || '')}`,
      `intent=${encodeURIComponent(intent)}`,
      `mode=${encodeURIComponent(mode || 'ship')}`,
      `itemId=${encodeURIComponent(itemId || '')}`,
      `capture=${encodeURIComponent(capture || 'tab')}`,
    ];
    if (resume) {
      hashParts.push('resume=1', `startedAt=${encodeURIComponent(String(resume.startedAt || ''))}`);
      if (resume.muted) hashParts.push('muted=1');
    }
    const url = chrome.runtime.getURL('bar.html') + '#' + hashParts.join('&');

    iframeEl = document.createElement('iframe');
    iframeEl.id = '__brief_iframe__';
    iframeEl.src = url;
    iframeEl.allow = 'microphone; camera; display-capture; clipboard-write';
    iframeEl.scrolling = 'no';
    // Fixed, compact size. The size is constant - we never recompute it from
    // zoom-scaled measurements, which was the source of the drift. The bar lays
    // out bottom-anchored inside; the small amount of extra height above it is
    // transparent + click-through (body is pointer-events:none, the bar is auto).
    // Bottom center until dragged, lifted clear of where Chrome puts its own
    // "sharing a window" bar during a recording (a corner went unnoticed).
    Object.assign(iframeEl.style, {
      position: 'fixed',
      bottom: '52px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '400px',
      height: '104px', // room under the pill for its shadow, now off the window's edge
      border: '0',
      background: 'transparent',
      zIndex: '2147483647',
      colorScheme: 'normal',
      pointerEvents: 'auto',
      overflow: 'hidden',
      boxShadow: 'none',
      transition: 'opacity 0.14s ease-out',
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
    setTimeout(removeBar, 160); // just past the fade: closing feels instant
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
          at: Date.now(), // the real time; page-capture events bring their own
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
      // Cheap guard: skip work entirely outside an active recording.
      if (!active) return;
      // Some sites (notably synthetic keydown events from autofill, OAuth
      // redirects, password managers, framework testing harnesses) fire
      // KeyboardEvents without a `key` field. Don't crash on those.
      const k = e.key;
      if (typeof k !== 'string') return;
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target?.tagName || '').toUpperCase());
      report('key', {
        key: k.length === 1 ? '<char>' : k,
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
    // `at`: the real time it happened (epoch ms), for clock times in the logs
    if (d.__brief === 'console-error') {
      report('console-error', { args: d.args, at: d.at });
    } else if (d.__brief === 'js-error') {
      report('js-error', {
        at: d.at,
        message: d.message,
        filename: d.filename,
        lineno: d.lineno,
        colno: d.colno,
      });
    } else if (d.__brief === 'promise-rejection') {
      report('promise-rejection', { reason: d.reason, at: d.at });
    } else if (d.__brief === 'network-error') {
      report('network-error', {
        method: d.method,
        url: d.url,
        status: d.status,
        reason: d.reason,
      });
    } else if (d.__brief === 'network') {
      report('network', {
        method: d.method, url: d.url, status: d.status, ms: d.ms, reason: d.reason, at: d.at,
        trace: d.trace, request: d.request, response: d.response,
      });
    } else if (d.__brief === 'console-warn') {
      report('console-warn', { args: d.args, at: d.at });
    } else if (d.__brief === 'nav') {
      report('nav', { title: d.title, at: d.at, load: !!d.load });
    }
  });

  // ---------- The bar, as soon as the page starts ----------
  // This script runs at document_start, so a page that loads mid-recording
  // (a reload, a link, a new tab) gets its bar before the page itself has
  // loaded, not seconds later: the bar is only UI, the log waits below.
  try {
    chrome.runtime.sendMessage({ type: 'BAR_CHECK' }).then((res) => {
      const r = res?.resume;
      if (r) injectBar('', r.intent || 'brief', 'inbox', r.itemId || '', { startedAt: r.startedAt, muted: !!r.muted }, r.capture);
    }).catch(() => {});
  } catch {}

  // ---------- Resume after a reload ----------
  // The bar lives inside this page, so reloading mid-recording destroyed it while
  // the offscreen recorder kept going - the recording just vanished. Ask the
  // worker whether a recording is live for THIS tab; if so, put the bar back
  // (timer continuing from the original start) and keep capturing events.
  // A window recording also logs the other tabs it visited: `arm` keeps this
  // page's events coming after a reload, without the bar. Sent once the DOM is
  // in, as when this script ran at document_idle (the replay recorder that the
  // worker arms from here needs the page).
  const contentReady = () => {
    try {
      chrome.runtime.sendMessage({ type: 'CONTENT_READY' }).then((res) => {
        if (res?.arm) { active = true; startedAt = res.arm.startedAt || Date.now(); }
        const r = res?.resume;
        if (!r) return;
        active = true;
        startedAt = r.startedAt || Date.now();
        injectBar('', r.intent || 'brief', 'inbox', r.itemId || '', { startedAt: r.startedAt, muted: !!r.muted }, r.capture);
      }).catch(() => {});
    } catch {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(contentReady, 0), { once: true });
  else contentReady();
})();
