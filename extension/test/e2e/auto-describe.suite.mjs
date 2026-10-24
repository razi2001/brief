  // ---- the description written from a recording's narration ----
  // The worker lands the narration (TRANSCRIPT_RESULT, sent by the offscreen
  // document once /api/transcribe answers), then the description written from
  // it (DESCRIPTION_RESULT, once /api/describe does; upload-race and narration
  // cover that path). Here: what the popup shows while it waits, when it lands,
  // and that the reporter's own words always win. Brief Cloud is answered from here.
  const APP = 'https://cloud.get-brief.app';
  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const answer = (sid, p) => {
    const body = p.request.url.endsWith('/api/me') ? { ok: true, tracker: 'linear', trackerName: 'Linear', trackerIssue: null, trackerAction: null } : { ok: true };
    return b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, sid).catch(() => {});
  };
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }] }, sid).catch(() => {}).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  // A narrated recording just stopped: uploaded, its narration still being transcribed.
  const seed = (over = {}) => W(`chrome.storage.local.set(${JSON.stringify({
    briefCloudToken: 'bxt_test',
    bcTrackerCache: { tracker: 'linear', trackerName: 'Linear' },
    draft: {
      id: 'd-desc', createdAt: Date.now(), screenshots: [], description: '', descriptionAuto: false, extra: [], includeVideo: true,
      recording: { recordedAt: Date.now(), durationMs: 12000, poster: null, source: 'capture' },
      uploading: false, uploadFailed: false, transcribing: true, transcriptFailed: false, cloudBriefId: 'b-1', transcript: '',
      ...over,
    },
  })})`);
  const field = (sid) => evalIn(sid, `(() => { const f = document.querySelector('#descField'); return { value: f.value, placeholder: f.placeholder, writing: document.querySelector('#descWrap').classList.contains('writing') }; })()`);
  const stored = () => W(`chrome.storage.local.get('draft').then((r) => r.draft)`);
  // what the offscreen document sends once the narration is transcribed, then summed up
  const transcribed = () => W(`chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId: 'd-desc', transcript: 'ok so um the pay button just spins forever', describing: true })`);
  const described = (description) => W(`chrome.runtime.sendMessage({ type: 'DESCRIPTION_RESULT', briefId: 'd-desc', description: ${JSON.stringify(description)} })`);
  const narrate = async (description) => { await transcribed(); await described(description); };
  const type = (sid, text, blur) => evalIn(sid, `(() => { const f = document.querySelector('#descField'); f.focus(); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input')); ${blur ? 'f.blur();' : ''} })()`);
  const close = (t) => b.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});

  await seed();
  const P = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  const f1 = await field(P.sid);
  check('while the narration is transcribed, the empty field says it is writing', f1.writing && f1.placeholder === 'Writing…' && f1.value === '', JSON.stringify(f1));
  await shot(P.sid, 'desc-writing.png');
  // the transcript comes first: the field keeps waiting for its summary
  await transcribed(); await sleep(800);
  const f1b = await field(P.sid);
  const d1b = await stored();
  check('once the transcript is in, the field still says it is writing until the summary lands', f1b.writing && f1b.value === '' && d1b.transcript && !d1b.transcribing && d1b.describing === true, JSON.stringify({ f1b, transcribing: d1b.transcribing, describing: d1b.describing }));
  await described('Clicking Pay on checkout spins forever.'); await sleep(800);
  const f2 = await field(P.sid);
  check('the description fills itself from the narration', f2.value === 'Clicking Pay on checkout spins forever.' && !f2.writing && f2.placeholder === 'Describe the brief…', JSON.stringify(f2));
  await shot(P.sid, 'desc-filled.png');
  const d2 = await stored();
  check('it is stored as the AI\'s, next to the transcript', d2.descriptionAuto === true && d2.description === f2.value && d2.transcript === 'ok so um the pay button just spins forever', JSON.stringify({ auto: d2.descriptionAuto, t: d2.transcript }));
  const create = await evalIn(P.sid, `document.querySelector('#createBtn').disabled`);
  check('and the brief is ready to create', create === false, String(create));

  // the reporter edits it: it is theirs now, a later summary leaves it alone
  await type(P.sid, 'Pay spins forever on checkout, card 4242.', true); await sleep(600);
  await narrate('A newer summary.'); await sleep(800);
  const f3 = await field(P.sid);
  const d3 = await stored();
  check('once the reporter edits it, no summary replaces it', f3.value === 'Pay spins forever on checkout, card 4242.' && d3.description === f3.value && d3.descriptionAuto === false, JSON.stringify({ f3, d: d3.description, auto: d3.descriptionAuto }));
  await close(P);

  // typing while it writes: the summary landing mid-typing (before the field
  // saves) still loses to what was typed
  await seed();
  const Q = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await type(Q.sid, 'typed first', false);
  const f4 = await field(Q.sid);
  check('typing drops the writing state', !f4.writing, JSON.stringify(f4));
  await narrate('The AI summary.'); await sleep(900);
  const f5 = await field(Q.sid);
  const d5 = await stored();
  check('a summary landing while the reporter types leaves their text', f5.value === 'typed first' && d5.description === 'typed first' && d5.descriptionAuto === false, JSON.stringify({ f5, d: d5.description, auto: d5.descriptionAuto }));
  await close(Q);

  // nothing said: the field just stops waiting
  await seed();
  const S = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await narrate(''); await sleep(800);
  const f6 = await field(S.sid);
  check('no summary: the field is empty and stops waiting', f6.value === '' && !f6.writing && f6.placeholder === 'Describe the brief…', JSON.stringify(f6));
  await close(S);

  // removing the recording takes the AI's description with it, not the reporter's
  await seed({ transcribing: false, description: 'About that video.', descriptionAuto: true });
  const R = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await evalIn(R.sid, `document.querySelector('[data-rm="rec"]').click()`); await sleep(900);
  const f7 = await field(R.sid);
  check('removing the recording clears the description written from it', f7.value === '' && (await stored()).description === '', JSON.stringify(f7));
  await close(R);
  await seed({ transcribing: false, description: 'my own words', descriptionAuto: false });
  const R2 = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await evalIn(R2.sid, `document.querySelector('[data-rm="rec"]').click()`); await sleep(900);
  const f8 = await field(R2.sid);
  check('but keeps what the reporter wrote', f8.value === 'my own words', JSON.stringify(f8));
  await close(R2);

  check('no exceptions in the popup', exceptions.length === 0, exceptions.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
