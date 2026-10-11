// Brief - the one-click report, built in the offscreen document (POC).
//
// Shortcut or right-click → the worker flushes the recorders and asks here.
// No page is opened: the last minute is rebuilt from the replay buffer, what
// looks wrong is found in it (suspects.js), and the replay is rendered once -
// the video and the key-moment stills in the same pass (replay-render.js
// draws pictures with no page on screen). Everything lands in IndexedDB under
// the new draft's id, exactly where the replay editor would have put it, so
// filing picks it up as usual.

import { readAll } from './replay-store.js';
import { buildTimeline, skipIdle, cutTimeline, inlineBlobImages } from './replay-merge.js';
import { completeFocus, stretches, keyMoments } from './replay-moments.js';
import { detectSuspects } from './suspects.js';
import { putFile, replayKey, replayFramesKey, replayVideoKey, replayVideoStateKey } from './filestore.js';
import { renderReplay } from './replay-render.js';

const WINDOW_MS = 60_000;
const isClick = (e) => e.type === 3 && e.data?.source === 2 && e.data?.type === 2;

export async function buildAutoReport({ draftId, at, focus = [] }) {
  const start = at - WINDOW_MS;
  const tabs = await readAll();
  const built = buildTimeline({ focus: completeFocus(focus, tabs, start), tabs, start, end: at });
  if (built.events.length < 2) return { ok: false, error: 'Nothing recorded in the last minute' };
  const view = skipIdle(built.events, built.segments, { end: at }); // idle squeezed out
  view.events = inlineBlobImages(view.events);

  const t0 = view.events[0].timestamp;
  const end = view.events[view.events.length - 1].timestamp - t0;
  // what looks wrong, each a moment with a still
  const suspects = detectSuspects(view.events, t0).map((s) => ({ t: s.t, note: s.note, auto: true }));
  const clicks = view.events.filter(isClick).map((e) => e.timestamp - t0);
  const moments = keyMoments({ a: 0, b: end }, view.segments, t0, clicks, suspects);

  const cut = cutTimeline(view.events, view.segments, [{ a: t0, b: t0 + end }]);
  const ct0 = cut.events[0].timestamp;
  const chips = stretches(cut.segments).map((c) => ({
    label: c.label, url: c.url || null, title: c.title || null, recorded: c.recorded, a: c.a - ct0, b: c.b - ct0,
  }));
  const urlAt = (ms) => view.segments.find((s) => t0 + ms >= s.a && t0 + ms < s.b)?.url || null;

  // the video and the stills, one pass. A page the renderer can't draw (some
  // do) costs the video and the stills, not the report: the replay, its steps
  // and what was noticed still go.
  const stills = [];
  let video = null;
  let renderError = null;
  try {
    video = await renderReplay(
      { v: 2, events: cut.events, crop: null, voice: null },
      null,
      { stillsAt: moments.map((m) => m.t), onStill: (i, url) => { stills[i] = url; } },
    );
  } catch (err) {
    renderError = String(err?.message || err);
  }
  const kept = moments.map((m, i) => ({ m, still: stills[i] })).filter((x) => x.still);

  const payload = {
    v: 2,
    events: cut.events,
    chips,
    durationMs: end,
    crop: null,
    voice: null,
    frames: kept.map(({ m }, i) => ({ file: `frame-${String(i + 1).padStart(2, '0')}.jpg`, t: m.t, url: urlAt(m.t), note: m.note })),
    marks: suspects,
    capturedAt: at,
    auto: true,
  };
  const rev = Date.now();
  const json = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  await putFile(replayKey(draftId), json);
  if (kept.length) await putFile(replayFramesKey(draftId), new Blob([JSON.stringify(kept.map((x) => x.still))], { type: 'application/json' }));
  if (video) {
    await putFile(replayVideoKey(draftId), video);
    await putFile(replayVideoStateKey(draftId), new Blob([JSON.stringify({ rev, status: 'ready', bytes: video.size })], { type: 'application/json' }));
  }

  return {
    ok: true,
    renderError,
    replay: {
      ...(video ? { video: { rev, status: 'ready', bytes: video.size } } : {}),
      addedAt: Date.now(),
      durationMs: end,
      sites: [...new Set(chips.filter((c) => c.recorded).map((c) => c.label))],
      bytes: json.size,
      poster: kept.length ? kept[kept.length - 1].still : null,
      voice: false,
      frames: kept.length,
    },
    suspects: suspects.length,
  };
}
