// Brief - Replay, in the evidence editor (POC). Opens instantly: nothing is
// filmed, the page is re-drawn from the rrweb recording.
//
//   replay.html#at=<ms>&pick=<id>   the minute before <ms> from the browser-wide
//                                   buffer; "Add to brief" attaches the edit
//   replay.html#draft=<id>          the replay already attached; Save re-edits it
//
// Same editor as a recording: trim, crop (kept as a rectangle the players
// apply), and a voice-over recorded while it plays (replay-voice.webm). Idle
// stretches are always squeezed out; unwatched tabs are never recorded.

import { readAll } from './replay-store.js';
import { completeFocus, stretches, keyMoments } from './replay-moments.js';
import { buildTimeline, skipIdle, cutTimeline, inlineBlobImages } from './replay-merge.js';
import { putFile, getFile, deleteFile, replayKey, replayVoiceKey, replayFramesKey } from './filestore.js';
import { updateDraft } from './draft.js';
import { buildPage, emptyStage, mountPlayback, marksTool, voiceButtons, fitBox, busy, toast, closeEditor, ICON } from './editor/shell.js';
import { cropControl, renderFormats } from './editor/crop.js';
import { voiceState } from './editor/voice.js';
import { clock } from './editor/timeline.js';
import { isWatched } from './replay-sites.js';
import { APP_URL } from './config.js';

// Nothing in the buffer: say for which page (the tab this editor was opened
// from), and whether Replay is on for its site at all - the sites are set in
// Brief, Connections > Replay.
async function nothingRecorded(page) {
  page.save.hidden = true;
  const settings = { label: 'Set up Replay', href: `${APP_URL}/connections#replay` };
  let url = '';
  try {
    const me = await chrome.tabs.getCurrent();
    url = me?.openerTabId != null ? (await chrome.tabs.get(me.openerTabId)).url || '' : '';
  } catch {}
  let host = '';
  try { host = /^https?:/i.test(url) ? new URL(url).host : ''; } catch {}
  if (!host) emptyStage(page.stage, 'Nothing recorded in the last minute.', settings);
  else if (!(await isWatched(url))) emptyStage(page.stage, `Replay isn’t on for ${host}.`, { ...settings, label: 'Turn on Replay' });
  else emptyStage(page.stage, `Nothing recorded on ${host} in the last minute.`);
}

const WINDOW_MS = 60_000;
const THUMBS = 8;
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const Player = () => window.rrwebPlayer?.default || window.rrwebPlayer?.Player;

async function flushLiveTabs() {
  const { replayLiveTabs = [] } = await chrome.storage.session.get('replayLiveTabs');
  await Promise.all(replayLiveTabs.map((tabId) => withTimeout(
    chrome.tabs.sendMessage(tabId, { type: 'REPLAY_FLUSH' }, { frameId: 0 }).catch(() => {}), 1500)));
}

function replayAdapter(stage, events) {
  const meta = events.find((e) => e.type === 4)?.data || {};
  const w = meta.width || 1280, h = meta.height || 800;
  const box = document.createElement('div');
  box.className = 'media';
  stage.innerHTML = '';
  stage.appendChild(box);
  const size = fitBox(stage, w, h);
  box.style.width = `${size.width}px`;
  box.style.height = `${size.height}px`;
  const P = Player();
  const player = new P({
    target: box,
    props: { events, width: size.width, height: size.height, autoPlay: false, showController: false, skipInactive: false, mouseTail: false, showWarning: false },
  });
  const rep = player.getReplayer();
  const duration = player.getMetaData().totalTime;
  // rrweb shows the events strictly before the time it is asked for, and a
  // replay opens with the page's catch-up on its first instant (a trim pulls
  // everything before the cut there): at 0 it shows the bare first snapshot,
  // the page long before the part kept. 1ms in, it is right.
  const to = (ms) => Math.max(1, ms);
  player.goto(to(0), false);
  let playing = false;
  rep.on('finish', () => { playing = false; });
  new ResizeObserver(() => {
    const s = fitBox(stage, w, h);
    box.style.width = `${s.width}px`;
    box.style.height = `${s.height}px`;
    player.$set?.({ width: s.width, height: s.height });
    player.triggerResize?.();
  }).observe(stage);
  // A jump (goto) lands asynchronously: until it does, report where we are
  // going, or the editor would read the old time and undo the jump.
  let pending = null;
  const time = () => {
    const t = Math.min(duration, rep.getCurrentTime());
    if (pending != null) {
      if (Math.abs(t - pending) < 250) pending = null;
      else return pending;
    }
    return t;
  };
  return {
    box, width: w, height: h,
    duration,
    time,
    playing: () => playing,
    play: () => { const from = time(); playing = true; player.goto(to(from), true); },
    pause: () => { const at = time(); playing = false; player.pause(); pending = at; },
    seek: (ms) => { pending = Math.min(duration, Math.max(0, ms)); player.goto(to(pending), playing); },
    setSpeed: (n) => player.setSpeed?.(n),
  };
}

