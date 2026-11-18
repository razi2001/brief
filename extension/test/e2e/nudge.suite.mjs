  // ---- the reminder: a small popup under the toolbar icon, only when the owner sends it ----
  const DAY = 86_400_000;

  // Every Brief call is answered here (nothing leaves the machine) and
  // kept, on every worker that starts, the offscreen document and the popup.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  let replaySites = ['*.brief.localhost'];
  let nudgeCfg = { message: '', button: '', push: null };
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method, body, auth: p.request.headers.Authorization || p.request.headers.authorization || '' });
    let res = { ok: true, shareId: 's-nudge' };
    if (url.endsWith('/api/briefs')) {
      const files = JSON.parse(body || '{}').files || [];
      res = { briefId: 'b-nudge', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    }
    if (url.endsWith('/api/replay-sites')) res = { sites: replaySites, org: null, mode: null };
    if (url.endsWith('/api/nudge')) res = nudgeCfg;
    if (url.endsWith('/api/me')) res = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  // get-brief.app is https-only: its pages are answered at the browser too
  const SITE = 'https://get-brief.app/';
  const siteSessions = new Set();
  const answerSite = (sid, p) => b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html' }], body: Buffer.from(page('Brief', '<h2>Brief</h2><p>get-brief.app</p>')).toString('base64') }, sid).catch(() => {});
  const watchWorker = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') (siteSessions.has(m.sessionId) ? answerSite : answer)(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      const t = m.params.targetInfo;
      const ours = t.url.includes(extId) || t.type === 'other';
      (ours ? watchWorker(sid) : Promise.resolve()).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (const t of (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(extId))) {
    await watchWorker(await attach(t.targetId));
  }

  const storage = (key) => W(`chrome.storage.local.get(${JSON.stringify(key)}).then((r) => r[${JSON.stringify(key)}] ?? null)`);
  const setSites = (s) => { replaySites = s; return W(`chrome.storage.local.set({ replaySites: ${JSON.stringify(s)}, replaySitesSyncedAt: Date.now() })`); };
  // the popup Chrome opens under the toolbar icon is a page target of its own:
  // the small reminder, or Brief's popup once Brief it turned it into that
  const popup = async () => (await b.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-z]+\/(reminder|popup)\.html$/.test(t.url) && t.url.includes(extId)) || null;
  const popupUrl = async () => (await popup())?.url || '';
  const waitPopup = async (want, ms = 4000) => {
    for (let t = 0; t < ms; t += 250) { if (!!(await popup()) === want) return true; await sleep(250); }
    return false;
  };
  const inPopup = async (expr) => {
    const t = await popup();
    const sid = await attach(t.targetId);
    await b.send('Runtime.enable', {}, sid);
    return evalIn(sid, expr);
  };
  const closePopup = async () => { const t = await popup(); if (t) await b.send('Target.closeTarget', { targetId: t.targetId }); await sleep(1800); }; // the worker waits 1.5 s before it calls it closed
  // the small reminder's text, once its storage read has landed
  const reminderLine = () => inPopup(`(async () => { await new Promise((r) => setTimeout(r, 400)); return location.pathname === '/reminder.html' ? document.getElementById('text').textContent.trim() : null; })()`);
  const reload = async (P) => { await b.send('Page.reload', {}, P.sid); await sleep(2000); };
  const openSite = async () => {
    const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
    const sid = await attach(targetId); await b.send('Runtime.enable', {}, sid); await b.send('Page.enable', {}, sid);
    siteSessions.add(sid);
    await b.send('Fetch.enable', { patterns: [{ urlPattern: SITE + '*' }] }, sid);
    await b.send('Page.navigate', { url: SITE }, sid);
    await sleep(2000);
    return { targetId, sid };
  };
  const P1 = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a61';
  const P2 = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a62';
  const P3 = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a63';
  // the owner sends one: the next pull (every 2 minutes, forced here) brings it
  const send = async (id, message = '') => {
    nudgeCfg = { message, button: '', push: id ? { id, at: new Date().toISOString() } : null };
    await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  };
  await setSites(replaySites);
  await W(`chrome.storage.local.set({ bcTrackerCache: { tracker: 'linear', trackerName: 'Linear' } })`);

  // ---- an unpaired browser: never ----
  await W(`chrome.storage.local.remove('briefCloudToken')`);
  await send(P1, 'Found a <b>glitch</b>?');
  await open(`http://127.0.0.1:${WEB}/settings`);
  check('an unpaired browser never gets it', !(await waitPopup(true, 2500)));

  // ---- paired: nothing opens on its own ----
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test' })`);
  await send(null);
  await W(`chrome.storage.local.set({ nudge: { usedAt: ${Date.now() - 60 * DAY} } })`);
  await open(`http://app.brief.localhost:${WEB}/settings`);
  check('no push, no reminder, however long the user has been quiet', !(await waitPopup(true, 2500)));

  // ---- the owner's push: the small reminder, once, on any page ----
  await send(P1, 'Found a <b>glitch</b>?');
  const Q = await open(`http://127.0.0.1:${WEB}/?push`); // not one of the Replay sites
  check('a push opens the small reminder, off the Replay sites too', await waitPopup(true) && (await popupUrl()).endsWith('/reminder.html'));
  check('with the owner’s text, as text (no HTML)', (await reminderLine()) === 'Found a <b>glitch</b>?');
  check('the icon goes back to Brief’s own popup at once', (await W(`chrome.action.getPopup({})`)).endsWith('/popup.html'));
  check('the push is remembered', (await storage('nudge')).pushSeen === P1);
  await closePopup();
  await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  await reload(Q);
  check('the same push opens once', !(await waitPopup(true, 2500)));
  check('the text and the push come from /api/nudge', calls.some((c) => c.url === `${APP}/api/nudge`));

  // ---- Brief it: the same popup becomes Brief's, and its brief says so ----
  await send(P2);
  await open(`http://app.brief.localhost:${WEB}/`);
  check('the next push opens it again, with "Seen a bug?" when no text is set', await waitPopup(true) && (await reminderLine()) === 'Seen a bug?');
  await inPopup(`document.getElementById('go').click()`);
  for (let i = 0; i < 20 && !(await popupUrl()).endsWith('/popup.html'); i++) await sleep(150);
  check('Brief it turns it into Brief’s own popup, in place', (await popupUrl()).endsWith('/popup.html'));
  await sleep(800);
  await inPopup(`(async () => {
    const f = document.getElementById('descField');
    f.value = 'Export CSV fails with a 500';
    f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('blur'));
    await new Promise((r) => setTimeout(r, 500));
    document.getElementById('createBtn').click();
    return true;
  })()`);
  for (let i = 0; i < 40 && !calls.some((c) => c.url.endsWith('/api/briefs')); i++) await sleep(500);
  const create = calls.find((c) => c.url.endsWith('/api/briefs'));
  const sent = create ? JSON.parse(create.body) : {};
  check('Create from it files the brief, and its create request says it came from the reminder', sent.via === 'nudge' && sent.meta?.description === 'Export CSV fails with a 500', JSON.stringify({ via: sent.via, description: sent.meta?.description }));
  await closePopup();
  const draftNow = await storage('draft');
  check('the next draft doesn’t inherit it', !draftNow?.via, JSON.stringify(draftNow?.via));

  // ---- a popup opened by hand is Brief's own ----
  const P0 = await open(`chrome-extension://${extId}/popup.html`); await sleep(1200);
  check('opening the popup yourself is Brief’s own popup', (await evalIn(P0.sid, 'location.pathname')) === '/popup.html');
  await b.send('Target.closeTarget', { targetId: P0.targetId }); await sleep(400);

  // ---- never over Brief itself ----
  await send(P3);
  const S = await openSite();
  const siteUrl = await evalIn(S.sid, 'location.href');
  check('never over get-brief.app', siteUrl === SITE && !(await waitPopup(true, 2500)) && (await storage('nudge')).pushSeen === P2, siteUrl);
  await open(`http://127.0.0.1:${WEB}/settings`);
  check('the next page that can carry it gets it', await waitPopup(true));
  await reminderLine();
  await closePopup();
  check('no page errors', exceptions.length === 0, exceptions.join(' | '));

  // ---- what reached Brief about it: three names, the push, nothing about the page ----
  await sleep(1000);
  const logged = calls.filter((c) => c.url === `${APP}/api/extension-events`);
  const bodies = logged.map((c) => JSON.parse(c.body || '{}'));
  check('each opening, Brief it and close was logged, in order, with its push', JSON.stringify(bodies) === JSON.stringify([
    { name: 'nudge.shown', props: { replay: false, push: P1 } },
    { name: 'nudge.closed', props: { push: P1 } },
    { name: 'nudge.shown', props: { replay: true, push: P2 } },
    { name: 'nudge.brief_it', props: { push: P2 } },
    { name: 'nudge.shown', props: { replay: false, push: P3 } },
    { name: 'nudge.closed', props: { push: P3 } },
  ]), JSON.stringify(bodies));
  const raw = logged.map((c) => c.body).join('\n');
  check('no page data in them: no address, host, port or title', !/localhost|127\.0\.0\.1|get-brief\.app|Checkout|Settings|http/i.test(raw), raw);
  check('only name and props, as a POST with the pairing token', logged.every((c) => c.method === 'POST' && c.auth === 'Bearer bxt_test') && bodies.every((b) => Object.keys(b).every((k) => k === 'name' || k === 'props') && Object.keys(b.props || {}).every((k) => k === 'replay' || k === 'push')));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
