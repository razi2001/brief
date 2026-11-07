  const shot = async (sid, name, clip) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) }, sid)).data, 'base64'));
  // ---- "Seen a bug?": the card for a browser that made nothing for a week ----
  const DAY = 86_400_000;

  // Every Brief Cloud call is answered here (nothing leaves the machine) and
  // kept, on every worker that starts and the offscreen document.
  const calls = [];
  const APP = 'https://cloud.get-brief.app';
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method, body });
    let res = { ok: true, shareId: 's-nudge' };
    if (url.endsWith('/api/briefs')) {
      const files = JSON.parse(body || '{}').files || [];
      res = { briefId: 'b-nudge', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    }
    if (url.endsWith('/api/replay-sites')) res = { sites: replaySites };
    if (url.endsWith('/api/nudge')) res = nudgeCfg;
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  // get-brief.app is https-only: its pages are answered at the browser too
  const SITE = 'https://get-brief.app/';
  const siteSessions = new Set();
  const answerSite = (sid, p) => b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html' }], body: Buffer.from(page('Brief', '<h2>Brief</h2><p>get-brief.app</p>')).toString('base64') }, sid).catch(() => {});
  let replaySites = ['*.brief.localhost'];
  let nudgeCfg = { message: '', button: '', push: null };
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
  const cardOn = (sid) => evalIn(sid, `!!document.getElementById('__brief_nudge__')`);
  const waitCard = async (sid, want, ms = 4000) => {
    for (let t = 0; t < ms; t += 250) { if ((await cardOn(sid)) === want) return true; await sleep(250); }
    return false;
  };
  // The card is in a closed shadow root: reach it the way DevTools does.
  const cardNodes = async (sid) => {
    const { root } = await b.send('DOM.getDocument', { depth: -1, pierce: true }, sid);
    const out = { text: '' };
    const walk = (n, inCard) => {
      const i = (n.attributes || []).indexOf('class');
      const cls = i >= 0 ? n.attributes[i + 1].split(' ') : [];
      for (const c of ['card', 'go', 'x']) if (cls.includes(c)) out[c] = n;
      const inside = inCard || cls.includes('card');
      if (inside && n.nodeType === 3) out.text += ` ${n.nodeValue}`;
      for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c, inside);
    };
    walk(root, false);
    out.text = out.text.replace(/\s+/g, ' ').trim();
    return out;
  };
  const clickCard = async (sid, cls) => {
    const node = (await cardNodes(sid))[cls];
    const q = (await b.send('DOM.getBoxModel', { nodeId: node.nodeId }, sid)).model.border;
    const x = (q[0] + q[2]) / 2, y = (q[1] + q[5]) / 2;
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
    await sleep(400);
  };
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

  // ---- an unpaired browser: never ----
  await W(`chrome.storage.local.remove('briefCloudToken')`);
  await setNudge({ usedAt: old });
  const U = await open(`http://app.brief.localhost:${WEB}/settings`);
  check('an unpaired browser never gets the card', !(await waitCard(U.sid, true, 2500)) && !(await storage('nudge')).shownAt);

  // ---- paired, nothing made for 8 days ----
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test' })`);
  await sleep(600);
  const paired = await storage('nudge');
  check('pairing starts the week', Date.now() - paired.usedAt < 5000, JSON.stringify(paired));
  await setNudge({ usedAt: old });

  const N = await open(`http://127.0.0.1:${WEB}/`);
  check('not on a page that isn’t a Replay site, when there are some', !(await waitCard(N.sid, true, 2500)) && !(await storage('nudge')).shownAt);

  const A = await open(`http://app.brief.localhost:${WEB}/`);
  check('on a Replay site, the card shows', await waitCard(A.sid, true));
  const card = await cardNodes(A.sid);
  check('it says "Seen a bug?" with Brief it and a close button, nothing else', card.text === 'Seen a bug? Brief it' && !!card.go && !!card.x, JSON.stringify(card.text));
  const shownAt = (await storage('nudge')).shownAt;
  check('it counts as shown', Date.now() - shownAt < 10_000);
  await sleep(500); // the slide-in
  await shot(A.sid, 'nudge-card.png');
  const box = (await b.send('DOM.getBoxModel', { nodeId: card.card.nodeId }, A.sid)).model.border;
  await shot(A.sid, 'nudge-card-zoom.png', { x: box[0] - 40, y: box[1] - 30, width: box[2] - box[0] + 80, height: box[5] - box[1] + 60, scale: 2 });

  const A2 = await open(`http://app.brief.localhost:${WEB}/settings`);
  check('once a week: the next page doesn’t get one', !(await waitCard(A2.sid, true, 2500)));

  // ---- Brief it: the last minute, as a one-click report ----
  await focus(A);
  await click(A.sid, '#add'); await sleep(600);
  await click(A.sid, '#pay'); await sleep(2500);
  await clickCard(A.sid, 'go');
  check('Brief it: the card goes away', await waitCard(A.sid, false));
  let create = null;
  for (let i = 0; i < 120 && !calls.some((c) => c.url.endsWith('/draft')); i++) await sleep(1000);
  create = calls.find((c) => c.url.endsWith('/api/briefs'));
  const sent = create ? JSON.parse(create.body) : {};
  check('Brief it files the last minute as a one-click report', calls.some((c) => /\/api\/briefs\/b-nudge\/draft$/.test(c.url)) && (sent.files || []).includes('replay.json'), JSON.stringify(calls.map((c) => c.method + ' ' + c.url)));
  check('the create request says the card started it', sent.via === 'nudge', JSON.stringify({ via: sent.via }));
  const log = await W(`chrome.storage.local.get('autoReportLog').then((r) => (r.autoReportLog || [])[0])`);
  check('the report is logged as done', log?.ok === true, JSON.stringify(log));
  check('a brief made here starts the week over', Date.now() - (await storage('nudge')).usedAt < 3 * 60_000);

  // ---- ×: gone, and quiet for a week ----
  await setNudge({ usedAt: old });
  await reload(A);
  check('due again: the card shows', await waitCard(A.sid, true));
  await clickCard(A.sid, 'x');
  check('×: the card goes away', await waitCard(A.sid, false));
  const closed = await storage('nudge');
  check('×: the week starts now', Date.now() - closed.shownAt < 10_000, JSON.stringify(closed));
  await reload(A);
  check('closed: not back on the next load', !(await waitCard(A.sid, true, 2500)));
  await setNudge({ usedAt: old, shownAt: Date.now() - 6 * DAY });
  await reload(A);
  check('closed 6 days ago: still quiet', !(await waitCard(A.sid, true, 2500)));
  await setNudge({ usedAt: old, shownAt: old });
  await reload(A);
  check('a week later it shows again', await waitCard(A.sid, true));
  await clickCard(A.sid, 'x');

  // ---- no Replay sites: any page, never get-brief.app ----
  await setSites([]);
  await setNudge({ usedAt: old });
  const S = await openSite();
  const siteUrl = await evalIn(S.sid, 'location.href');
  check('never on get-brief.app', siteUrl === SITE && !(await waitCard(S.sid, true, 2500)) && !(await storage('nudge')).shownAt, siteUrl);
  const P = await open(`http://127.0.0.1:${WEB}/settings`);
  check('with no Replay sites, any page gets it', await waitCard(P.sid, true));
  await focus(P);
  await clickCard(P.sid, 'go');
  let annotator = false;
  for (let i = 0; i < 20 && !annotator; i++) { await sleep(300); annotator = await evalIn(P.sid, `!!document.getElementById('__brief_shot__')`); }
  check('there, Brief it takes a screenshot to mark up (no last minute to send)', annotator && !(await cardOn(P.sid)));
  const marked = await W(`chrome.storage.session.get('nudgeShot').then((r) => r.nudgeShot || null)`);
  const draft = await storage('draft');
  check('the screenshot is for the current draft, marked as from the card', marked?.itemId === draft?.id, JSON.stringify({ marked, draft: draft?.id }));

  // ---- the owner's "show it now", with their text ----
  // P just showed the card (shownAt now): the week alone would keep it quiet.
  await focus(P);
  await evalIn(P.sid, `document.getElementById('__brief_shot__')?.remove()`);
  await W(`chrome.storage.session.remove('nudgeShot')`);
  nudgeCfg = { message: 'Found a <b>glitch</b>?', button: 'Report it', push: { id: 'push-1', at: new Date().toISOString() } };
  await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  await reload(P);
  check('a push shows the card, even inside the quiet week', await waitCard(P.sid, true));
  const pushed = await cardNodes(P.sid);
  check('with the owner’s text and button, as text (no HTML)', pushed.text === 'Found a <b>glitch</b>? Report it', JSON.stringify(pushed.text));
  check('the text and the push come from /api/nudge', calls.some((c) => c.url === APP + '/api/nudge'));
  check('the push is remembered', (await storage('nudge')).pushSeen === 'push-1');
  await clickCard(P.sid, 'x');
  await W(`chrome.storage.local.set({ nudgeCfgSyncedAt: 0 })`);
  await reload(P);
  check('the same push shows once', !(await waitCard(P.sid, true, 2500)));

  check('no page errors', exceptions.length === 0, exceptions.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