// Tiny live frames along the timeline: one paused mini-player per cell, made
// one after another so the editor is usable at once.
function liveCells(events, duration) {
  return {
    count: THUMBS,
    make: (cell, i, n) => setTimeout(() => {
      const r = cell.getBoundingClientRect();
      const P = Player();
      const p = new P({ target: cell, props: { events, width: Math.max(20, r.width), height: Math.max(20, r.height), autoPlay: false, showController: false, mouseTail: false, showWarning: false } });
      p.goto(((i + 0.5) / n) * duration, false);
    }, 150 + i * 120),
  };
}

// A still of what is on screen (inside the crop), for the popup tile.
async function grabPoster(box, crop, maxW = 1200) {
  try {
    const shot = await chrome.tabs.captureVisibleTab({ format: 'png' });
    const bmp = await createImageBitmap(await (await fetch(shot)).blob());
    const r = box.getBoundingClientRect();
    const k = bmp.width / window.innerWidth;
    const sx = (r.left + r.width * crop.x) * k, sy = (r.top + r.height * crop.y) * k;
    const sw = r.width * crop.w * k, sh = r.height * crop.h * k;
    const s = Math.min(1, maxW / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw * s);
    c.height = Math.round(sh * s);
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}


// While the stills are taken: everything but the picture fades back behind a
// label and a progress bar, so the jumps read as a step, not a glitch. The
// picture itself stays clear - it is what gets photographed.
function captureShade(box) {
  const r = box.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'ed-capture';
  el.innerHTML = `<div class="hole"></div><div class="cap-label"><span>Preparing for the agent</span><div class="bar"><i></i></div></div>`;
  const hole = el.firstChild;
  Object.assign(hole.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  el.lastChild.style.top = `${r.bottom + 18}px`;
  document.body.appendChild(el);
  return {
    progress(f) { el.querySelector('i').style.width = `${Math.round(f * 100)}%`; },
    done() { el.remove(); },
  };
}

(async () => {
  const q = new URLSearchParams(location.hash.slice(1));
  const draftMode = q.get('draft');
  const target = draftMode || q.get('pick');
  const page = buildPage({ title: 'Replay' });
  page.save.textContent = draftMode ? 'Save' : 'Add to brief';
  page.save.hidden = !target;

  let view; // { events, segments }
  let saved = null;
  let at = Date.now();
  if (draftMode) {
    const blob = await getFile(replayKey(draftMode));
    if (!blob) { emptyStage(page.stage, 'This replay is no longer on this device.'); page.save.hidden = true; return; }
    saved = JSON.parse(await blob.text());
    const t0 = saved.events[0].timestamp;
    view = { events: saved.events, segments: saved.chips.map((c) => ({ ...c, a: c.a + t0, b: c.b + t0 })) };
    at = saved.capturedAt || at;
  } else {
    at = Number(q.get('at')) || Date.now();
    const start = at - WINDOW_MS;
    await flushLiveTabs();
    const [tabs, { replayFocus = [] }] = await Promise.all([readAll(), chrome.storage.session.get('replayFocus')]);
    const built = buildTimeline({ focus: completeFocus(replayFocus, tabs, start), tabs, start, end: at });
    if (built.events.length < 2) { await nothingRecorded(page); return; }
    view = skipIdle(built.events, built.segments, { end: at }); // idle squeezed out
    // images the page drew from blob: URLs, back in place (they died with the page)
    view.events = inlineBlobImages(view.events);
  }

  const t0 = view.events[0].timestamp;
  const adapter = replayAdapter(page.stage, view.events);
  const voice = voiceState(null);
  voice.original = false; // a replay has no sound of its own
  let cropTool;
  const crop = cropControl(adapter.box, adapter.width, adapter.height, () => cropTool?.mark(crop.isCropped()));

  cropTool = page.addTool({
    icon: ICON.crop,
    label: 'Crop',
    onToggle: (on) => crop.setEditing(on),
    render: (opts) => renderFormats(opts, crop, () => cropTool.refresh()),
  });
  voiceButtons(page, voice, {
    withSound: false, // a replay has no sound of its own
    start: () => {
      const { a, b } = playback.range;
      playback.resetSpeed();
      voice.record({ startMs: a, endMs: b, seek: adapter.seek, play: adapter.play, pause: adapter.pause, playing: adapter.playing, onTick: adapter.time })
        .catch((err) => toast(`Microphone unavailable: ${err?.message || err}`));
    },
  });


  // re-opening an edit: put its crop and voice-over back
  if (saved?.crop) crop.setRect(saved.crop);
  if (saved?.voice) {
    const vb = await getFile(replayVoiceKey(draftMode)).catch(() => null);
    if (vb) voice.setOver(vb, saved.voice.offsetMs, saved.voice.durationMs);
  }

  const clicks = view.events.filter((e) => e.type === 3 && e.data?.source === 2 && e.data?.type === 2).map((e) => e.timestamp - t0);
  const playback = mountPlayback({
    adapter,
    cells: liveCells(view.events, adapter.duration),
    ticks: clicks,
    onTick: (t, playing, kt) => voice.tick(kt, playing),
  });
  // where the bug is: marks, on the replay's own timeline here
  const marks = marksTool(page, playback, adapter, (saved?.marks || []).map((m) => ({ t: m.t, note: m.note })));

  page.save.addEventListener('click', async () => {
    if (voice.recording) return;
    adapter.pause();
    page.save.disabled = true;
    const kept = playback.kept;
    const keptMs = kept.reduce((s, r) => s + (r.b - r.a), 0);
    // Stills of the key moments, for the agent to see (with the page URL at
    // each), the last one - where it ends, usually the bug - the tile's still.
    // Taken from the screen, so nothing covers the picture meanwhile.
    const range = { a: kept[0].a, b: kept[kept.length - 1].b };
    const frames = [];
    let poster = null;
    const moments = keyMoments(range, view.segments, t0, clicks, marks.list);
    const shade = captureShade(adapter.box);
    let lastShot = 0;
    for (const [i, m] of moments.entries()) {
      adapter.seek(m.t);
      // a paused seek paints at once; the wait is Chrome's 2-per-second limit
      await new Promise((r) => setTimeout(r, Math.max(120, 510 - (Date.now() - lastShot))));
      lastShot = Date.now();
      shade.progress((i + 1) / moments.length);
      const last = m === moments[moments.length - 1];
      const still = await grabPoster(adapter.box, crop.rect, last ? 1200 : 1000);
      if (!still) continue;
      if (last) poster = still;
      const seg = view.segments.find((s) => t0 + m.t >= s.a && t0 + m.t < s.b);
      frames.push({ t: Math.max(0, m.t - range.a), url: seg?.url || null, note: m.note, dataUrl: still });
    }
    shade.done();
    const ui = busy(draftMode ? 'Saving' : 'Adding to your brief');
    ui.progress(0.6);
    try {
      const cut = cutTimeline(view.events, view.segments, kept.map((r) => ({ a: t0 + r.a, b: t0 + r.b })));
      const ct0 = cut.events[0].timestamp;
      const chips = stretches(cut.segments).map((c) => ({
        label: c.label, url: c.url || null, title: c.title || null, recorded: c.recorded, a: c.a - ct0, b: c.b - ct0,
      }));
      const over = voice.over;
      const payload = {
        v: 2,
        events: cut.events,
        chips,
        durationMs: keptMs,
        crop: crop.isCropped() ? crop.rect : null,
        voice: over ? { offsetMs: over.startMs, durationMs: over.durationMs } : null,
        frames: frames.map((f, i) => ({ file: `frame-${String(i + 1).padStart(2, '0')}.jpg`, t: f.t, url: f.url, note: f.note })),
        marks: marks.list.filter((m) => m.t >= range.a && m.t <= range.b).map((m) => ({ t: m.t - range.a, note: m.note })),
        capturedAt: at,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      await putFile(replayKey(target), blob);
      if (over) await putFile(replayVoiceKey(target), over.blob);
      else await deleteFile(replayVoiceKey(target)).catch(() => {});
      await putFile(replayFramesKey(target), new Blob([JSON.stringify(frames.map((f) => f.dataUrl))], { type: 'application/json' }));
      const rev = Date.now();
      const ok = await updateDraft(target, (d) => {
        d.replay = {
          ...(d.replay || {}),
          video: { rev, status: 'rendering' },
          addedAt: Date.now(),
          durationMs: keptMs,
          sites: [...new Set(chips.filter((c) => c.recorded).map((c) => c.label))],
          bytes: blob.size,
          poster,
          voice: !!over,
          frames: frames.length,
        };
      });
      if (!ok) throw new Error('This brief was filed or reset meanwhile.');
      // the video is made in the background (offscreen); filing waits for it
      chrome.runtime.sendMessage({ type: 'RENDER_REPLAY', draftId: target, rev }).catch(() => {});
      ui.progress(1);
      closeEditor(350);
    } catch (err) {
      ui.done();
      page.save.disabled = false;
      toast(`Couldn’t save: ${err?.message || err}`);
    }
  });
})();
