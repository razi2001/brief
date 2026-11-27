  // ---- Stop: a ticket on its way comes back into the popup, unfiled ----
  // Brief's calls are answered here (nothing leaves the machine); `serverState`
  // is what GET /stop says about the ticket the server is filing.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  let serverState = 'filing';
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method, body });
    let res = { queued: true, shareId: 's-1' };
    if (url.endsWith('/api/briefs') || url.endsWith('/files')) {
      const files = JSON.parse(body || '{}').files || [];
      res = { briefId: 'b-1', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    }
    if (url.endsWith('/stop')) res = p.request.method === 'GET' ? { state: serverState } : { stopped: true, back: 'uploaded' };
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  const watchWorker = (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      const ours = m.params.targetInfo.url.includes(extId);
      (ours ? watchWorker(sid) : Promise.resolve()).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (const t of (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(extId))) await watchWorker(await attach(t.targetId));

  const id = 'd-stop';
  const state = () => W(`(async () => {
    const fsm = await import('./filestore.js');
    const r = await chrome.storage.local.get(['draft', 'filingDrafts', 'sentDrafts']);
    return {
      draft: r.draft?.id || null, filing: !!r.draft?.filing, desc: r.draft?.description || '',
      sending: Object.keys(r.filingDrafts || {}), sent: Object.keys(r.sentDrafts || {}),
      replay: !!(await fsm.getFile(fsm.replayKey('${id}'))),
    };
  })()`);
  const inFlight = () => W(`chrome.runtime.sendMessage({ type: 'IN_FLIGHT' })`).then((r) => r?.items || []);
  const until = async (fn, tries = 30) => { let v; for (let i = 0; i < tries; i++) { v = await fn(); if (v) return v; await sleep(500); } return v; };

  // A draft whose replay video is still rendering: the worker waits for it.
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    const replay = { v: 2, events: [{ type: 4, timestamp: 1, data: {} }, { type: 2, timestamp: 2, data: {} }], chips: [], durationMs: 3000, frames: [], marks: [] };
    await fsm.putFile(fsm.replayKey('${id}'), new Blob([JSON.stringify(replay)], { type: 'application/json' }));
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test', draft: { id: '${id}', name: 'Cart total wrong', createdAt: Date.now(), screenshots: [], description: 'cart total is wrong', replay: { durationMs: 3000, sites: ['app.brief.localhost'], video: { rev: 9, status: 'rendering' } } } });
  })()`);

  // 1. Stopped while the worker still has it.
  await W(`chrome.runtime.sendMessage({ type: 'FILE_DRAFT', mode: 'ticket' })`);
  const sending = await until(async () => (await inFlight()).find((it) => it.id === id && it.stage === 'sending'));
  check('a ticket being sent is listed with its title', sending?.title === 'Cart total wrong', JSON.stringify(sending));
  const stop1 = await W(`chrome.runtime.sendMessage({ type: 'STOP_FILING', id: '${id}' })`);
  check('Stop is taken while it is still sending', stop1?.ok === true, JSON.stringify(stop1));
  let s = await until(async () => { const x = await state(); return x.draft === id ? x : null; });
  check('it comes back into the popup, as it was', s?.draft === id && !s.filing && s.desc === 'cart total is wrong' && s.sending.length === 0, JSON.stringify(s));
  check('its files are kept', s?.replay === true, JSON.stringify(s));
  check('nothing reached the tracker', !calls.some((c) => c.url.endsWith('/process')), JSON.stringify(calls.map((c) => c.method + ' ' + c.url)));
  check('nothing is listed on its way any more', (await inFlight()).length === 0);

  // The video is rendered: Create again, and the server takes it.
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    await fsm.putFile(fsm.replayVideoKey('${id}'), new Blob([new Uint8Array(2048)], { type: 'video/webm' }));
    await fsm.putFile(fsm.replayVideoStateKey('${id}'), new Blob([JSON.stringify({ rev: 9, status: 'ready' })], { type: 'application/json' }));
  })()`);
  const send = async () => {
    calls.length = 0;
    serverState = 'filing';
    await W(`chrome.runtime.sendMessage({ type: 'FILE_DRAFT', mode: 'ticket' })`);
    return until(async () => { const x = await state(); return x.sent.includes(id) ? x : null; });
  };

  // 2. Stopped from the popup while the server files it.
  s = await send();
  check('a ticket the server is filing is kept, with its files', s?.sent.includes(id) && s.replay, JSON.stringify(s));
  const filing = (await inFlight()).find((it) => it.id === id);
  check('and listed as filing', filing?.stage === 'filing', JSON.stringify(filing));
  const stop2 = await W(`chrome.runtime.sendMessage({ type: 'STOP_FILING', id: '${id}' })`);
  check('Stop asks the server to stop it', stop2?.ok === true && calls.some((c) => c.method === 'POST' && /\/api\/briefs\/b-1\/stop$/.test(c.url)), JSON.stringify(stop2));
  s = await state();
  check('and it comes back into the popup', s.draft === id && s.sent.length === 0 && s.replay, JSON.stringify(s));

  // 3. Stopped on its brief page: back into the popup the next time it looks.
  s = await send();
  serverState = 'stopped';
  await inFlight();
  s = await state();
  check('a ticket stopped on the web comes back into the popup', s.draft === id && s.sent.length === 0 && s.replay, JSON.stringify(s));

  // 4. Filed: the copy and its files go.
  s = await send();
  serverState = 'done';
  const left = await inFlight();
  s = await state();
  check('once filed, the kept copy and its files go', left.length === 0 && s.sent.length === 0 && !s.replay && s.draft !== id, JSON.stringify(s));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
