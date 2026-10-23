// Brief - editor shell. One quiet layout for every kind of evidence:
//
//   header   title · Cancel · Save
//   stage    the media (recording, replay, screenshot)
//   tools    a small pill (Draw, Crop, Voice) with its options popping above it
//   time     play · trim strip · clock          (timed media only)
//
// Timed media plug in as an adapter { duration, time(), playing(), play(),
// pause(), seek(ms) }; playback stays inside the kept range.

import { createTimeline, clock } from './timeline.js';

export const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6"/></svg>',
};

// `onCancel`: what Cancel does when the editor isn't a tab of its own (the
// screenshot editor over a page); a tab closes itself.
export function buildPage({ title, timed = true, onCancel }) {
  document.body.innerHTML = `
    <header class="ed-head">
      <h1 class="ed-title">${title}</h1>
      <button class="link" id="edCancel" type="button">Cancel</button>
      <button class="save" id="edSave" type="button">Save</button>
    </header>
    <main class="ed-stage" id="edStage"></main>
    <div class="ed-tools" id="edTools"><div class="opts" id="edOpts" hidden></div><div class="pillbar" id="edPill" hidden></div></div>
    ${timed ? `<div class="ed-time" id="edTime" hidden>
      <button class="play" id="edPlay" type="button" aria-label="Play">${ICON.play}</button>
      <div id="edTimeline"></div>
      <span class="clock" id="edClock"></span>
      <button class="speed" id="edSpeed" type="button" title="Playback speed">1\u00d7</button>
    </div>` : ''}`;
  const $ = (id) => document.getElementById(id);
  $('edCancel').addEventListener('click', () => (onCancel ? onCancel() : closeEditor()));
  // A clicked button keeping focus would swallow the next Space (it "presses"
  // the button instead of playing): buttons here never take focus.
  document.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }, true);
  // Nor may the replayed page (an iframe): focus there takes every key with it.
  const reclaim = () => setTimeout(() => {
    if (document.activeElement?.tagName === 'IFRAME') { document.activeElement.blur(); window.focus(); }
  });
  window.addEventListener('blur', reclaim);
  reclaim();
  const pill = $('edPill');
  const opts = $('edOpts');
  let openTool = null;
  return {
    stage: $('edStage'),
    save: $('edSave'),
    // A tool in the pill. Its options (built by `render(opts)`) show above the
    // pill while it is on; one tool on at a time.
    // A plain button in the pill: one click does the thing, no options row.
    addAction({ onClick }) {
      pill.hidden = false;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.addEventListener('click', (e) => onClick(e));
      pill.appendChild(b);
      return b;
    },
    addTool({ icon, label, render, onToggle }) {
      pill.hidden = false;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.innerHTML = `${icon}<span>${label}</span>`;
      const tool = {
        el: b,
        set on(v) { b.classList.toggle('on', v); },
        mark(v) { // a dot when the tool has changed something
          b.querySelector('.dot')?.remove();
          if (v) b.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
        },
        refresh() { if (openTool === tool) { opts.innerHTML = ''; render(opts); } },
      };
      b.addEventListener('click', () => {
        const opening = openTool !== tool;
        if (openTool) { openTool.on = false; openTool.onClose?.(); }
        openTool = opening ? tool : null;
        tool.on = opening;
        opts.innerHTML = '';
        opts.hidden = !opening;
        if (opening) render(opts);
        onToggle?.(opening);
        if (!opening) tool.onClose?.();
      });
      tool.onClose = () => onToggle?.(false);
      pill.appendChild(b);
      return tool;
    },
  };
}

// Leave the editor and bring the Brief popup back with the brief in it. The
// worker closes this tab itself (see EDITOR_CLOSED) so the popup opens only
// once the tab is gone; window.close() is the fallback if it can't.
export async function closeEditor(delay = 0) {
  const me = await chrome.tabs.getCurrent().catch(() => null);
  chrome.runtime.sendMessage({ type: 'EDITOR_CLOSED', delay, backTo: me?.openerTabId ?? null, windowId: me?.windowId ?? null }).catch(() => {});
  setTimeout(() => window.close(), delay + 1500);
}

