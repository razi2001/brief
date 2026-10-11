  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  // ---- one-click report: the last minute's replay becomes a draft, no typing ----
  const B = await open(`http://app.brief.localhost:${WEB}/`); await sleep(2500); await focus(B);
  const pageTab = await W(`chrome.tabs.query({ url: 'http://app.brief.localhost:${WEB}/*' }).then(t => t[0].id)`);
  await click(B.sid, '#add'); await sleep(600);
  await click(B.sid, '#pay'); await sleep(2500); // a 500, a console error, "Payment failed" on the page


  // The worker files it. Answer its calls from here so nothing leaves the
  // machine: intercept them at the browser, on every worker that starts (it
  // spins down and back up), and record what was sent.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method, body });
    if (/frame-\d\d\.jpg/.test(decodeURIComponent(url)) && p.request.postDataEntries) fs.writeFileSync(`${SCRATCH}/auto-${decodeURIComponent(url).split('/').pop()}`, Buffer.concat(p.request.postDataEntries.map((e) => Buffer.from(e.bytes || '', 'base64'))));
    let res = { ok: true, shareId: 's-auto' };
    if (url.endsWith('/api/briefs')) {
      const files = JSON.parse(body || '{}').files || [];
      res = { briefId: 'b-auto', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    }
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  const watchWorker = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    // Every new target waits for us (waitForDebuggerOnStart): the extension's
    // (worker, offscreen renderer, pages) get their Brief calls answered here,
    // then everything is let go - a target left waiting never runs.
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      const ours = m.params.targetInfo.url.includes(extId);
      (ours ? watchWorker(sid) : Promise.resolve()).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (const t of (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(extId))) {
    await watchWorker(await attach(t.targetId));
  }
  const storage = (keys) => W(`chrome.storage.local.get(${JSON.stringify(keys)})`);

  // Something in progress, which must come back untouched.
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test', draft: { id: 'd-keep', createdAt: Date.now(), screenshots: [], description: 'my half-written note' } })`);

  // The shortcut / right-click, as a message (keys can't be pressed here).
  const tabsBefore = (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').length;
  await W(`chrome.runtime.sendMessage({ type: 'REPORT_NOW', tabId: ${pageTab} })`);
  await sleep(800);
  const onPage = await evalIn(B.sid, `!!document.getElementById('brief-mark-host') || !!document.getElementById('brief-toast-host')`);
  check('nothing is put on the page (the toolbar icon turns instead)', onPage === false);

  // Built, rendered and filed in the background; the popup's draft never moves.
  let state = null;
  let opened = 0;

  for (let i = 0; i < 150; i++) {
    await sleep(1000);
    opened = Math.max(opened, (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').length - tabsBefore);
    const st = await storage(['autoReports', 'filingDrafts', 'draft']).catch(() => null);
    if (!st) continue;
    state = { pending: Object.keys(st.autoReports || {}).length, filing: Object.keys(st.filingDrafts || {}).length, draftId: st.draft && st.draft.id, note: st.draft && st.draft.description };
    if (!state.pending && state.filing === 0 && calls.some((c) => c.url.endsWith('/draft'))) break;
  }

  check('nothing opens: no tab, no editor, no popup', opened === 0, `new pages: ${opened}`);
  const badge = await W(`chrome.action.getBadgeText({})`);
  check('the toolbar icon shows a ✓ when the draft is queued', badge === '✓', JSON.stringify(badge));
  const log1 = await W(`chrome.storage.local.get('autoReportLog').then((r) => (r.autoReportLog || [])[0])`);
  check('the report is logged as done', log1?.ok === true, JSON.stringify(log1));
  const urls = calls.map((c) => c.method + ' ' + c.url);
  check('a draft is made with no typing (uploaded, then written as a draft)', urls.some((c) => c.endsWith('/api/briefs')) && urls.some((c) => /\/api\/briefs\/b-auto\/draft$/.test(c)), JSON.stringify(urls));
  check('the draft in progress is never touched', state?.draftId === 'd-keep' && state?.note === 'my half-written note', JSON.stringify(state));

  const create = calls.find((c) => c.url.endsWith('/api/briefs'));
  const replayUp = calls.find((c) => c.url.startsWith('https://up.test/') && c.url.includes('replay.json'));
  const draftCall = calls.find((c) => c.url.endsWith('/draft'));
  let r = null; try { r = replayUp ? JSON.parse(replayUp.body) : null; } catch {}
  const sent = {
    files: create ? JSON.parse(create.body).files : null,
    marks: r ? r.marks : null,
    frames: r ? r.frames.map((f) => f.note) : null,
    overrides: draftCall ? JSON.parse(draftCall.body || '{}') : null,
  };
  const auto = (sent.marks || []).filter((m) => m.auto);
  check('Brief noticed the failed payment call on its own', auto.some((m) => /POST \/api\/pay\S* failed \(500/.test(m.note)), JSON.stringify(sent.marks));
  check('a still is taken at what it noticed', (sent.frames || []).some((n) => /^Brief noticed: /.test(n || '')), JSON.stringify(sent.frames));
  check('the replay, its stills and the video go up with it', (sent.files || []).includes('replay.json') && (sent.files || []).some((f) => /^replay-frames\//.test(f)), JSON.stringify(sent.files));
  check('the server is told it was one-click', sent.overrides?.autoReport === true && !sent.overrides?.description, JSON.stringify(sent.overrides));


  // ---- a page that isn't recorded: nothing is made, and the popup says why ----
  const U = await open(`http://127.0.0.1:${WEB}/`); await sleep(1500);
  const uTab = await W(`chrome.tabs.query({ url: 'http://127.0.0.1:${WEB}/*' }).then(t => t[0].id)`);
  await W(`chrome.runtime.sendMessage({ type: 'REPORT_NOW', tabId: ${uTab} })`);
  await sleep(1200);
  const log2 = await W(`chrome.storage.local.get('autoReportLog').then((r) => (r.autoReportLog || [])[0])`);
  const badge2 = await W(`chrome.action.getBadgeText({})`);
  check('an unrecorded page: logged with the reason, ! on the icon', log2?.ok === false && /isn’t recorded/.test(log2.error) && badge2 === '!', JSON.stringify({ log2, badge2 }));
  const P = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const said = await evalIn(P.sid, `document.querySelector('#errBar')?.textContent || ''`);
  check('opening the extension says why the report didn’t go through', /Brief it didn’t work: .*isn’t recorded/.test(said), said);
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
