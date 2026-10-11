// Brief - the recording in its own tab, as an editor.
//
// Opened from the popup as player.html#<briefId>. Trim the ends, crop the frame
// to a format, drop the original sound and/or record a voice-over. Save bakes
// the edit into a new file (editor/video.js exportVideo) that replaces the
// recording and goes through the same upload path as a picked video file, so
// keyframes, poster and transcript are redone from the edited version.
//
// The popup can't host this: it is a fixed little window and dies on blur. This
// page reads the recording out of the shared blob store itself.

import { getFile, putFile, recKey } from './filestore.js';
import { getDraft, updateDraft, landRecording } from './draft.js';
import { buildPage, emptyStage, mountPlayback, marksTool, voiceButtons, busy, toast, closeEditor, ICON } from './editor/shell.js';
import { loadVideo, videoAdapter, filmstrip, exportVideo, posterOf } from './editor/video.js';
import { cropControl, renderFormats } from './editor/crop.js';
import { voiceState } from './editor/voice.js';
import { clock } from './editor/timeline.js';

const briefId = decodeURIComponent(location.hash.slice(1));
const page = buildPage({ title: 'Recording' });

(async () => {
  let blob = null;
  try { blob = briefId ? await getFile(recKey(briefId)) : null; } catch {}
  if (!blob) { emptyStage(page.stage, 'This recording is no longer on this device.'); page.save.hidden = true; return; }

  const loaded = await loadVideo(blob);
  const adapter = videoAdapter(page.stage, loaded);
  const voice = voiceState(loaded.video);
  let cropTool;
  const crop = cropControl(adapter.box, loaded.width, loaded.height, () => cropTool?.mark(crop.isCropped()));

  cropTool = page.addTool({
    icon: ICON.crop,
    label: 'Crop',
    onToggle: (on) => crop.setEditing(on),
    render: (opts) => renderFormats(opts, crop, () => cropTool.refresh()),
  });

  voiceButtons(page, voice, {
    withSound: true,
    start: () => {
      const { a, b } = playback.range;
      playback.resetSpeed();
      voice.record({
        startMs: a, endMs: b,
        seek: adapter.seek, play: adapter.play, pause: adapter.pause, playing: adapter.playing,
        onTick: adapter.time,
      }).catch((err) => toast(`Microphone unavailable: ${err?.message || err}`));
    },
  });


  const playback = mountPlayback({
    adapter,
    thumbs: filmstrip(blob, loaded.durationMs),
    onTick: (t, playing, kt) => voice.tick(kt, playing),
  });

  // where the bug is (times in this video)
  const draftNow = await getDraft();
  const marks = marksTool(page, playback, adapter, draftNow?.id === briefId ? draftNow.recording?.marks || [] : []);
  const marksBefore = JSON.stringify(marks.list);

  // edits to the picture or sound need a new file; marks alone don't
  const edited = () => {
    const { a, b } = playback.range;
    return a > 1 || b < loaded.durationMs - 1 || crop.isCropped() || !voice.original || !!voice.over;
  };

  page.save.addEventListener('click', async () => {
    if (voice.recording) return;
    if (!edited()) {
      if (JSON.stringify(marks.list) !== marksBefore) {
        await updateDraft(briefId, (x) => { if (x.recording) x.recording.marks = marks.list; });
      }
      closeEditor();
      return;
    }
    adapter.pause();
    page.save.disabled = true;
    const ui = busy('Saving');
    try {
      const range = playback.range;
      const out = await exportVideo(blob, range, crop.rect, { original: voice.original, over: voice.over }, (f) => ui.progress(f));
      const poster = await posterOf(out).catch(() => null);
      const d = await getDraft();
      if (!d || d.id !== briefId) throw new Error('This brief was filed or reset meanwhile.');
      await putFile(recKey(briefId), out);
      await updateDraft(briefId, (x) => {
        const source = x.recording?.source || 'capture';
        // where the kept part sits in the ORIGINAL capture (edits add up: a
        // second trim is relative to the first) - the capture's event log
        // (clicks, network, console) is on that clock and is shifted by it
        const before = x.recording?.trim;
        const off = before?.a || 0;
        landRecording(x, { uploading: true, durationMs: range.b - range.a, poster, source });
        x.recording.edited = true;
        x.recording.trim = { a: Math.round(off + range.a), b: Math.round(off + range.b) };
        // marks follow the trim: times in the new file
        x.recording.marks = marks.list.filter((m) => m.t >= range.a && m.t <= range.b).map((m) => ({ t: m.t - range.a, note: m.note }));
      });
      const res = await chrome.runtime.sendMessage({ type: 'UPLOAD_VIDEO_FILE', briefId, key: recKey(briefId), name: 'recording.webm', mimeType: 'video/webm' });
      if (!res?.ok) {
        await updateDraft(briefId, (x) => { x.uploading = false; x.transcribing = false; x.uploadFailed = true; x.uploadError = res?.error || 'upload failed'; });
      }
      ui.progress(1);
      closeEditor(400);
    } catch (err) {
      ui.done();
      page.save.disabled = false;
      toast(`Couldn’t save: ${err?.message || err}`);
    }
  });
})();