// Sound, as direct buttons in the pill (no options row):
//   Sound on / Sound off   the recording's own sound (video only)
//   Record voice           one click records a voice-over over the kept part;
//                          while recording "Stop 0:04"; after, "Voice 0:04" with
//                          an x to delete it (click the label to record again)
export function voiceButtons(page, voice, { withSound, start }) {
  let sound = null;
  if (withSound) {
    sound = page.addAction({ onClick: () => voice.setOriginal(!voice.original) });
  }
  const rec = page.addAction({
    onClick: (e) => {
      if (e.target.closest('.vx')) { voice.clearOver(); return; }
      if (voice.recording) { voice.recording.stop(); return; }
      start();
    },
  });
  let tick = null;
  const draw = () => {
    if (sound) {
      sound.innerHTML = voice.original ? `${ICON.speaker}<span>Sound on</span>` : `${ICON.muted}<span>Sound off</span>`;
      sound.classList.toggle('off', !voice.original);
      sound.title = voice.original ? 'Mute the recording' : 'Bring the recording\u2019s sound back';
    }
    clearInterval(tick);
    rec.classList.toggle('recording', !!voice.recording);
    if (voice.recording) {
      const t0 = Date.now();
      const label = () => { rec.innerHTML = `<i class="rdot"></i><span>Stop ${clock(Date.now() - t0)}</span>`; };
      label();
      tick = setInterval(label, 250);
      rec.title = 'Stop recording';
    } else if (voice.over) {
      rec.innerHTML = `${ICON.voice}<span>Voice ${clock(voice.over.durationMs)}</span><span class="vx" title="Delete the voice-over">\u00d7</span>`;
      rec.title = 'Record again';
    } else {
      rec.innerHTML = `${ICON.voice}<span>Record voice</span>`;
      rec.title = 'Record your voice over the video';
    }
  };
  voice.listeners.add(draw);
  draw();
}

// `action` ({ label, href }, optional): a way out, opened in a new tab.
export function emptyStage(stage, text, action) {
  stage.innerHTML = '<div class="empty-box"><p class="empty"></p></div>';
  stage.querySelector('.empty').textContent = text;
  if (action) {
    const a = document.createElement('a');
    a.className = 'empty-act';
    a.href = action.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = action.label;
    stage.firstChild.appendChild(a);
  }
}

// Size a box of the media's aspect ratio to fit the stage, with room around it.
export function fitBox(stage, w, h, pad = 32) {
  const r = stage.getBoundingClientRect();
  const s = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h);
  return { width: Math.max(80, Math.round(w * s)), height: Math.max(60, Math.round(h * s)) };
}

// Play button, trim strip and clock for timed media.
// The kept pieces (the trimmed range) drive playback: it jumps over what is
// cut and stops at the end. The clock and `onTick`'s third argument run on the
// KEPT timeline - what the saved edit will play.
const keptBefore = (kept, t) => kept.reduce((s, r) => s + Math.max(0, Math.min(t, r.b) - r.a), 0);

export function mountPlayback({ adapter, thumbs, cells, ticks, onRange, onTick }) {
  const $ = (id) => document.getElementById(id);
  const D = adapter.duration;
  $('edTime').hidden = false;
  const playBtn = $('edPlay');
  const clockEl = $('edClock');
  // watching speed only: what is saved keeps its own pace
  const SPEEDS = [1, 1.5, 2];
  let speed = 0;
  const speedBtn = $('edSpeed');
  speedBtn.hidden = !adapter.setSpeed;
  speedBtn.addEventListener('click', () => {
    speed = (speed + 1) % SPEEDS.length;
    adapter.setSpeed?.(SPEEDS[speed]);
    speedBtn.textContent = `${SPEEDS[speed]}\u00d7`;
    speedBtn.classList.toggle('on', speed > 0);
  });
  const tl = createTimeline($('edTimeline'), {
    duration: D,
    onSeek: (t) => { if (adapter.playing()) adapter.pause(); adapter.seek(t); },
    onChange: (r) => onRange?.(r),
  });
  thumbs?.then((urls) => urls?.length && tl.setThumbs(urls)).catch(() => {});
  if (cells) tl.setCells(cells.count, cells.make);
  if (ticks?.length) tl.setTicks(ticks);
  // where playback should be: inside a kept piece as is, in a cut the start of
  // the next piece, past the end null
  const playable = (t) => {
    for (const r of tl.kept) { if (t < r.a) return r.a; if (t < r.b) return t; }
    return null;
  };

  const toggle = () => {
    if (adapter.playing()) { adapter.pause(); return; }
    const kept = tl.kept;
    const t = adapter.time();
    const p = t >= kept[kept.length - 1].b - 60 ? null : playable(t);
    adapter.seek(p ?? kept[0].a);
    adapter.play();
  };
  playBtn.addEventListener('click', toggle);
  // clicking the picture plays / pauses too (not while cropping)
  adapter.box?.addEventListener('click', (e) => { if (!e.target.closest('.crop-layer.editing')) toggle(); });
  // capture phase: Space reaches us before anything focused can eat it
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) toggle(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (adapter.playing()) adapter.pause();
      adapter.seek(Math.min(D, Math.max(0, adapter.time() + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5000 : 1000))));
    }
  }, true);

  let was = null;
  (function loop() {
    const t = adapter.time();
    const playing = adapter.playing();
    const kept = tl.kept;
    if (playing) {
      const p = playable(t);
      if (p == null) { adapter.pause(); adapter.seek(kept[0].a); }
      else if (p - t > 40) adapter.seek(p);
    }
    tl.setHead(t);
    const kt = keptBefore(kept, t);
    clockEl.innerHTML = `${clock(kt)} <span>/ ${clock(keptBefore(kept, Infinity))}</span>`;
    onTick?.(t, playing, kt);
    if (playing !== was) { playBtn.innerHTML = playing ? ICON.pause : ICON.play; playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play'); was = playing; }
    requestAnimationFrame(loop);
  })();

  return {
    get range() { return tl.range; },
    get kept() { return tl.kept; },
    setMarks: (marks, onPick) => tl.setMarks(marks, onPick),
    // a voice-over is recorded at real speed
    resetSpeed() { speed = 0; adapter.setSpeed?.(1); speedBtn.textContent = '1\u00d7'; speedBtn.classList.remove('on'); },
  };
}

