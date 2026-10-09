// Brief - the recording's sound: keep or drop the original, and record a
// voice-over with the mic while the kept part plays (original muted meanwhile,
// so the mic doesn't pick it up). The voice-over is placed at the time the take
// started; the editor plays it in sync and the export mixes it in.

export function voiceState(video) {
  const audio = new Audio();
  const state = {
    original: true,
    over: null, // { blob, url, startMs, durationMs }
    recording: null,
    listeners: new Set(),
  };
  const emit = () => state.listeners.forEach((f) => f());

  state.applyMute = () => { if (video) video.muted = !state.original || !!state.recording; };
  state.setOriginal = (on) => { state.original = on; state.applyMute(); emit(); };
  state.clearOver = () => {
    if (state.over) URL.revokeObjectURL(state.over.url);
    state.over = null;
    audio.removeAttribute('src');
    emit();
  };

  // A voice-over saved earlier (re-opening an edit).
  state.setOver = (blob, startMs, durationMs) => {
    if (state.over) URL.revokeObjectURL(state.over.url);
    state.over = { blob, url: URL.createObjectURL(blob), startMs, durationMs };
    audio.src = state.over.url;
    emit();
  };

  // Keep the voice-over aligned while previewing. `tMs` is KEPT time (cut
  // pieces skipped), which is how the saved edit will play.
  state.tick = (tMs, playing) => {
    const o = state.over;
    if (!o || state.recording) { if (!audio.paused) audio.pause(); return; }
    const rel = (tMs - o.startMs) / 1000;
    const inside = rel >= 0 && rel < o.durationMs / 1000;
    if (playing && inside) {
      if (Math.abs(audio.currentTime - rel) > 0.25) audio.currentTime = rel;
      if (audio.paused) audio.play().catch(() => {});
    } else if (!audio.paused) audio.pause();
  };

  // Record over [startMs, endMs] of the source. `play`/`pause`/`seek` drive the video.
  state.record = async ({ startMs, endMs, seek, play, pause, onTick, playing }) => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const rec = new MediaRecorder(mic, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; pause(); rec.stop(); };
    state.recording = { stop, startedAt: Date.now() };
    state.applyMute();
    emit();
    seek(startMs);
    await new Promise((r) => setTimeout(r, 120));
    rec.start(200);
    const t0 = Date.now();
    play();
    const iv = setInterval(() => {
      const t = onTick();
      if (t >= endMs - 30 || (playing && Date.now() - t0 > 600 && !playing())) stop();
    }, 50);
    await done;
    clearInterval(iv);
    mic.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const durationMs = Date.now() - t0;
    state.recording = null;
    if (state.over) URL.revokeObjectURL(state.over.url);
    // a take always starts with the kept part: 0 on the kept timeline
    state.over = { blob, url: URL.createObjectURL(blob), startMs: 0, durationMs };
    audio.src = state.over.url;
    state.applyMute();
    emit();
  };

  return state;
}
