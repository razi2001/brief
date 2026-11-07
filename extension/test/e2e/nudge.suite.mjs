  // ---- the reminder: the extension's own popup, for a user quiet for a week ----
  const DAY = 86_400_000;

  // Every Brief Cloud call is answered here (nothing leaves the machine) and
  // kept, on every worker that starts, the offscreen document and the popup.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  let replaySites = ['*.brief.localhost'];
  let lastBriefAt = null;
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
    if (url.endsWith('/api/replay-sites')) res = { sites: replaySites, org: null, mode: null, lastBriefAt };
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
  const setNudge = (n) => W(`chrome.storage.local.set({ nudge: ${JSON.stringify(n)} })`);
  const setSites = (s) => { replaySites = s; return W(`chrome.storage.local.set({ replaySites: ${JSON.stringify(s)}, replaySitesSyncedAt: Date.now() })`); };
  // the popup Chrome opens under the toolbar icon is a page target of its own
  const popup = async () => (await b.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url === `chrome-extension://${extId}/popup.html`) || null;
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
  const closePopup = async () => { const t = await popup(); if (t) await b.send('Target.closeTarget', { targetId: t.targetId }); await sleep(600); };
  const reminderLine = () => inPopup(`(async () => { for (let i = 0; i < 20 && document.getElementById('reminderLine').hidden; i++) await new Promise((r) => setTimeout(r, 100)); const el = document.getElementById('reminderLine'); return el.hidden ? null : el.textContent.trim(); })()`);
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
  const old = Date.now() - 8 * DAY;
  await setSites(replaySites);
  await W(`chrome.storage.local.set({ bcTrackerCache: { tracker: 'linear', trackerName: 'Linear' } })`);

  // ---- an unpaired browser: never ----
  await W(`chrome.storage.local.remove('briefCloudToken')`);
  await setNudge({ usedAt: old });
  await open(`http://app.brief.localhost:${WEB}/settings`);
  check('an unpaired browser never gets the reminder', !(await waitPopup(true, 2500)) && !(await storage('nudge')).shownAt);

  // ---- pairing starts the week ----
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test' })`);
  await sleep(600);
  const paired = await storage('nudge');
  check('pairing starts the week', Date.now() - paired.usedAt < 5000, JSON.stringify(paired));

  // ---- paired before this version, quiet for 10 days: the server says so, no week to wait ----
  await W(`chrome.storage.local.remove('nudge')`);
  await W(`chrome.storage.local.set({ replaySitesSyncedAt: 0 })`); // the next page load syncs
  lastBriefAt = new Date(Date.now() - 10 * DAY).toISOString();
  await open(`http://app.brief.localhost:${WEB}/settings`);
  check('an existing user quiet for 10 days gets the popup on the first page load', await waitPopup(true));
  check('it opens with "Seen a bug?" on top', (await reminderLine()) === 'Seen a bug?');
  const seeded = await storage('nudge');
  check('its week counts from the server’s last brief, and it counts as shown', Math.abs(seeded.usedAt - Date.parse(lastBriefAt)) < 1000 && Date.now() - seeded.shownAt < 10_000, JSON.stringify(seeded));
  await closePopup();

  // ---- once a week, and only on a Replay site when there are some ----
  const A2 = await open(`http://app.brief.localhost:${WEB}/settings`);
  check('once a week: the next page load doesn’t open it', !(await waitPopup(true, 2500)));
  await setNudge({ usedAt: old });
  await open(`http://127.0.0.1:${WEB}/`);
  check('not over a page that isn’t a Replay site, when there are some', !(await waitPopup(true, 2500)) && !(await storage('nudge')).shownAt);

  // ---- a brief started from it ----
  const A = await open(`http://app.brief.localhost:${WEB}/`);
  check('due again on a Replay site: it opens', await waitPopup(true));
  check('with the reminder line', (await reminderLine()) === 'Seen a bug?');
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
  check('Create from the reminder files the brief, and its create request says it came from the reminder', sent.via === 'nudge' && sent.meta?.description === 'Export CSV fails with a 500', JSON.stringify({ via: sent.via, description: sent.meta?.description }));
  check('a brief made here starts the week over', Date.now() - (await storage('nudge')).usedAt < 60_000);
  await closePopup();
  const draftNow = await storage('draft');
  check('the next draft doesn’t inherit it', !draftNow?.via, JSON.stringify(draftNow?.via));

  // ---- closed with nothing started, then quiet for a week ----
  await setNudge({ usedAt: old });
  await reload(A);
  check('due again: it opens', await waitPopup(true));
  await reminderLine();
  await closePopup();
  check('closed by clicking away', !(await popup()));
  await reload(A);
  check('closed: not back on the next load', !(await waitPopup(true, 2500)));
  await setNudge({ usedAt: old, shownAt: Date.now() - 6 * DAY });
  await reload(A);
  check('shown 6 days ago: still quiet', !(await waitPopup(true, 2500)));
  await setNudge({ usedAt: old, shownAt: old });
  await reload(A);
  check('a week later it opens again', await waitPopup(true));
  await reminderLine();
  await closePopup();

  // ---- a popup opened by hand never carries the line ----
  const P0 = await open(`chrome-extension://${extId}/popup.html`); await sleep(1200);
  check('opening the popup yourself shows no reminder', await evalIn(P0.sid, `document.getElementById('reminderLine').hidden`));
  await b.send('Target.closeTarget', { targetId: P0.targetId }); await sleep(400);

  // ---- no Replay sites: any page, never get-brief.app ----
  await setSites([]);
  await setNudge({ usedAt: old });
  const S = await openSite();
  const siteUrl = await evalIn(S.sid, 'location.href');
  check('never over get-brief.app', siteUrl === SITE && !(await waitPopup(true, 2500)) && !(await storage('nudge')).shownAt, siteUrl);
  await open(`http://127.0.0.1:${WEB}/settings`);
  check('with no Replay sites, any page gets it', await waitPopup(true));
  await reminderLine();
  await closePopup();

  // ---- the owner's "show it now", with their text ----
  // it just opened (shownAt now): the week alone would keep it quiet
  const PUSH = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
  nudgeCfg = { message: 'Found a <b>glitch</b>?', button: '', push: { id: PUSH, at: new Date().toISOString() } };
  await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  const Q = await open(`http://127.0.0.1:${WEB}/?push`);
  check('a push opens the popup, even inside the quiet week', await waitPopup(true));
  check('with the owner’s text on top, as text (no HTML)', (await reminderLine()) === 'Found a <b>glitch</b>?');
  check('the push is remembered', (await storage('nudge')).pushSeen === PUSH);
  await closePopup();
  await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  await reload(Q);
  check('the same push opens once', !(await waitPopup(true, 2500)));
  check('the text and the push come from /api/nudge', calls.some((c) => c.url === `${APP}/api/nudge`));

  check('no page errors', exceptions.length === 0, exceptions.join(' | '));

  // ---- what reached Brief Cloud about it: three names, nothing about the page ----
  await sleep(1000);
  const logged = calls.filter((c) => c.url === `${APP}/api/extension-events`);
  const bodies = logged.map((c) => JSON.parse(c.body || '{}'));
  check('each opening, brief started and close was logged, in order', JSON.stringify(bodies) === JSON.stringify([
    { name: 'nudge.shown', props: { replay: true } }, // an existing user, first page load
    { name: 'nudge.closed', props: {} },
    { name: 'nudge.shown', props: { replay: true } }, // A
    { name: 'nudge.brief_it', props: {} },
    { name: 'nudge.shown', props: { replay: true } }, // due again
    { name: 'nudge.closed', props: {} },
    { name: 'nudge.shown', props: { replay: true } }, // a week later
    { name: 'nudge.closed', props: {} },
    { name: 'nudge.shown', props: { replay: false } }, // no Replay sites
    { name: 'nudge.closed', props: {} },
    { name: 'nudge.shown', props: { replay: false, push: PUSH } }, // the owner's push
    { name: 'nudge.closed', props: { push: PUSH } },
  ]), JSON.stringify(bodies));
  const raw = logged.map((c) => c.body).join('\n');
  check('no page data in them: no address, host, port or title', !/localhost|127\.0\.0\.1|\d{4}|get-brief\.app|Checkout|Settings|http/i.test(raw), raw);
  check('only name and props, as a POST with the pairing token', logged.every((c) => c.method === 'POST' && c.auth === 'Bearer bxt_test') && bodies.every((b) => Object.keys(b).every((k) => k === 'name' || k === 'props') && Object.keys(b.props || {}).every((k) => k === 'replay' || k === 'push')));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