// Mark: flag where the bug is, so the agent looks there. The tool drops a mark
// at the playhead (M does too); each mark can carry a short note. Times are on
// the source timeline; callers map them to the saved cut.
// Mark: one click (or M) pauses, drops a flag at the playhead and opens its
// note right on the flag. Click a flag to jump there and edit / remove it.
export function marksTool(page, playback, adapter, initial = []) {
  let marks = initial.map((m) => ({ t: m.t, note: m.note || '' }));
  const api = { onChange: null, get list() { return [...marks].sort((a, b) => a.t - b.t); } };
  let bubble = null;
  const closeBubble = () => { bubble?.remove(); bubble = null; };
  const flagOf = (m) => document.querySelectorAll('.tl-mark')[api.list.indexOf(m)];
  const pick = (m) => { if (adapter.playing()) adapter.pause(); adapter.seek(m.t); openBubble(m); };
  const draw = () => {
    playback.setMarks(api.list, pick);
    btn.classList.toggle('has', marks.length > 0);
    btn.innerHTML = `${ICON.flag}<span>${marks.length ? `Mark \u00b7 ${marks.length}` : 'Mark'}</span>`;
    api.onChange?.();
  };
  const place = (m) => {
    const f = flagOf(m);
    if (!bubble || !f) return;
    const r = f.getBoundingClientRect();
    const w = bubble.offsetWidth;
    const x = Math.min(window.innerWidth - w - 12, Math.max(12, r.left - w / 2));
    bubble.style.left = `${x}px`;
    bubble.style.top = `${r.top - bubble.offsetHeight - 10}px`;
    bubble.style.setProperty('--tip', `${r.left + 1 - x}px`);
  };
  function openBubble(m) {
    closeBubble();
    bubble = document.createElement('div');
    bubble.className = 'mark-pop';
    bubble.innerHTML = `<input class="mark-note" placeholder="What goes wrong" spellcheck="false"><button type="button" class="mx" title="Remove the mark">${ICON.trash}</button>`;
    const input = bubble.querySelector('input');
    input.value = m.note;
    input.addEventListener('input', () => { m.note = input.value; playback.setMarks(api.list, pick); place(m); api.onChange?.(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBubble(); }
    });
    bubble.querySelector('.mx').addEventListener('click', () => { marks = marks.filter((x) => x !== m); closeBubble(); draw(); });
    bubble.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(bubble);
    place(m);
    input.focus();
  }
  const add = () => {
    const t = adapter.time();
    if (adapter.playing()) adapter.pause();
    let m = marks.find((x) => Math.abs(x.t - t) < 400);
    if (!m) { m = { t, note: '' }; marks.push(m); }
    draw();
    openBubble(m);
  };
  const btn = page.addAction({ onClick: add });
  btn.title = 'Mark this moment (M)';
  document.addEventListener('pointerdown', (e) => { if (bubble && !e.target.closest('.tl-mark, .mark-pop')) closeBubble(); });
  window.addEventListener('resize', closeBubble);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); add(); }
  }, true);
  draw();
  return api;
}

export function busy(title) {
  const el = document.createElement('div');
  el.className = 'ed-busy';
  el.innerHTML = '<div class="t"></div><div class="bar"><i></i></div>';
  el.querySelector('.t').textContent = title;
  document.body.appendChild(el);
  return {
    progress(f) { el.querySelector('i').style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`; },
    done() { el.remove(); },
  };
}

export function toast(text, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
