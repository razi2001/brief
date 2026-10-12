  // ---- a trimmed replay opens on the part kept ----
  // The page below shows its own clock (tenths of a second as ten black/white
  // cells). It is recorded, trimmed to 4-7s the way the editor's Save cuts it,
  // rendered the way the offscreen document does, and reopened in the editor.
  // A cut pulls everything before it onto its first instant, and rrweb applies
  // that catch-up only past 0: the video's first frame (a ticket's thumbnail)
  // and the reopened editor showed the page as it was when the recording began.
  const P = await open(`chrome-extension://${extId}/player.html#none`); await focus(P);
  const recorded = await evalIn(P.sid, `(async () => {
    const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    await load('vendor/rrweb-record.min.js');
    document.body.innerHTML = '<div id="cells" style="display:flex;gap:6px;padding:10px"></div><h1 id="lbl" style="color:#fff;font:48px sans-serif;margin:20px"></h1>';
    document.body.style.cssText = 'margin:0;background:#808080';
    const cells = [...Array(10)].map(() => { const c = document.createElement('div'); c.style.cssText = 'width:56px;height:56px;background:#000'; document.getElementById('cells').appendChild(c); return c; });
    const t0 = Date.now();
    const paint = () => { const ds = Math.round((Date.now() - t0) / 100); cells.forEach((c, i) => { c.style.background = (ds >> i) & 1 ? '#fff' : '#000'; }); document.getElementById('lbl').textContent = 't=' + (ds / 10).toFixed(1) + 's'; };
    paint();
    const events = [];
    const stop = window.rrwebRecord.record({ emit: (e) => events.push(e) });
    const iv = setInterval(paint, 100);
    await new Promise((r) => setTimeout(r, 9000));
    clearInterval(iv); stop();
    // trimmed to 4-7s and saved on a draft, as the editor's Save leaves it
    const { cutTimeline } = await import('./replay-merge.js');
    const fsm = await import('./filestore.js');
    const s0 = events[0].timestamp;
    const cut = cutTimeline(events, [{ a: s0, b: events[events.length - 1].timestamp, recorded: true }], [{ a: s0 + 4000, b: s0 + 7000 }]);
    const ct0 = cut.events[0].timestamp;
    const payload = { v: 2, events: cut.events, chips: [{ label: 'test', url: null, title: null, recorded: true, a: 0, b: cut.events[cut.events.length - 1].timestamp - ct0 }], durationMs: 3000, crop: null, voice: null, frames: [], marks: [], capturedAt: Date.now() };
    await fsm.putFile(fsm.replayKey('d-trim'), new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    await chrome.storage.local.set({ draft: { id: 'd-trim', createdAt: Date.now(), screenshots: [], description: '', replay: { durationMs: 3000, frames: 0, sites: [] } } });
    window.payload = payload;
    return events.length;
  })()`);
  check('recorded a page that shows its own clock', recorded > 50, `${recorded} events`);

  // the video: what each frame shows, read off its cells
  const vid = await evalIn(P.sid, `(async () => {
    document.body.innerHTML = '';
    const { renderReplay } = await import('./replay-render.js');
    const blob = await renderReplay(window.payload, null);
    const v = document.createElement('video'); v.src = URL.createObjectURL(blob); v.muted = true;
    await new Promise((r) => v.onloadedmetadata = r);
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d');
    const out = [];
    for (const t of [0.02, 0.5, 1.5, 2.8]) {
      v.currentTime = t; await new Promise((r) => v.onseeked = r);
      g.drawImage(v, 0, 0);
      let ds = 0;
      for (let i = 0; i < 10; i++) if (g.getImageData(38 + i * 62, 38, 1, 1).data[0] > 128) ds |= 1 << i;
      out.push(ds / 10);
    }
    return out;
  })()`);
  check('the trimmed replay’s video opens on the part kept, not the start of the recording', vid[0] >= 3.8 && vid[0] <= 4.1 && vid[1] > 4.2 && vid[1] < 4.8 && vid[3] > 6.4 && vid[3] < 7.1, JSON.stringify(vid));

  // the editor, reopening the saved replay: paused at 0:00
  const E = await open(`chrome-extension://${extId}/replay.html#draft=d-trim`); await focus(E); await sleep(2500);
  const ed = await evalIn(E.sid, `(() => {
    const doc = document.querySelector('#edStage .media iframe').contentDocument;
    let ds = 0;
    [...doc.getElementById('cells').children].forEach((c, i) => { if (/255/.test(doc.defaultView.getComputedStyle(c).backgroundColor)) ds |= 1 << i; });
    return { shows: ds / 10, clock: document.querySelector('#edClock').textContent };
  })()`);
  check('reopened in the editor, it opens on the part kept', ed.shows >= 3.8 && ed.shows <= 4.1 && /^0:00/.test(ed.clock), JSON.stringify(ed));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
