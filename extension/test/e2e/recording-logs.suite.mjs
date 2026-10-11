  // ---- a recording keeps its technical logs, even across a worker restart ----
  const B = await open(`http://app.brief.localhost:${WEB}/`); await sleep(2000); await focus(B);
  const tabId = await W(`chrome.tabs.query({ url: 'http://app.brief.localhost:${WEB}/*' }).then(t => t[0].id)`);
  // what BRIEF_START does, minus the bar: the session, the page's capture, content.js armed
  await W(`(async () => {
    await chrome.storage.session.set({ recSession: { briefId: 'd-rec', tabId: ${tabId}, startedAt: Date.now(), muted: false, intent: 'brief', pageUrl: 'http://app.brief.localhost:${WEB}/' } });
    await chrome.storage.session.remove('recEvents');
    const m = await import('./page-capture.js');
    await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, world: 'MAIN', func: m.installPageCapture });
    await chrome.tabs.sendMessage(${tabId}, { type: 'BRIEF_START', startedAt: Date.now() });
  })()`);
  await click(B.sid, '#pay'); await sleep(2500);
  const before = await W(`chrome.storage.session.get('recEvents').then(r => (r.recEvents || []).filter(e => e.type === 'network').length)`);
  check('a recording logs its network calls (worker restored from the session)', before >= 1, `network events: ${before}`);

  // recycle the worker, as MV3 does after ~30s without events
  const sw = (await b.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId));
  await b.send('Target.closeTarget', { targetId: sw.targetId }).catch(() => {});
  await sleep(1500);
  await click(B.sid, '#pay'); await sleep(2500);
  const after = await W(`chrome.storage.session.get('recEvents').then(r => { const ev = r.recEvents || []; const pays = ev.filter(e => e.type === 'network' && String(e.url).includes('/api/pay')); return { pays: pays.length, trace: pays[0] && pays[0].trace, at: !!(pays[0] && pays[0].at), cons: ev.filter(e => e.type === 'console-error').length }; })`);
  check('after a worker restart the log keeps what came before, and goes on', after.pays >= 2 && after.trace === 'x-request-id: req-7f3a9c' && after.at && after.cons >= 2, JSON.stringify(after));
  const meta = await W(`chrome.runtime.sendMessage({ type: 'GET_BRIEF_META' })`);
  check('the upload gets them, with the page it started on', (meta.events || []).filter((e) => e.type === 'network').length >= 2 && meta.pageUrl === `http://app.brief.localhost:${WEB}/`, JSON.stringify({ n: meta.events?.length, pageUrl: meta.pageUrl }));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
