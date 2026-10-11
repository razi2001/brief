  // ---- a background filing survives the worker being shut down ----
  // Answer the worker's calls from here (nothing leaves the machine), on every
  // worker that starts, and record what was sent.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method, body });
    let res = { ok: true, shareId: 's-1' };
    if (url.endsWith('/api/briefs')) {
      const files = JSON.parse(body || '{}').files || [];
      res = { briefId: 'b-1', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    }
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  const watchWorker = (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'service_worker' && m.params.targetInfo.url.includes(extId)) {
      watchWorker(m.params.sessionId).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, m.params.sessionId).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (const t of (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(extId))) await watchWorker(await attach(t.targetId));
  const worker = async () => (await b.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));

  // A draft with a replay whose video is still rendering: filing waits for it.
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    const id = 'd-slow';
    const replay = { v: 2, events: [{ type: 4, timestamp: 1, data: {} }, { type: 2, timestamp: 2, data: {} }], chips: [], durationMs: 3000, frames: [{ file: 'frame-01.jpg', t: 0 }], marks: [] };
    await fsm.putFile(fsm.replayKey(id), new Blob([JSON.stringify(replay)], { type: 'application/json' }));
    const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    await fsm.putFile(fsm.replayFramesKey(id), new Blob([JSON.stringify([px])], { type: 'application/json' }));
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test', draft: { id, createdAt: Date.now(), screenshots: [], description: 'checkout broke', replay: { durationMs: 3000, frames: 1, sites: ['app.brief.localhost'], video: { rev: 42, status: 'rendering' } } } });
  })()`);

  const handed = await W(`chrome.runtime.sendMessage({ type: 'FILE_DRAFT', mode: 'ticket' })`);
  check('the ticket is handed to the worker', handed?.ok === true && handed?.queued === true, JSON.stringify(handed));
  await sleep(1500);

  // Chrome shuts the worker down mid-filing (here: on purpose).
  const before = await worker();
  if (before) await b.send('Target.closeTarget', { targetId: before.targetId }).catch(() => {});
  await sleep(1500);
  // Anything that wakes it starts a fresh worker (its startup pass runs).
  await W(`chrome.runtime.sendMessage({ type: 'GET_BRIEF_META' })`).catch(() => {});
  await sleep(2500);
  const kept = await W(`(async () => { const fsm = await import('./filestore.js'); return { replay: !!(await fsm.getFile(fsm.replayKey('d-slow'))), frames: !!(await fsm.getFile(fsm.replayFramesKey('d-slow'))) }; })()`);
  check('the new worker keeps the files of the ticket being filed', kept.replay && kept.frames, JSON.stringify(kept));

  // The video finishes rendering.
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    await fsm.putFile(fsm.replayVideoKey('d-slow'), new Blob([new Uint8Array(4096)], { type: 'video/webm' }));
    await fsm.putFile(fsm.replayVideoStateKey('d-slow'), new Blob([JSON.stringify({ rev: 42, status: 'ready' })], { type: 'application/json' }));
  })()`);

  let st = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    st = await W(`chrome.storage.local.get('filingDrafts').then((r) => Object.keys(r.filingDrafts || {}).length)`).catch(() => st);
    if (st === 0 && calls.some((c) => c.url.endsWith('/process'))) break;
  }
  const create = calls.find((c) => c.url.endsWith('/api/briefs'));
  const files = create ? JSON.parse(create.body).files : [];
  check('the filing resumes and the ticket is filed', st === 0 && calls.some((c) => /\/api\/briefs\/b-1\/process$/.test(c.url)), JSON.stringify(calls.map((c) => c.method + ' ' + c.url)));
  check('with its replay, its video and its stills', files.includes('replay.json') && files.includes('replay.webm') && files.some((f) => f.startsWith('replay-frames/')), JSON.stringify(files));
  check('filed once, not twice', calls.filter((c) => c.url.endsWith('/api/briefs')).length === 1, String(calls.filter((c) => c.url.endsWith('/api/briefs')).length));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
