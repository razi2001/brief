  // ---- record one ticket-eval case: a page with a planted bug, then a one-click report ----
  // (the rest of _harness.mjs's main(); record-cases.mjs joins the two, like run.mjs)
  const zlib = await import('node:zlib');
  const { CASES } = await import(process.env.CASES_URL);
  const name = process.env.CASE;
  const C = CASES[name];
  if (!C) throw new Error(`no case "${name}"`);
  const CPORT = 3997;
  http.createServer((req, res) => {
    const api = C.api?.[`${req.method} ${req.url.split('?')[0]}`];
    if (api) return api(req, res);
    if (req.url.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(C.html);
  }).listen(CPORT);

  // Answer Brief Cloud here (nothing leaves the machine) and keep what was sent.
  const uploads = new Map();
  let overrides = null;
  const APP = 'https://cloud.get-brief.app';
  const bodyOf = async (sid, p) => {
    if (p.request.postDataEntries?.length) return Buffer.concat(p.request.postDataEntries.map((e) => Buffer.from(e.bytes || '', 'base64')));
    if (p.request.postData) return Buffer.from(p.request.postData, 'utf8');
    if (!p.request.hasPostData) return Buffer.alloc(0);
    const r = await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => null);
    return r ? Buffer.from(r.postData, r.base64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0);
  };
  const answer = async (sid, p) => {
    const url = p.request.url;
    const body = await bodyOf(sid, p);
    let res = { ok: true, shareId: 's-case' };
    if (url.startsWith('https://up.test/')) uploads.set(decodeURIComponent(url.slice('https://up.test/'.length)), body);
    else if (url.endsWith('/api/briefs') || /\/api\/briefs\/b-case\/files$/.test(url)) {
      const files = JSON.parse(body.toString('utf8') || '{}').files || [];
      res = { briefId: 'b-case', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    } else if (/\/api\/briefs\/b-case\/draft$/.test(url)) overrides = JSON.parse(body.toString('utf8') || '{}');
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  const watchWorker = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    // Every new target waits for us: the extension's get their Brief calls
    // answered here, then everything is let go.
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
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test' })`);

  // What a user does on the page.
  const P = await open(`http://cases.brief.localhost:${CPORT}/${name}`); await sleep(2500); await focus(P);
  const tabId = await W(`chrome.tabs.query({ url: 'http://cases.brief.localhost:${CPORT}/*' }).then(t => t[0].id)`);
  for (const s of C.flow) {
    if (s.wait) await sleep(s.wait);
    if (s.click) await click(P.sid, s.click);
    if (s.type) {
      await evalIn(P.sid, `(()=>{const el=document.querySelector(${JSON.stringify(s.type[0])});el.focus();const n=el.value.length;el.setSelectionRange(n,n);})()`);
      await b.send('Input.insertText', { text: s.type[1] }, P.sid); await sleep(300);
    }
    if (s.reload) { await b.send('Page.reload', {}, P.sid); await sleep(2500); }
  }
  // what the page shows when the report is made (to check a flow did what it should)
  console.log('page now:', String(await evalIn(P.sid, `document.querySelector('main')?.innerText || ''`)).replace(/\s+/g, ' ').slice(0, 200));

  if (process.env.DEBUG_STORE) {
    // the replay buffer as stored right before the report: one row per chunk
    const rows = await W(`new Promise((res) => { const r = indexedDB.open('brief-replay', 1); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => res(q.result.map((m) => ({ tab: m.tabId, full: m.full, t0: m.t0 % 100000, t1: m.t1 % 100000 }))); }; })`);
    console.log('store before the report (ms mod 100000), now', Date.now() % 100000, JSON.stringify(rows));
  }
  // The one-click report (the shortcut, as a message).
  await W(`chrome.runtime.sendMessage({ type: 'REPORT_NOW', tabId: ${tabId} })`);
  for (let i = 0; i < 150 && !overrides; i++) await sleep(1000);
  check('the report reached the draft call', !!overrides);
  const names = [...uploads.keys()];
  check('brief.json, replay.json and the stills were uploaded', uploads.has('brief.json') && uploads.has('replay.json') && names.some((f) => f.startsWith('replay-frames/')), JSON.stringify(names));

  // The case folder, as the eval reads it (the videos are left out: the writer never reads them).
  const outDir = path.join(process.env.CASES_OUT, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [file, bytes] of uploads) {
    if (/\.webm$/.test(file)) continue;
    const dest = path.join(outDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.json$/.test(file) && bytes.length > 256 * 1024) fs.writeFileSync(dest + '.gz', zlib.gzipSync(bytes));
    else fs.writeFileSync(dest, bytes);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'overrides.json'), JSON.stringify(overrides ?? {}, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'expect.json'), JSON.stringify(C.expect, null, 2) + '\n');
  console.log(`wrote ${outDir}`);
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
