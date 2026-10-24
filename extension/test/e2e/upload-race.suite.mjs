  // ---- an edited recording replaces the original's upload ----
  // A capture starts uploading the moment it stops (the video plus a PNG every
  // 2s: big, slow). Trim it and save before that's done, and the trimmed file
  // uploads too. Whichever upload finished LAST became the brief, so a slow
  // original won and the ticket got the untrimmed video. Answered from here
  // (nothing leaves the machine); the original's file uploads are held back.
  const APP = 'https://cloud.get-brief.app';
  const calls = [];
  let briefs = 0;
  const held = []; // [sid, requestId] of the uploads being held back
  let holding = null; // the brief id whose uploads are held
  let transcribes = 0;
  let heldTake = null; // [sid, requestId] of the original take's transcription
  const reply = (sid, requestId, res) => b.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  const answer = async (sid, p) => {
    const url = p.request.url;
    let body = p.request.postData || '';
    if (!body && p.request.hasPostData && url.endsWith('/api/briefs')) body = (await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => ({ postData: '' }))).postData;
    calls.push({ url, method: p.request.method });
    if (url.endsWith('/api/briefs')) {
      const id = ++briefs === 1 ? 'b-orig' : 'b-edit';
      const files = JSON.parse(body || '{}').files || [];
      return reply(sid, p.requestId, { briefId: id, uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: `https://up.test/${id}/${encodeURIComponent(f)}` }])) });
    }
    if (holding && url.startsWith(`https://up.test/${holding}/`)) { held.push([sid, p.requestId]); return; }
    // what each upload's narration says. Transcription starts with the upload,
    // so the first call is the original take: held back with its upload, so it
    // comes back after the trimmed one's
    if (url.endsWith('/api/transcribe')) {
      if (transcribes++ === 0) { heldTake = [sid, p.requestId]; return; }
      return reply(sid, p.requestId, { text: 'the trimmed take' });
    }
    return reply(sid, p.requestId, { ok: true });
  };
  const release = async () => {
    holding = null;
    for (const [sid, id] of held.splice(0)) await reply(sid, id, { ok: true });
    if (heldTake) { const [sid, id] = heldTake; heldTake = null; await reply(sid, id, { text: 'the whole original take' }); }
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
  const draftNow = () => W(`chrome.storage.local.get('draft').then((x) => x.draft)`);
  const until = async (fn, ms = 20000) => { for (let t = 0; t < ms; t += 250) { const v = await fn(); if (v) return v; await sleep(250); } return null; };

  // the capture stops: the draft has a recording, its upload starts (held)
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    await fsm.putFile('rec:d-race', new Blob([new Uint8Array(400000)], { type: 'video/webm' }));
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test', draft: { id: 'd-race', createdAt: Date.now(), screenshots: [], description: '', includeVideo: true,
      recording: { recordedAt: Date.now(), durationMs: 20000, poster: null, source: 'capture' }, uploading: true, transcribing: true, cloudBriefId: null, transcript: '' } });
  })()`);
  holding = 'b-orig';
  const r1 = await W(`chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: 'd-race', key: 'rec:d-race', name: 'recording.webm', mimeType: 'video/webm' })`);
  check('the original starts uploading', r1?.ok === true && !!(await until(() => held.length > 0)), JSON.stringify(r1));
  check('its narration is sent with the upload, not after it', !!(await until(() => heldTake)) && held.length > 0, `transcribe calls: ${transcribes}`);

  // trimmed in the editor and saved (what player.js does): the new file uploads
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    const { updateDraft, landRecording } = await import('./draft.js');
    await fsm.putFile('rec:d-race', new Blob([new Uint8Array(90000)], { type: 'video/webm' }));
    await updateDraft('d-race', (x) => { landRecording(x, { uploading: true, durationMs: 5000, poster: null, source: 'capture' }); x.recording.edited = true; x.recording.trim = { a: 10000, b: 15000 }; });
  })()`);
  const r2 = await W(`chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: 'd-race', key: 'rec:d-race', name: 'recording.webm', mimeType: 'video/webm' })`);
  const edited = await until(async () => (await draftNow())?.cloudBriefId === 'b-edit' && !(await draftNow()).transcribing);
  check('the trimmed version uploads and becomes the brief', r2?.ok === true && !!edited, JSON.stringify(await draftNow()));

  // the original's upload finally goes through
  await release();
  await until(async () => calls.filter((c) => c.url.endsWith('/api/transcribe')).length >= 2, 8000);
  await sleep(1500);
  const d = await draftNow();
  check('the original finishing later does not take the brief back', d.cloudBriefId === 'b-edit' && !d.uploading && !d.uploadFailed, JSON.stringify({ cloudBriefId: d.cloudBriefId, uploading: d.uploading }));
  check('nor its narration', d.transcript === 'the trimmed take', JSON.stringify(d.transcript));

  // the other order: the original lands while the trimmed one is still going
  // (here: while its frames are sampled, before its upload even starts) - the
  // draft must keep waiting for the trimmed one, not look ready
  briefs = 0;
  await W(`(async () => {
    const fsm = await import('./filestore.js');
    await fsm.putFile('rec:d-race2', new Blob([new Uint8Array(400000)], { type: 'video/webm' }));
    await chrome.storage.local.set({ draft: { id: 'd-race2', createdAt: Date.now(), screenshots: [], description: '', includeVideo: true,
      recording: { recordedAt: Date.now(), durationMs: 20000, poster: null, source: 'capture' }, uploading: true, transcribing: true, cloudBriefId: null, transcript: '' } });
  })()`);
  holding = 'b-orig';
  await W(`chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: 'd-race2', key: 'rec:d-race2', name: 'recording.webm', mimeType: 'video/webm' })`);
  await until(() => held.length > 0);
  // the trimmed file: a real video, so sampling its frames takes a moment
  await W(`(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
    const r = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9' }); const ch = []; r.ondataavailable = (e) => e.data.size && ch.push(e.data);
    let n = 0; const iv = setInterval(() => { x.fillStyle = n % 2 ? '#2b2622' : '#dd6936'; x.fillRect(0, 0, 640, 360); n++; }, 33);
    r.start(500); await new Promise((res) => setTimeout(res, 3000)); r.stop(); await new Promise((res) => r.onstop = res); clearInterval(iv);
    const fsm = await import('./filestore.js');
    const { updateDraft, landRecording } = await import('./draft.js');
    await fsm.putFile('rec:d-race2', new Blob(ch, { type: 'video/webm' }));
    await updateDraft('d-race2', (x) => { landRecording(x, { uploading: true, durationMs: 3000, poster: null, source: 'capture' }); x.recording.edited = true; });
  })()`);
  // hold the trimmed one now, let the original through at once
  const heldOrig = held.splice(0);
  holding = 'b-edit';
  await W(`chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: 'd-race2', key: 'rec:d-race2', name: 'recording.webm', mimeType: 'video/webm' })`);
  for (const [sid, id] of heldOrig) await reply(sid, id, { ok: true });
  await until(() => held.length > 0);
  await sleep(1500);
  const mid = await draftNow();
  check('while the trimmed one uploads, the original landing does not make the draft look ready', mid.uploading && !mid.cloudBriefId, JSON.stringify({ cloudBriefId: mid.cloudBriefId, uploading: mid.uploading }));
  await release();
  const done = await until(async () => (await draftNow())?.cloudBriefId === 'b-edit');
  check('then the trimmed one becomes the brief', !!done, JSON.stringify(await draftNow()));

  // the narration and the upload coming back at the same moment: the worker
  // lands both on the draft, neither write undoes the other
  let both = 0;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const id = `d-both${i}`;
    briefs = 0; transcribes = 0; holding = 'b-orig';
    await W(`(async () => {
      const fsm = await import('./filestore.js');
      await fsm.putFile('rec:${id}', new Blob([new Uint8Array(50000)], { type: 'video/webm' }));
      await chrome.storage.local.set({ draft: { id: '${id}', createdAt: Date.now(), screenshots: [], description: '', includeVideo: true,
        recording: { recordedAt: Date.now(), durationMs: 20000, poster: null, source: 'capture' }, uploading: true, transcribing: true, cloudBriefId: null, transcript: '' } });
    })()`);
    await W(`chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId: '${id}', key: 'rec:${id}', name: 'recording.webm', mimeType: 'video/webm' })`);
    await until(() => heldTake && held.length >= 2); // brief.json + the video
    holding = null;
    const take = heldTake; heldTake = null;
    await Promise.all([...held.splice(0).map(([sid, rid]) => reply(sid, rid, { ok: true })), reply(take[0], take[1], { text: 'both stick' })]);
    const d = await until(async () => { const x = await draftNow(); return x && !x.uploading && !x.transcribing ? x : null; }, 8000) || await draftNow();
    seen.push({ cloudBriefId: d?.cloudBriefId, transcript: d?.transcript, uploading: d?.uploading, transcribing: d?.transcribing });
    if (d?.cloudBriefId === 'b-orig' && d?.transcript === 'both stick') both++;
  }
  check('the narration and the upload landing together both stick', both === 5, JSON.stringify(seen));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
