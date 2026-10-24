
  const clickAt = async (sid, x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
    await sleep(300);
  };
  const clickSel = async (sid, sel) => {
    const p = await evalIn(sid, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await clickAt(sid, p.x, p.y);
  };
  const clickText = async (sid, sel, text) => {
    const p = await evalIn(sid, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.includes(${JSON.stringify(text)})); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await clickAt(sid, p.x, p.y);
  };
  const dragTo = async (sid, x0, y0, x1, y1) => {
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 }, sid);
    for (let i = 1; i <= 6; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + ((x1 - x0) * i) / 6, y: y0 + ((y1 - y0) * i) / 6, button: 'left', buttons: 1 }, sid);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 }, sid);
    await sleep(300);
  };
  const rectOf = (sid, sel) => evalIn(sid, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const draftNow = () => W(`chrome.storage.local.get('draft').then(r => r.draft)`);

  // ================= site list comes from the org =================
  const sync = await W(`(async () => {
    const m = await import('./replay-sites.js');
    const real = fetch; const calls = [];
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test' });
    globalThis.fetch = async (u, o) => { calls.push(String(u)); return new Response(JSON.stringify({ sites: ['*.Brief.localhost', 'junk host!'] }), { status: 200 }); };
    const a = await m.syncReplaySites();
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    const b = await m.syncReplaySites();
    globalThis.fetch = async () => { throw new Error('offline'); };
    await chrome.storage.local.set({ replaySites: ['kept.test'] });
    const c = await m.syncReplaySites();
    globalThis.fetch = real;
    await chrome.storage.local.remove('briefCloudToken');
    return { a, b, c, url: calls[0] };
  })()`);
  check('sites sync from the org: normalized, 401 clears, offline keeps', JSON.stringify(sync.a) === '["*.brief.localhost"]' && JSON.stringify(sync.b) === '[]' && JSON.stringify(sync.c) === '["kept.test"]' && /\/api\/replay-sites$/.test(sync.url), JSON.stringify(sync));

  // ================= video editor =================
  const made = await W(`(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360; const x = c.getContext('2d');
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    const s = new MediaStream([...c.captureStream(30).getVideoTracks(), ...d.stream.getAudioTracks()]);
    const r = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus' }); const ch = []; r.ondataavailable = (e) => e.data.size && ch.push(e.data);
    let n = 0; const iv = setInterval(() => { x.fillStyle = '#2b2622'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#dd6936'; x.fillRect((n * 7) % 640, 140, 80, 80); x.fillStyle = '#f5f1e8'; x.font = '48px sans-serif'; x.fillText('frame ' + n++, 40, 80); }, 33);
    r.start(200); await new Promise((res) => setTimeout(res, 5000)); r.stop(); await new Promise((res) => r.onstop = res); clearInterval(iv); o.stop(); ac.close();
    const blob = new Blob(ch, { type: 'video/webm' });
    const fsm = await import('./filestore.js'); await fsm.putFile('rec:d-vid', blob);
    await chrome.storage.local.set({ draft: { id: 'd-vid', createdAt: Date.now(), screenshots: [], recording: { recordedAt: Date.now(), durationMs: 5000, poster: null, source: 'capture' }, includeVideo: true, description: '' } });
    return blob.size;
  })()`);
  check('made a 5s test recording', made > 10000, `${made} bytes`);

  const V = await open(`chrome-extension://${extId}/player.html#d-vid`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, V.sid);
  await b.send('Page.reload', {}, V.sid); await focus(V); await sleep(3500);
  const v0 = await evalIn(V.sid, `({ title: document.querySelector('.ed-title').textContent, tools: [...document.querySelectorAll('.tool')].map(t => t.textContent.trim()), thumbs: document.querySelectorAll('.tl-track img').length, handles: document.querySelectorAll('.tl-h').length, clock: document.querySelector('#edClock').textContent, old: !!document.querySelector('#tSplit, .tl-range, .chip') })`);
  check('video editor: Crop + Voice only, filmstrip, two handles', v0.title === 'Recording' && JSON.stringify(v0.tools) === '["Crop","Sound on","Record voice","Mark"]' && v0.thumbs === 12 && v0.handles === 2 && !v0.old, JSON.stringify(v0));

  // trim the start to ~30%
  let tl = await rectOf(V.sid, '.tl');
  let h = await rectOf(V.sid, '.tl-h[data-edge="a"]');
  await dragTo(V.sid, h.x + h.w / 2, h.y + h.h / 2, tl.x + tl.w * 0.3, h.y + h.h / 2);
  const clk = await evalIn(V.sid, `document.querySelector('#edClock').textContent`);
  check('trim handle shortens what is kept', /\/ 0:0[34]$/.test(clk.trim()), clk);

  // mark where the bug is (M) with a note; the speed button
  await clickAt(V.sid, tl.x + tl.w * 0.6, tl.y + tl.h / 2);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77, text: 'm' }, V.sid); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77 }, V.sid); await sleep(400);
  await b.send('Input.insertText', { text: 'button does nothing' }, V.sid); await sleep(300);
  const mk = await evalIn(V.sid, `(() => { const f = document.querySelector('.tl-mark')?.getBoundingClientRect(), p = document.querySelector('.mark-pop')?.getBoundingClientRect(); return { flags: document.querySelectorAll('.tl-mark').length, note: document.querySelector('.mark-note')?.value, title: document.querySelector('.tl-mark')?.title, onFlag: !!(f && p && p.bottom <= f.top && p.left <= f.left && p.right >= f.left), row: !!document.querySelector('#edOpts .opt') }; })()`);
  check('M drops a mark at the playhead, with a note', mk.flags === 1 && mk.onFlag && !mk.row && mk.note === 'button does nothing' && /button does nothing/.test(mk.title || ''), JSON.stringify(mk));
  await shot(V.sid, 'mark-pop.png'); await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, V.sid); await sleep(200);
  const mk2 = await evalIn(V.sid, `({ pop: !!document.querySelector('.mark-pop'), btn: [...document.querySelectorAll('.tool')].pop().textContent.trim() })`);
  check('Enter closes the note; the button counts the marks', !mk2.pop && mk2.btn === 'Mark · 1', JSON.stringify(mk2));
  await clickSel(V.sid, '.tl-mark'); await sleep(200);
  const mk3 = await evalIn(V.sid, `document.querySelector('.mark-pop .mark-note')?.value`);
  check('clicking the flag reopens its note', mk3 === 'button does nothing', mk3);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, V.sid); await sleep(200);
  await clickSel(V.sid, '#edSpeed');
  const sp = await evalIn(V.sid, `({ label: document.querySelector('#edSpeed').textContent, rate: document.querySelector('video').playbackRate })`);
  check('speed button: 1.5x', sp.label === '1.5×' && sp.rate === 1.5, JSON.stringify(sp));
  // crop to 1:1
  await clickText(V.sid, '.tool', 'Crop');
  const fmts = await evalIn(V.sid, `[...document.querySelectorAll('#edOpts .opt')].map(o => o.textContent)`);
  await clickText(V.sid, '#edOpts .opt', '1:1');
  const cb = await rectOf(V.sid, '.crop-box');
  const mb = await rectOf(V.sid, '.media');
  const pxW = (cb.w / mb.w) * 640, pxH = (cb.h / mb.h) * 360;
  check('Crop offers formats; 1:1 is square in real pixels', JSON.stringify(fmts) === '["Free","16:9","4:3","1:1","9:16"]' && Math.abs(pxW - pxH) < 4, `${JSON.stringify(fmts)} ${pxW.toFixed(0)}x${pxH.toFixed(0)}`);
  await shot(V.sid, 'ed2-crop.png');

  // voice: original off, record a voice-over over the kept part
  await clickText(V.sid, '.tool', 'Crop'); // close the crop row
  await clickText(V.sid, '.tool', 'Sound on');
  const origOff = await evalIn(V.sid, `({ label: [...document.querySelectorAll('.tool')].map(t => t.textContent.trim())[1], muted: document.querySelector('video').muted, opts: !!document.querySelector('#edOpts .opt') })`);
  check('one click: Sound off mutes the preview, no options row', origOff.label === 'Sound off' && origOff.muted && !origOff.opts, JSON.stringify(origOff));
  await clickText(V.sid, '.tool', 'Record voice');
  await sleep(600);
  const recUi = await evalIn(V.sid, `document.querySelector('.tool.recording')?.textContent.trim() || ''`);
  check('recording turns the button into Stop 0:0x', /^Stop 0:0\d$/.test(recUi), recUi);
  for (let i = 0; i < 20; i++) { await sleep(500); if (!(await evalIn(V.sid, `!!document.querySelector('.tool.recording')`))) break; }
  const vo = await evalIn(V.sid, `[...document.querySelectorAll('.tool')].map(o => o.textContent.trim())`);
  check('voice-over recorded over the kept part, stops by itself', vo.some((t) => /^Voice 0:0[2-4]×$/.test(t)), JSON.stringify(vo));
  await shot(V.sid, 'ed2-voice.png');

  // save
  await clickSel(V.sid, '#edSave');
  for (let i = 0; i < 40; i++) { await sleep(500); if ((await draftNow())?.recording?.edited) break; }
  await sleep(1500); // let the editor close and the popup reopen first
  const C = await open(`chrome-extension://${extId}/player.html#none`); await focus(C); await sleep(500);
  const out = await evalIn(C.sid, `(async () => {
    const fsm = await import('./filestore.js'); const blob = await fsm.getFile('rec:d-vid');
    const v = document.createElement('video'); v.src = URL.createObjectURL(blob); v.muted = true; document.body.appendChild(v);
    await new Promise((r) => v.onloadedmetadata = r);
    await v.play(); await new Promise((r) => setTimeout(r, 1200)); v.pause();
    const audio = v.webkitAudioDecodedByteCount;
    v.currentTime = 1e9; await new Promise((r) => v.onseeked = r);
    const d = (await chrome.storage.local.get('draft')).draft;
    return { w: v.videoWidth, h: v.videoHeight, dur: v.duration, audio, durMs: d.recording.durationMs, edited: d.recording.edited, marks: d.recording.marks };
  })()`);
  check('the mark follows the trim into the saved video', out.marks?.length === 1 && out.marks[0].note === 'button does nothing' && out.marks[0].t >= 0 && out.marks[0].t < out.dur * 1000, JSON.stringify(out.marks));
  check('saved video: square crop, trimmed, has sound', out.w === out.h && out.w >= 350 && out.w <= 362 && out.dur > 2.8 && out.dur < 4.2 && out.audio > 0 && out.edited, JSON.stringify(out));

  // ================= screenshot editor =================
  await W(`(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 500; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 500); x.fillStyle = '#dd6936'; x.fillRect(350, 200, 100, 100);
    const dataUrl = c.toDataURL('image/png');
    const clean = await new Promise((r) => c.toBlob(r, 'image/png'));
    const fsm = await import('./filestore.js'); await fsm.putFile('shot:s1', clean);
    const d = (await chrome.storage.local.get('draft')).draft;
    d.screenshots = [{ id: 's1', dataUrl, annotated: true, strokes: [{ points: [{ x: 400, y: 250 }, { x: 410, y: 260 }] }], description: 'n' }];
    await chrome.storage.local.set({ draft: d });
  })()`);
  const I = await open(`chrome-extension://${extId}/image.html#s1`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, I.sid);
  await b.send('Page.reload', {}, I.sid); await focus(I); await sleep(2000);
  const i0 = await evalIn(I.sid, `({ tools: [...document.querySelectorAll('.tool')].map(t => t.textContent.trim()), drawOn: document.querySelector('.tool').classList.contains('on'), opts: [...document.querySelectorAll('#edOpts .opt')].map((o) => o.title), timeline: !!document.querySelector('.tl') })`);
  check('screenshot editor: Draw (shapes, colors, undo, clear) and Crop, the pen in hand, no timeline',
    JSON.stringify(i0.tools) === '["Draw","Crop"]' && i0.drawOn && JSON.stringify(i0.opts) === '["Pen","Arrow","Box","Red","Yellow","Blue","Green","Undo","Clear"]' && !i0.timeline, JSON.stringify(i0));
  // an arrow in blue, dragged across the picture
  await clickText(I.sid, '#edOpts .opt', 'Arrow');
  await evalIn(I.sid, `document.querySelector('#edOpts .opt[title="Blue"]').click()`);
  const ink = await evalIn(I.sid, `(() => { const r = document.querySelector('.ink').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const pt = (fx, fy) => ({ x: ink.x + ink.w * fx, y: ink.y + ink.h * fy });
  const a0 = pt(0.2, 0.5), a1 = pt(0.4, 0.5);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a0.x, y: a0.y, button: 'left', clickCount: 1 }, I.sid);
  for (let k = 1; k <= 5; k++) await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a0.x + (a1.x - a0.x) * k / 5, y: a0.y, button: 'left', buttons: 1 }, I.sid);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a1.x, y: a1.y, button: 'left', clickCount: 1 }, I.sid);
  await sleep(300);
  await clickText(I.sid, '.tool', 'Crop');
  await clickText(I.sid, '#edOpts .opt', '16:9');
  await shot(I.sid, 'ed2-image.png');
  await clickSel(I.sid, '#edSave'); await sleep(1500);
  const img = await W(`(async () => {
    const d = (await chrome.storage.local.get('draft')).draft; const s = d.screenshots[0];
    const im = new Image(); im.src = s.dataUrl; await im.decode();
    const fsm = await import('./filestore.js'); const cb = await createImageBitmap(await fsm.getFile('shot:s1'));
    return { w: im.naturalWidth, h: im.naturalHeight, cw: cb.width, ch: cb.height, p: s.strokes[0].points[0], arrow: s.strokes[1] && { tool: s.strokes[1].tool, color: s.strokes[1].color, x: Math.round(s.strokes[1].points[0].x), y: Math.round(s.strokes[1].points[0].y) }, cropped: s.cropped, annotated: s.annotated };
  })()`);
  check('screenshot cropped to 16:9, clean capture too, drawing moved with it', img.w === 800 && img.h === 450 && img.cw === 800 && img.ch === 450 && img.p.x === 400 && img.p.y === 225 && img.cropped, JSON.stringify(img));
  check('the arrow drawn is kept, blue, where it was put (moved with the crop)', img.arrow?.tool === 'arrow' && img.arrow.color === '#2f7bff' && Math.abs(img.arrow.x - 160) <= 3 && Math.abs(img.arrow.y - 225) <= 3 && img.annotated, JSON.stringify(img.arrow));
  // opened again: the pen in hand whatever was used last, the color kept
  const I2 = await open(`chrome-extension://${extId}/image.html#s1`); await focus(I2); await sleep(1500);
  const again = await evalIn(I2.sid, `[...document.querySelectorAll('#edOpts .opt.on')].map((o) => o.title)`);
  check('the screenshot editor always opens on the pen, in the last color', JSON.stringify(again) === '["Pen","Blue"]', JSON.stringify(again));
  await b.send('Target.closeTarget', { targetId: I2.targetId }).catch(() => {});

  {
  // ================= Replay: instant, same editor =================
  await W(`chrome.storage.local.set({ replaySites: ['*.brief.localhost'], replaySitesSyncedAt: Date.now(), draft: { id: 'd-rep', createdAt: Date.now(), screenshots: [], recording: null, description: '' } })`);
  const A = await open(`http://brief.localhost:${WEB}/home`); await sleep(2500); await focus(A);
  await click(A.sid, '#add'); await click(A.sid, '#add');
  const B = await open(`http://app.brief.localhost:${WEB}/`); await sleep(2500); await focus(B);
  await click(B.sid, '#add'); await click(B.sid, '#pay'); await sleep(1500);

  const t0open = Date.now();
  const pageTab = await W(`chrome.tabs.query({ url: 'http://app.brief.localhost:${WEB}/*' }).then(t => t[0].id)`);
  // the popup opens editors as children of the page tab; two other tabs sit in between to tempt Chrome
  await open('about:blank'); await open('about:blank');
  await W(`chrome.tabs.create({ url: chrome.runtime.getURL('replay.html#at=' + Date.now() + '&pick=d-rep'), openerTabId: ${pageTab} })`);
  await sleep(300);
  const rT = (await b.send('Target.getTargets')).targetInfos.find((t) => t.url.includes('/replay.html#at='));
  const R = { targetId: rT.targetId, sid: await attach(rT.targetId) };
  await b.send('Runtime.enable', {}, R.sid);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, R.sid);
  await focus(R);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { await sleep(100); ready = await evalIn(R.sid, `!!document.querySelector('.media .rr-player') && !!document.querySelector('.tl')`).catch(() => false); }
  const openMs = Date.now() - t0open;
  check('Replay opens straight in the editor (no filming)', ready && openMs < 3000, `${openMs}ms`);
  await sleep(2500);
  const r0 = await evalIn(R.sid, `({ title: document.querySelector('.ed-title').textContent, save: document.querySelector('#edSave').textContent, tools: [...document.querySelectorAll('.tool')].map(t => t.textContent.trim()), cells: document.querySelectorAll('.tl-track .cell').length, liveCells: document.querySelectorAll('.tl-track .cell .rr-player').length, chips: document.querySelectorAll('.chip').length })`);
  check('same editor as a recording: Crop + Voice, live preview strip', r0.title === 'Replay' && r0.save === 'Add to brief' && JSON.stringify(r0.tools) === '["Crop","Record voice","Mark"]' && r0.cells === 8 && r0.liveCells === 8 && r0.chips === 0, JSON.stringify(r0));

  const keptOf = (txt) => { const [m, x] = txt.split('/')[1].trim().split(':').map(Number); return m * 60 + x; };
  const idle = await evalIn(R.sid, `({ gaps: document.querySelectorAll('.tl-gap').length, clock: document.querySelector('#edClock').textContent })`);
  check('idle: no gaps; short pauses kept, dead time squeezed', idle.gaps === 0 && keptOf(idle.clock) <= 20, JSON.stringify(idle));
  await shot(R.sid, 'replay-gaps.png');
  // trim the start, crop 16:9
  const rtl = await rectOf(R.sid, '.tl');
  const rh = await rectOf(R.sid, '.tl-h[data-edge="a"]');
  await dragTo(R.sid, rh.x + rh.w / 2, rh.y + rh.h / 2, rtl.x + rtl.w * 0.2, rh.y + rh.h / 2);
  await clickText(R.sid, '.tool', 'Crop');
  await clickText(R.sid, '#edOpts .opt', '16:9');
  await clickText(R.sid, '.tool', 'Crop');
  // voice-over over the kept part
  await clickText(R.sid, '.tool', 'Record voice');
  for (let i = 0; i < 20; i++) { await sleep(500); if (!(await evalIn(R.sid, `!!document.querySelector('.tool.recording')`))) break; }
  const vo = await evalIn(R.sid, `[...document.querySelectorAll('.tool')].map(o => o.textContent.trim())`);
  check('voice-over recorded', vo.some((t) => /^Voice 0:0\d×$/.test(t)), JSON.stringify(vo));

  // Space plays / pauses
  const space = async () => {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }, R.sid);
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, R.sid);
    await sleep(500);
  };
  await space();
  const p1 = await evalIn(R.sid, `document.querySelector('#edPlay').getAttribute('aria-label')`);
  await space();
  const p2 = await evalIn(R.sid, `document.querySelector('#edPlay').getAttribute('aria-label')`);
  check('Space plays then pauses', p1 === 'Pause' && p2 === 'Play', `${p1} ${p2}`);
  await shot(R.sid, 'instant-replay.png');

  const rtl2 = await rectOf(R.sid, '.tl');
  await clickAt(R.sid, rtl2.x + rtl2.w * 0.85, rtl2.y + rtl2.h / 2);
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77, text: 'm' }, R.sid); await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM', windowsVirtualKeyCode: 77 }, R.sid); await sleep(400);
  await b.send('Input.insertText', { text: 'payment fails here' }, R.sid); await sleep(300);
  // Add to brief -> the edit is kept, the editor closes, the popup comes back
  const tSave = Date.now();
  await clickSel(R.sid, '#edSave');
  await sleep(700);
  const shadeOn = await evalIn(R.sid, `!!document.querySelector('.ed-capture')`).catch(() => false);
  await shot(R.sid, 'capture-shade.png').catch(() => {});
  let popup = null;
  for (let i = 0; i < 40 && !popup; i++) { await sleep(150); popup = (await b.send('Target.getTargets')).targetInfos.find((t) => t.url.endsWith('/popup.html')); }
  const saveMs = Date.now() - tSave;
  check('Add to brief is quick (~2s), the shade shows while stills are taken', shadeOn && saveMs < 4500, `${saveMs}ms`);
  const gone = !(await b.send('Target.getTargets')).targetInfos.some((t) => t.url.includes('/replay.html'));
  check('saving closes the editor and reopens the popup', gone && !!popup);
  const activeNow = await W(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(t => t[0]?.url || '')`);
  check('back on the tab the replay was opened from', activeNow.startsWith(`http://app.brief.localhost:${WEB}`), activeNow);
  const rep = await W(`(async () => {
    const d = (await chrome.storage.local.get('draft')).draft;
    const fsm = await import('./filestore.js');
    const j = JSON.parse(await (await fsm.getFile('replay:d-rep')).text());
    const v = await fsm.getFile('replayVoice:d-rep');
    const r = j.crop ? (j.crop.w * (j.events.find(e => e.type === 4).data.width)) / (j.crop.h * (j.events.find(e => e.type === 4).data.height)) : 0;
    const fr = await fsm.getFile('replayFrames:d-rep');
    const frameUrls = fr ? JSON.parse(await fr.text()) : [];
    return { marks: j.marks, frames: (j.frames || []).map(f => ({ file: f.file, url: f.url, note: f.note })), stills: frameUrls.length, stillOk: frameUrls.every(u => u.startsWith('data:image/jpeg')),
      poster: (d.replay?.poster || '').slice(0, 15), voice: d.replay?.voice, v: j.v, ratio: Number(r.toFixed(2)), off: j.voice?.offsetMs, voiceBlob: v ? v.type + ' ' + v.size : null, first: j.events[0].type, second: j.events[1].type, pay: JSON.stringify(j.events).includes('Payment failed') };
  })()`);
  check('replay keeps the mark, and a still of the marked moment', rep.marks?.length === 1 && rep.marks[0].note === 'payment fails here' && rep.frames.some((f) => f.note === 'Marked by the reporter: payment fails here'), JSON.stringify({ marks: rep.marks, notes: rep.frames.map((f) => f.note) }));
  check('key-moment stills for the agent, each with its page URL', rep.frames.length >= 2 && rep.stills === rep.frames.length && rep.stillOk && rep.frames.every((f) => /^http:\/\/(app\.)?brief\.localhost/.test(f.url || '')) && /Where it ends|Marked/.test(rep.frames[rep.frames.length - 1].note), JSON.stringify(rep.frames));
  check('replay kept with its crop (16:9) and voice-over, opens on a full snapshot, ends on the bug', rep.poster.startsWith('data:image/jpeg') && rep.voice && rep.v === 2 && rep.ratio === 1.78 && rep.off != null && /^audio\/webm \d+/.test(rep.voiceBlob || '') && rep.first === 4 && rep.second === 2 && rep.pay, JSON.stringify(rep));

  // re-open: crop and voice-over come back
  const R2 = await open(`chrome-extension://${extId}/replay.html#draft=d-rep`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, R2.sid);
  await focus(R2); await sleep(2500);
  const re = await evalIn(R2.sid, `({ save: document.querySelector('#edSave').textContent, marks: [...document.querySelectorAll('.tool')].map(t => !!t.querySelector('.dot') || t.classList.contains('has') || /^Voice 0:/.test(t.textContent.trim())) })`);
  check('re-opening the replay restores its crop and voice-over', re.save === 'Save' && JSON.stringify(re.marks) === '[true,true,true]', JSON.stringify(re));
  await b.send('Target.closeTarget', { targetId: R2.targetId });

  // the replay carries the page's network calls and console (custom events)
  const cap = await W(`(async () => {
    const fsm = await import('./filestore.js');
    const j = JSON.parse(await (await fsm.getFile('replay:d-rep')).text());
    const c = j.events.filter(e => e.type === 5 && e.data && e.data.tag === 'brief').map(e => e.data.payload);
    return { net: c.filter(p => p.kind === 'network'), cons: c.filter(p => p.kind === 'console-error').map(p => p.args.join(' ')) };
  })()`);
  const blobImg = await W(`(async () => {
    const fsm = await import('./filestore.js');
    const t = await (await fsm.getFile('replay:d-rep')).text();
    return { blob: t.includes('"blob:'), data: t.split('data:image/png;base64,').length - 1, events: JSON.parse(t).events.filter(e => e.type === 5 && e.data && e.data.tag === 'brief-blob').length };
  })()`);
  check('an image the page drew from a blob: URL is kept in the replay (even after the page revoked it)', !blobImg.blob && blobImg.data >= 1 && blobImg.events === 0, JSON.stringify(blobImg));
  const pay = (cap.net || []).find((n) => /\/api\/pay/.test(n.url));
  check('the replay records network calls with timing, secrets masked, and the console', !!pay && pay.status === 500 && pay.ms >= 1100 && /token=\*\*\*/.test(pay.url) && !/abc123/.test(pay.url) && /amount=5/.test(pay.url) && cap.cons.some((c) => /pay failed 500/.test(c)), JSON.stringify({ pay, cons: cap.cons }));
  check('a failed call keeps its trace id, clock time and masked bodies', !!pay && pay.trace === 'x-request-id: req-7f3a9c' && Math.abs(pay.at - Date.now()) < 10 * 60 * 1000 && /"amount":5/.test(pay.request || '') && /"password":"\*\*\*"/.test(pay.request || '') && !/hunter2/.test(pay.request || '') && /"error":"boom"/.test(pay.response || '') && !/s3cr3t/.test(pay.response || ''), JSON.stringify({ trace: pay?.trace, at: pay?.at, request: pay?.request, response: pay?.response }));
  // the replay is rendered to a video in the background (offscreen)
  let vid = null;
  for (let i = 0; i < 120 && !vid?.done; i++) {
    await sleep(1000);
    vid = await W(`(async () => { const d = (await chrome.storage.local.get('draft')).draft; const v = d?.replay?.video; return { done: v && v.status !== 'rendering', v }; })()`).catch(() => null);
  }
  const vblob = await W(`(async () => { const fsm = await import('./filestore.js'); const b = await fsm.getFile('replayVideo:d-rep'); if (!b) return null; const u8 = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return { type: b.type, size: b.size, b64: btoa(s) }; })()`);
  if (vblob?.b64) fs.writeFileSync(`${SCRATCH}/e2e-replay-video.webm`, Buffer.from(vblob.b64, 'base64'));
  check('the replay is turned into a video in the background', vid?.v?.status === 'ready' && vblob?.type === 'video/webm' && vblob.size > 2000, JSON.stringify({ v: vid?.v, type: vblob?.type, size: vblob?.size }));
  // filing sends the replay and its voice-over
  const files = await W(`(async () => {
    const realFetch = fetch; const seen = [];
    globalThis.fetch = async (u, o) => { seen.push({ u: String(u), body: o && o.body }); return new Response(JSON.stringify({ briefId: 'b1', uploads: { 'brief.json': { signedUrl: 'https://up.test/1' }, 'replay.json': { signedUrl: 'https://up.test/2' }, 'replay-voice.webm': { signedUrl: 'https://up.test/3' }, 'replay.webm': { signedUrl: 'https://up.test/v' }, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['replay-frames/frame-' + String(i + 1).padStart(2, '0') + '.jpg', { signedUrl: 'https://up.test/f' + i }])) } }), { status: 200 }); };
    await chrome.storage.local.set({ briefCloudToken: 'bxt_test' });
    const f = await import('./filing.js');
    try { await f.fileDraft('draft'); } catch (e) {}
    // a draft is handed off and filed in the background now: wait for it
    for (let i = 0; i < 80 && !seen.some(s => s.u.endsWith('/draft')); i++) await new Promise(r => setTimeout(r, 250));
    globalThis.fetch = realFetch;
    await chrome.storage.local.remove('briefCloudToken');
    const create = seen.find(s => s.u.endsWith('/api/briefs'));
    return { files: create ? JSON.parse(create.body).files : null };
  })()`);
  check('filing uploads replay.json, the voice-over, the video and the stills', files.files && files.files.slice(0, 4).join() === 'brief.json,replay.json,replay-voice.webm,replay.webm' && files.files.slice(4).every((f) => /^replay-frames\/frame-\d\d\.jpg$/.test(f)) && files.files.length > 5, JSON.stringify(files));
  // put the draft back for the popup checks
  await W(`(async () => { const d = (await chrome.storage.local.get('draft')).draft; if (!d?.replay) await chrome.storage.local.set({ draft: { id: 'd-rep', createdAt: Date.now(), screenshots: [], replay: { durationMs: 3000, sites: ['app.brief.localhost'], poster: null } } }); })()`);

  }
  // ================= popup =================
  const P = await open('about:blank');
  await b.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 600, deviceScaleFactor: 2, mobile: false }, P.sid);
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (location.pathname.endsWith('popup.html')) {
      const q = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (o) => (o && o.active) ? q({ url: 'http://app.brief.localhost:${WEB}/' }) : q(o);
      window.close = () => {};
    }` }, P.sid);
  await b.send('Page.navigate', { url: `chrome-extension://${extId}/popup.html` }, P.sid); await sleep(2000);
  const pop = await evalIn(P.sid, `({ gear: !!document.querySelector('#replaySettingsBtn'), section: !!document.querySelector('#replayPart'), foot: document.querySelector('.tile.rep .rec-foot')?.textContent, rep: !!document.querySelector('.tile.rep') })`);
  await evalIn(P.sid, `document.querySelector('[data-add]').click()`); await sleep(500);
  const ch = await evalIn(P.sid, `({ t: document.querySelector('#chRep .ct')?.textContent, s: document.querySelector('#chRep .cs')?.textContent })`);
  check('popup: Replay tile; + offers Replay (taken)', !pop.gear && !pop.section && pop.rep && /^Replay \d:\d\d$/.test(pop.foot || '') && ch.t === 'Replay' && ch.s === 'Already added', JSON.stringify({ pop, ch }));
  await evalIn(P.sid, `document.querySelector('#sheetClose').click()`); await sleep(500);
  // an empty brief: the Replay option names its shortcut
  const keep = await W(`chrome.storage.local.get('draft').then(r => r.draft)`);
  await W(`chrome.storage.local.set({ draft: { id: 'empty', createdAt: Date.now(), screenshots: [], description: '' } })`);
  await b.send('Page.reload', {}, P.sid); await sleep(1800);
  await evalIn(P.sid, `document.querySelector('[data-add]').click()`); await sleep(500);
  const ch2 = await evalIn(P.sid, `document.querySelector('#chRep .cs')?.textContent`);
  const mf = await W(`chrome.runtime.getManifest()`);
  check('no replay shortcut (only one-click report); right-click menu permission in place', ch2 === 'The last 60 seconds' && Object.keys(mf.commands || {}).join() === 'report-now' && mf.permissions.includes('contextMenus'), JSON.stringify({ ch2, commands: mf.commands || null }));
  await shot(P.sid, 'chooser-replay.png');
  await W(`chrome.storage.local.set({ draft: ${JSON.stringify(keep)} })`);
  await b.send('Page.reload', {}, P.sid); await sleep(1800);
  await evalIn(P.sid, `document.querySelector('[data-rep]').click()`); await sleep(600);
  const sh = await evalIn(P.sid, `({ t: document.querySelector('#sheetTitle').textContent, note: !!document.querySelector('#repNote'), play: !!document.querySelector('#repPlay'), on: document.querySelector('#repAttach')?.classList.contains('on') })`);
  await evalIn(P.sid, `(() => { const ta = document.querySelector('#repNote'); ta.value = 'watch tab 2'; ta.dispatchEvent(new Event('input')); })()`); await sleep(600);
  await evalIn(P.sid, `document.querySelector('#repAttach').click()`); await sleep(500);
  const dr = await W(`chrome.storage.local.get('draft').then(r => r.draft.replay)`);
  await shot(P.sid, 'replay-sheet.png');
  check('Replay tile opens a sheet like the recording: preview, note, attach switch', sh.t === 'Replay' && sh.note && sh.play && sh.on && dr.note === 'watch tab 2' && dr.attach === false, JSON.stringify({ sh, note: dr.note, attach: dr.attach }));

  check('no uncaught exceptions', exceptions.length === 0, JSON.stringify(exceptions).slice(0, 500));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
