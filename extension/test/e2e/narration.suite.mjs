  // ---- a recording's narration is transcribed while its video still uploads ----
  // A real recording (a window from Chrome's picker, the fake mic), stopped the
  // way "Stop sharing" does. Its file uploads are held back: the transcript must
  // reach the draft anyway, from a small mono audio track. Answered from here
  // (nothing leaves the machine).
  const { execFileSync } = await import('node:child_process');
  const APP = 'https://cloud.get-brief.app';
  const base = `http://app.brief.localhost:${WEB}`;
  const until = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 250) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
  const sess = () => W(`chrome.storage.session.get('recSession').then((r) => r.recSession || null)`);
  const draftNow = () => W(`chrome.storage.local.get('draft').then((x) => x.draft)`);
  const calls = [];
  const held = []; // [sid, requestId] of the file uploads being held back
  let holding = true;
  let heldDescribe = null; // the description's call, held until the transcript is checked
  const reply = (sid, requestId, res) => b.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  const answer = async (sid, p) => {
    const url = p.request.url;
    calls.push({ url, method: p.request.method, at: Date.now() });
    if (url.endsWith('/api/briefs')) {
      let body = p.request.postData || '';
      if (!body && p.request.hasPostData) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
      const files = JSON.parse(body || '{}').files || [];
      return reply(sid, p.requestId, { briefId: 'b-narr', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: `https://up.test/${encodeURIComponent(f)}` }])) });
    }
    if (holding && url.startsWith('https://up.test/')) { held.push([sid, p.requestId]); return; }
    if (url.endsWith('/api/transcribe')) return reply(sid, p.requestId, { text: 'the cart total is wrong' });
    if (url.endsWith('/api/describe')) { heldDescribe = [sid, p.requestId]; return; }
    return reply(sid, p.requestId, { ok: true });
  };
  const watch = (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    // the uploads run in the offscreen document: it attaches as 'other', no url yet
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      const { url, type } = m.params.targetInfo;
      (url.includes(extId) || type === 'other' ? watch(sid) : Promise.resolve()).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const A = await open(`${base}/`); await sleep(1500);
  const ta = await W(`chrome.tabs.query({}).then((ts) => ts.find((x) => x.url === '${base}/')?.id)`);
  await focus(A);
  await W(`(async () => {
    const { emptyDraft, setDraft } = await import('./draft.js');
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test' });
    await setDraft({ ...emptyDraft(), id: 'd-narr' });
  })()`);
  await W(`chrome.tabs.sendMessage(${ta}, { type: 'INJECT_BAR', streamId: '', intent: 'brief', mode: 'inbox', itemId: 'd-narr', capture: 'window' })`);
  const s1 = await until(async () => { const s = await sess(); return s?.briefId === 'd-narr' ? s : null; });
  check('a recording starts', !!s1, JSON.stringify(s1));

  // keep what the offscreen document sends to be transcribed
  const off = await until(async () => (await b.send('Target.getTargets')).targetInfos.find((t) => t.url.includes(`${extId}/offscreen.html`)));
  const oS = await attach(off.targetId);
  await evalIn(oS, `(() => { const real = window.fetch; window.fetch = (u, init) => { if (String(u).includes('/api/transcribe')) window.__sent = init?.body; return real(u, init); }; return true; })()`);
  await sleep(4000); // the fake mic beeps into it

  // "Stop sharing": the recording stops and uploads (held here)
  const stoppedAt = Date.now();
  await evalIn(oS, `document.querySelector('video').srcObject.getVideoTracks()[0].dispatchEvent(new Event('ended'))`);
  await until(() => held.length > 0);
  const early = await until(async () => { const d = await draftNow(); return d?.transcript ? d : null; });
  const transcribeAt = calls.find((c) => c.url.endsWith('/api/transcribe'))?.at;
  check('the transcript lands while the video is still uploading', early?.transcript === 'the cart total is wrong' && early.uploading === true && !early.transcribing && !!early.recording && held.length > 0,
    JSON.stringify({ transcript: early?.transcript, uploading: early?.uploading, transcribing: early?.transcribing, recording: !!early?.recording, held: held.length, sentAfterStopMs: transcribeAt && transcribeAt - stoppedAt }));
  // the bar shows "Saving" for 1.5s after Chrome's Stop sharing, then closes:
  // nothing it does may undo the transcript that came back meanwhile
  await sleep(2500);
  const later = await draftNow();
  check('and it is still there once the bar has closed', later?.transcript === 'the cart total is wrong' && !later.transcribing && later.uploading === true,
    JSON.stringify({ transcript: later?.transcript, transcribing: later?.transcribing, uploading: later?.uploading }));
  check('the transcript did not wait for the description written from it', !!heldDescribe && later?.describing === true && !later.description,
    JSON.stringify({ describeAsked: !!heldDescribe, describing: later?.describing, description: later?.description }));
  if (heldDescribe) await reply(heldDescribe[0], heldDescribe[1], { description: 'The cart total is wrong.' });
  const described = await until(async () => { const d = await draftNow(); return d?.description ? d : null; }, 5000);
  check('then the description lands in the empty field', described?.description === 'The cart total is wrong.' && described.descriptionAuto === true && !described.describing,
    JSON.stringify({ description: described?.description, auto: described?.descriptionAuto, describing: described?.describing }));

  // what was sent: the audio-only track, opus, mono, small
  const b64 = await evalIn(oS, `(async () => { const b = window.__sent; if (!b) return null; const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); })()`);
  let probe = null;
  if (b64) {
    const file = path.join(OUT, 'narration-sent.webm');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    try {
      const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels:format=size', '-of', 'json', file]).toString());
      // MediaRecorder writes no duration in the header: the last packet's time
      const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file]).toString().split(/\s+/).map(Number).filter(Number.isFinite);
      const secs = pts.length ? Math.max(...pts) : 0;
      probe = { streams: out.streams.map((s) => `${s.codec_type}:${s.codec_name}:${s.channels ?? ''}`), bytes: Number(out.format.size), secs: Math.round(secs * 10) / 10, kbps: secs ? Math.round(Number(out.format.size) * 8 / secs / 1000) : null };
    } catch (err) { probe = { error: String(err.message || err).slice(0, 200) }; }
  }
  check('the audio sent is one mono opus track at about 32 kbps', !!probe && probe.streams?.length === 1 && probe.streams[0] === 'audio:opus:1' && probe.kbps > 0 && probe.kbps <= 45, JSON.stringify(probe));

  // the upload finishes: both results are on the draft
  holding = false;
  for (const [sid, id] of held.splice(0)) await reply(sid, id, { ok: true });
  const done = await until(async () => { const d = await draftNow(); return d && !d.uploading ? d : null; });
  check('then the upload lands and the transcript stays', done?.cloudBriefId === 'b-narr' && done.transcript === 'the cart total is wrong' && !done.uploadFailed,
    JSON.stringify({ cloudBriefId: done?.cloudBriefId, transcript: done?.transcript, uploadFailed: done?.uploadFailed }));
  check('and the audio track uploads with the brief', calls.some((c) => c.url === 'https://up.test/audio.webm'), JSON.stringify(calls.filter((c) => c.url.startsWith('https://up.test/')).map((c) => c.url)));
  check('no exceptions', exceptions.length === 0, exceptions.join(' | '));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
