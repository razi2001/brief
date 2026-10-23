  // ---- a recording films the window: the bar is on every tab, the log follows the tab in front ----
  // Started the way the popup's Video does (INJECT_BAR, capture 'window');
  // Chrome's picker is answered by --use-fake-ui-for-media-stream, which hands
  // back a window. Nothing is filed: there is no pairing token, so the upload
  // stops before any call leaves the machine.
  const base = `http://app.brief.localhost:${WEB}`;
  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 250) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
  const sess = () => W(`chrome.storage.session.get('recSession').then((r) => r.recSession || null)`);
  const events = () => W(`chrome.storage.session.get('recEvents').then((r) => r.recEvents || [])`);
  const hasBar = (t) => evalIn(t.sid, `!!document.getElementById('__brief_iframe__')`).catch(() => false);
  const tabOf = (url) => W(`chrome.tabs.query({}).then((ts) => { const t = ts.find((x) => x.url === '${url}'); return t ? { id: t.id, windowId: t.windowId } : null; })`);
  // the bars: each is a frame target of its own; the one on screen is the visible one
  const barSids = new Map();
  const bars = async () => {
    const out = [];
    for (const t of (await b.send('Target.getTargets')).targetInfos.filter((x) => x.url.includes(`${extId}/bar.html`))) {
      try {
        if (!barSids.has(t.targetId)) barSids.set(t.targetId, await attach(t.targetId));
        const sid = barSids.get(t.targetId);
        out.push({ sid, ...(await evalIn(sid, `({ visible: document.visibilityState === 'visible', view: document.body.className, timer: document.getElementById('timer').textContent, muted: document.getElementById('muteBtn').classList.contains('active') })`)) });
      } catch {}
    }
    return out;
  };
  const shownBar = async () => {
    const on = (await bars()).filter((x) => x.visible);
    if (on.length !== 1) return { visibleBars: on.length };
    await sleep(1300);
    const again = await evalIn(on[0].sid, `document.getElementById('timer').textContent`).catch(() => on[0].timer);
    return { ...on[0], ticking: again !== on[0].timer, visibleBars: 1 };
  };

  const A = await open(`${base}/`); await sleep(1500);
  const B = await open(`${base}/settings`); await sleep(1500);
  const ta = await tabOf(`${base}/`), tb = await tabOf(`${base}/settings`);
  check('both pages are tabs of one window', !!ta && !!tb && ta.windowId === tb.windowId, JSON.stringify({ ta, tb }));

  await focus(A);
  await W(`(async () => {
    const { emptyDraft, setDraft } = await import('./draft.js');
    await setDraft({ ...emptyDraft(), id: 'd-win' });
    await chrome.storage.session.remove('recEvents');
  })()`);
  await W(`chrome.tabs.sendMessage(${ta.id}, { type: 'INJECT_BAR', streamId: '', intent: 'brief', mode: 'inbox', itemId: 'd-win', capture: 'window' })`);
  const s1 = await until(async () => { const s = await sess(); return s?.capture === 'window' ? s : null; });
  check('a recording starts from the picker, no tab capture', !!s1 && s1.tabId === ta.id && s1.surface === 'window' && s1.windowId === ta.windowId, JSON.stringify(s1));
  const both = await until(async () => (await hasBar(A)) && (await hasBar(B)), 5000);
  check('once it records, every tab of the window has the bar', !!both, '');
  const bar1 = await shownBar();
  check('the bar on screen is recording', bar1.view === 'state-recording' && bar1.ticking, JSON.stringify(bar1));

  // to the second tab: its bar is already there, and the tab is logged
  await focus(B);
  const s2 = await until(async () => { const s = await sess(); return s?.tabId === tb.id ? s : null; });
  const bar2 = await shownBar();
  check('switching tabs: the bar is there at once, running', !!s2 && await hasBar(B) && bar2.view === 'state-recording' && bar2.ticking,
    JSON.stringify({ tabs: s2?.tabs, bar2 }));
  await click(B.sid, '#add'); await sleep(1200);
  let ev = await events();
  check('the second tab is in the log: the switch, then its clicks', ev.some((e) => e.type === 'nav' && e.url === `${base}/settings`) && ev.some((e) => e.type === 'click' && e.url === `${base}/settings`),
    JSON.stringify(ev.map((e) => `${e.type} ${e.url}`)));

  // muted on one tab, muted on all
  const onB = (await bars()).find((x) => x.visible);
  await evalIn(onB.sid, `document.getElementById('muteBtn').click()`); await sleep(800);

  // and back: the first tab still logs, and its bar shows the mute
  await focus(A);
  await until(async () => (await sess())?.tabId === ta.id);
  const bar3 = await shownBar();
  check('back on the first tab, its bar is running and muted like the other', bar3.view === 'state-recording' && bar3.ticking && bar3.muted === true, JSON.stringify(bar3));
  await click(A.sid, '#pay'); await sleep(2500);
  ev = await events();
  check('the first tab still logs its network calls', ev.some((e) => e.type === 'network' && String(e.url).includes('/api/pay')), JSON.stringify(ev.map((e) => `${e.type} ${e.url}`)));

  // a tab visited earlier keeps its bar and its log, even after a reload
  await W(`chrome.tabs.reload(${tb.id})`); await sleep(2500);
  await evalIn(B.sid, `document.getElementById('add').click()`); await sleep(1200);
  ev = await events();
  const lateB = ev.filter((e) => e.type === 'click' && e.url === `${base}/settings`).length;
  check('a visited tab reloaded in the background keeps its bar and is still logged', lateB >= 2 && await hasBar(B), `clicks on the second tab: ${lateB}`);

  // a page that is still loading already has its bar
  const C = await open(`${base}/slow`);
  const early = await until(async () => {
    const r = await evalIn(C.sid, `({ bar: !!document.getElementById('__brief_iframe__'), loaded: !!window.slowDone, state: document.readyState })`).catch(() => null);
    return r?.bar ? r : null;
  }, 3000);
  check('a page gets its bar while it is still loading', !!early && !early.loaded && early.state === 'loading', JSON.stringify(early));

  // closing the tab in front doesn't end the recording: the next one's bar takes over
  await focus(C);
  const tc = await tabOf(`${base}/slow`);
  await until(async () => (await sess())?.tabId === tc.id);
  await b.send('Target.closeTarget', { targetId: C.targetId });
  const s3 = await until(async () => { const s = await sess(); return s && s.tabId !== tc.id ? s : null; });
  const bar4 = await shownBar();
  check('closing the tab in front: the recording goes on, on the next tab', !!s3 && !(s3.tabs || []).includes(tc.id) && bar4.view === 'state-recording' && bar4.ticking,
    JSON.stringify({ s3: s3 && { tabId: s3.tabId, tabs: s3.tabs }, bar4 }));

  // Chrome's "Stop sharing": the recording is saved like a Stop
  const off = (await b.send('Target.getTargets')).targetInfos.find((t) => t.url.includes(`${extId}/offscreen.html`));
  const oS = await attach(off.targetId);
  await evalIn(oS, `document.querySelector('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))`);
  const saved = await until(async () => {
    const d = await W(`chrome.storage.local.get('draft').then((x) => x.draft)`);
    return !(await sess()) && d?.recording ? d : null;
  });
  check('"Stop sharing" saves the recording to the brief', saved?.recording?.source === 'capture', JSON.stringify({ ...saved?.recording, poster: !!saved?.recording?.poster }));
  const gone = await until(async () => !(await hasBar(A)) && !(await hasBar(B)), 5000);
  check('and the bar is gone from every tab', !!gone, '');

  // a second STOP (two bars at the 2-minute cap at once) doesn't upload again
  const again = await W(`chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP', briefId: 'd-win' })`).catch((e) => ({ error: String(e) }));
  check('a second STOP is refused, nothing is uploaded twice', again?.ok === false, JSON.stringify(again));

  // the next recording starts clean: the tabs the last one visited stopped logging
  const startOnA = async () => {
    await W(`chrome.runtime.sendMessage({ type: 'RESET_BEFORE_NEW_RECORDING' })`);
    await W(`(async () => { const { emptyDraft, setDraft } = await import('./draft.js'); await setDraft({ ...emptyDraft(), id: 'd-win2' }); })()`);
    await W(`chrome.tabs.sendMessage(${ta.id}, { type: 'INJECT_BAR', streamId: '', intent: 'brief', mode: 'inbox', itemId: 'd-win2', capture: 'window' })`);
  };
  await focus(A);
  await startOnA();
  await until(async () => (await sess())?.briefId === 'd-win2');
  await evalIn(B.sid, `document.getElementById('add').click()`); await sleep(1200);
  ev = await events();
  check('a tab the last recording visited is not logged into the next one', !ev.some((e) => e.url === `${base}/settings`), JSON.stringify(ev.map((e) => `${e.type} ${e.url}`)));

  // switched during the 3-2-1: the tab in front is the one in charge once it records
  await startOnA();
  await sleep(300); await focus(B);
  const s4 = await until(async () => { const s = await sess(); return s?.briefId === 'd-win2' && s.tabId === tb.id ? s : null; });
  await sleep(1000);
  check('a tab switch during the countdown: that tab is in charge, with its bar', !!s4 && await hasBar(B), JSON.stringify(s4 && { tabId: s4.tabId, tabs: s4.tabs }));
  check('no exceptions', exceptions.length === 0, exceptions.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
