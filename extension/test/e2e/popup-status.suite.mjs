  // ---- the popup and the account's tracker status (/api/me) ----
  // Every Brief Cloud call from the extension is answered here (nothing leaves
  // the machine); /api/me says whatever the current case needs.
  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const APP = 'https://cloud.get-brief.app';
  let me = {};
  let meDelayMs = 0;
  const answer = async (sid, p) => {
    const isMe = p.request.url.endsWith('/api/me');
    if (isMe && meDelayMs) await sleep(meDelayMs);
    const body = isMe ? me : { ok: true };
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, sid).catch(() => {});
  };
  const watch = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      watch(sid).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  // A paired account and a brief ready to file.
  const reset = (cache) => W(`chrome.storage.local.remove('bcTrackerCache').then(() => chrome.storage.local.set({
    briefCloudToken: 'bxt_test',
    draft: { id: 'd-status', createdAt: Date.now(), screenshots: [], description: 'the Pay button does nothing' },
    ${cache ? `bcTrackerCache: ${JSON.stringify(cache)},` : ''}
  }))`);
  const popupState = (sid) => evalIn(sid, `(() => {
    const r = document.querySelector('#reconnectBtn');
    const c = document.querySelector('#createBtn');
    return { shown: !!r && !r.hidden && r.offsetParent !== null, label: r ? r.textContent.trim() : null, createDisabled: c.disabled, err: document.querySelector('#errBar').textContent };
  })()`);

  // A Linear still held by Clerk, with Brief's own Linear app live.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: 'reconnect' };
  await reset(null);
  const P1 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const s1 = await popupState(P1.sid);
  check('a tracker still on Clerk: the popup offers "Reconnect Linear"', s1.shown && s1.label === 'Reconnect Linear', JSON.stringify(s1));
  check('Create ticket stays enabled beside it', s1.createDisabled === false, JSON.stringify(s1));
  const cached = await W(`chrome.storage.local.get('bcTrackerCache').then((r) => r.bcTrackerCache)`);
  check('the action is cached with the tracker', cached?.trackerAction === 'reconnect' && cached?.tracker === 'linear', JSON.stringify(cached));
  await shot(P1.sid, 'popup-reconnect.png');

  // Clicking it asks for Connections' tracker row. Tab opening is recorded, not
  // done, so no page loads from the real app.
  await evalIn(P1.sid, `(() => {
    chrome.tabs.query = async () => [];
    chrome.tabs.create = async (o) => { await chrome.storage.local.set({ __opened: o.url }); return {}; };
    window.close = () => {};
  })()`);
  await click(P1.sid, '#reconnectBtn'); await sleep(500);
  const opened = await W(`chrome.storage.local.get('__opened').then((r) => r.__opened)`);
  check('it opens Connections on the tracker row', opened === `${APP}/connections#tracker`, JSON.stringify(opened));
  await b.send('Target.closeTarget', { targetId: P1.targetId }).catch(() => {});

  // Moved to Brief since: the next open paints the row from the cache while
  // /api/me is slow, and drops it once the server stops asking.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null };
  meDelayMs = 2500;
  const P2 = await open(`chrome-extension://${extId}/popup.html`); await sleep(900);
  const s2 = await popupState(P2.sid);
  check('the next open shows it from the cache, before /api/me answers', s2.shown && s2.label === 'Reconnect Linear', JSON.stringify(s2));
  await sleep(3000);
  const s3 = await popupState(P2.sid);
  check('once Brief holds the tracker, the row goes and Create stays enabled', !s3.shown && s3.createDisabled === false, JSON.stringify(s3));
  meDelayMs = 0;
  await b.send('Target.closeTarget', { targetId: P2.targetId }).catch(() => {});

  // A cache from before trackerAction existed, and a server that doesn't send it.
  me = { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null };
  await reset({ tracker: 'linear' });
  const P4 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  const s4 = await popupState(P4.sid);
  check('an old cache and an older server: no row, Create enabled', !s4.shown && s4.createDisabled === false, JSON.stringify(s4));
  await b.send('Target.closeTarget', { targetId: P4.targetId }).catch(() => {});

  // No tracker that can file: Create says why and links to Connections, as before.
  me = { ok: true, tracker: null, trackerName: null, trackerIssue: 'Your Linear connection has expired - reconnect it under Settings, then retry.', trackerAction: null };
  await reset({ tracker: null });
  const P5 = await open(`chrome-extension://${extId}/popup.html`); await sleep(2000);
  await click(P5.sid, '#createBtn'); await sleep(300);
  const s5 = await popupState(P5.sid);
  const link = await evalIn(P5.sid, `document.querySelector('#errBar .err-link')?.textContent || ''`);
  check('a tracker issue still shows on Create, with its Connect link, and no reconnect row', /has expired/.test(s5.err) && link === 'Connect' && !s5.shown, JSON.stringify({ ...s5, link }));

  const thrown = exceptions.filter(Boolean);
  check('the popup threw nothing', thrown.length === 0, thrown.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
