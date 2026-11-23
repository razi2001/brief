  // ---- the screenshot editor and the bar over pages that fight them ----
  // Pages broke the overlay when it was a plain iframe in <body>: their CSS
  // reached it, a transformed <body> or a stacking context drew over it, a
  // <frameset> never drew it, and an open modal <dialog> (top layer, the rest
  // inert) kept the pointer and the keys: you couldn't draw. Each page here does
  // one or more of those; on each, a screenshot is drawn on and saved with Enter.
  const hostileHead = `<style>
    body{transform:translateZ(0) scale(1);filter:contrast(1);contain:paint;margin:0;padding:40px}
    iframe{display:none!important;pointer-events:none!important;width:10px!important}
    dialog{z-index:2147483647}
  </style>`;
  PAGES['/hostile'] = `<!doctype html><html><head><title>Hostile</title>${hostileHead}</head><body>
    <h2>Checkout</h2><iframe src="/settings"></iframe>
    <x-card></x-card>
    <dialog id="dlg"><p>Are you sure?</p><input id="trap"/><button>OK</button></dialog>
    <script>
      customElements.define('x-card', class extends HTMLElement { constructor(){ super(); this.attachShadow({mode:'open'}).innerHTML='<div style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.2);box-shadow:0 0 40px #000">shadow overlay</div>'; } });
      dlg.showModal();
      // a focus trap, as modal libraries do: focus leaving the dialog comes back
      document.addEventListener('focusin', (e) => { if (!dlg.contains(e.target)) { window.trapped = (window.trapped||0)+1; trap.focus(); } });
      trap.focus();
    </script></body></html>`;
  PAGES['/frames'] = `<!doctype html><html><head><title>Frames</title></head>
    <frameset cols="50%,50%"><frame src="/settings"><frame src="/home"></frameset></html>`;
  PAGES['/rerender'] = `<!doctype html><html><head><title>Rerender</title></head><body><div id="app">App</div>
    <script>
      // an app that owns the whole document: anything it didn't put there goes
      new MutationObserver(() => { for (const n of [...document.documentElement.children]) if (!['HEAD','BODY'].includes(n.tagName)) n.remove(); })
        .observe(document.documentElement, { childList: true });
    </script></body></html>`;

  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const picture = await W(`(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 600;
    const g = c.getContext('2d'); g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 1000, 600); return c.toDataURL('image/png'); })()`);

  for (const [name, route] of [['modal dialog + focus trap + page CSS on iframes + transformed body + shadow overlay', '/hostile'], ['frameset', '/frames'], ['an app that removes what it did not add', '/rerender']]) {
    const itemId = 'd-ov-' + route.slice(1);
    await W(`chrome.storage.local.set({ draft: { id: '${itemId}', createdAt: Date.now(), screenshots: [], description: '' } })`);
    const site = await open(`http://localhost:${WEB}${route}`); await focus(site); await sleep(800);
    await W(`(async () => { const [t] = await chrome.tabs.query({ url: 'http://localhost:${WEB}${route}' });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(t.id, { type: 'INJECT_SHOT', itemId: '${itemId}', dataUrl: ${JSON.stringify(picture)}, shotId: '', pageUrl: t.url, pageTitle: t.title }, { frameId: 0 }); })()`);
    await sleep(2000);
    // what is on top in the middle of the page: our element (the page can't see past it)
    const top = await evalIn(site.sid, `(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e && (e.id || e.tagName); })()`);
    const shotT = (await b.send('Target.getTargets')).targetInfos.find((t) => t.url.includes('/shot.html'));
    let mounted = false;
    if (shotT) {
      const ss = await attach(shotT.targetId);
      mounted = await evalIn(ss, `!!document.querySelector('#edStage canvas')`).catch(() => false);
      await b.send('Target.detachFromTarget', { sessionId: ss }).catch(() => {});
    }
    // draw a line across the middle, then Enter saves
    const cx = 700, cy = 450;
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 120, y: cy }, site.sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx - 120, y: cy, button: 'left', clickCount: 1 }, site.sid);
    for (let i = 1; i <= 12; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx - 120 + i * 20, y: cy + i * 5, button: 'left', buttons: 1 }, site.sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 120, y: cy + 60, button: 'left', clickCount: 1 }, site.sid);
    await sleep(300);
    await shot(site.sid, `overlay-${route.slice(1)}.png`).catch(() => {});
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, site.sid);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, site.sid);
    await sleep(1500);
    const saved = await W(`(async () => { const d = (await chrome.storage.local.get('draft')).draft; const s = d.screenshots?.[0]; return s ? { annotated: s.annotated, strokes: s.strokes.length } : null; })()`);
    const gone = await evalIn(site.sid, `!document.getElementById('__brief_shot__')`);
    check(`screenshot over ${name}: on top, drawn on, saved with Enter`,
      top === '__brief_shot__' && mounted && saved?.annotated && saved.strokes === 1 && gone,
      JSON.stringify({ top, mounted, saved, gone }));
    await b.send('Target.closeTarget', { targetId: site.targetId }).catch(() => {});
  }

  // the recording bar: on top of the page's CSS, its transformed body and its
  // highest overlay. (Not under an open modal dialog: the page is inert there,
  // and a bar of ours that was modal would block the page you record.)
  {
    const site = await open(`http://localhost:${WEB}/hostile`); await focus(site); await sleep(800);
    await evalIn(site.sid, `dlg.close()`);
    await W(`(async () => { const [t] = await chrome.tabs.query({ url: 'http://localhost:${WEB}/hostile' });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => {});
      await chrome.tabs.sendMessage(t.id, { type: 'INJECT_BAR', streamId: '', intent: 'brief', mode: 'inbox', itemId: 'x' }, { frameId: 0 }); })()`);
    await sleep(1500);
    const bar = await evalIn(site.sid, `(() => { const h = document.getElementById('__brief_iframe__'); if (!h) return null;
      const x = innerWidth / 2, y = innerHeight - 52 - 30; const e = document.elementFromPoint(x, y); return { top: e && e.id }; })()`);
    check('the bar over page CSS on iframes, a transformed body and a top overlay: on top at the foot of the page', bar?.top === '__brief_iframe__', JSON.stringify(bar));
    await b.send('Target.closeTarget', { targetId: site.targetId }).catch(() => {});
  }

}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
