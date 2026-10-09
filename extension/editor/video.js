// Brief - the video side of the editor: loading, playback adapter, filmstrip,
// and the export that bakes the edit (trim, crop, sound) into a new file.

import { fitBox } from './shell.js';

const once = (el, ev) => new Promise((r) => el.addEventListener(ev, r, { once: true }));

// MediaRecorder webm carries no duration: ask for the end and read where it lands.
async function realDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  v.currentTime = 1e9;
  await once(v, 'seeked');
  const d = v.duration;
  v.currentTime = 0;
  await once(v, 'seeked');
  return Number.isFinite(d) ? d : v.currentTime;
}

export async function loadVideo(blob) {
  const v = document.createElement('video');
  v.src = URL.createObjectURL(blob);
  v.preload = 'auto';
  v.playsInline = true;
  await once(v, 'loadedmetadata');
  const seconds = await realDuration(v);
  return { video: v, durationMs: Math.round(seconds * 1000), width: v.videoWidth, height: v.videoHeight };
}

// Puts the video on the stage, sized to fit; returns the playback adapter and
// the box the crop overlay goes on.
export function videoAdapter(stage, loaded) {
  const { video: v, durationMs, width, height } = loaded;
  stage.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'media';
  box.appendChild(v);
  stage.appendChild(box);
  const fit = () => { const s = fitBox(stage, width, height); box.style.width = `${s.width}px`; box.style.height = `${s.height}px`; };
  fit();
  new ResizeObserver(fit).observe(stage);
  return {
    box,
    duration: durationMs,
    time: () => v.currentTime * 1000,
    playing: () => !v.paused && !v.ended,
    play: () => v.play().catch(() => {}),
    pause: () => v.pause(),
    seek: (ms) => { v.currentTime = Math.min(durationMs, Math.max(0, ms)) / 1000; },
    setSpeed: (n) => { v.playbackRate = n; },
  };
}

export async function filmstrip(blob, durationMs, count = 12, height = 48) {
  const { video: v, width, height: vh } = await loadVideo(blob);
  const c = document.createElement('canvas');
  c.height = height * 2;
  c.width = Math.round((width / vh) * c.height);
  const ctx = c.getContext('2d');
  const out = [];
  for (let i = 0; i < count; i++) {
    v.currentTime = ((i + 0.5) / count) * (durationMs / 1000);
    await once(v, 'seeked');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/jpeg', 0.7));
  }
  URL.revokeObjectURL(v.src);
  return out;
}

// Re-records the kept range through a canvas (cropped) in real time, with the
// sound the edit asks for: the original (or silence) plus the voice-over.
//   range  {a, b} ms   crop {x, y, w, h} 0..1
//   sound  { original: bool, over: { blob, startMs } | null }
export async function exportVideo(blob, range, crop, sound, onProgress) {
  const { video: v, width, height } = await loadVideo(blob);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const W = even(width * crop.w), H = even(height * crop.h);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const ac = new AudioContext();
  await ac.resume().catch(() => {});
  const dest = ac.createMediaStreamDestination();
  const orig = ac.createGain();
  orig.gain.value = sound.original ? 1 : 0;
  ac.createMediaElementSource(v).connect(orig).connect(dest); // into the file, not the speakers
  let overBuf = null;
  if (sound.over) overBuf = await ac.decodeAudioData(await sound.over.blob.arrayBuffer());

  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const draw = () => ctx.drawImage(v, crop.x * width, crop.y * height, crop.w * width, crop.h * height, 0, 0, W, H);
  let drawing = true;
  const frame = () => { if (!drawing) return; draw(); v.requestVideoFrameCallback(frame); };

  v.currentTime = range.a / 1000;
  await once(v, 'seeked');
  draw();
  v.requestVideoFrameCallback(frame);
  rec.start(250);
  await v.play();
  if (overBuf) {
    const src = ac.createBufferSource();
    src.buffer = overBuf;
    src.connect(dest);
    const lead = sound.over.startMs / 1000; // kept time: 0 = the first kept frame
    src.start(ac.currentTime + Math.max(0, lead), Math.max(0, -lead));
  }
  const total = range.b - range.a;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      const t = v.currentTime * 1000;
      onProgress?.((t - range.a) / total);
      if (t >= range.b || v.ended) { clearInterval(iv); resolve(); }
    }, 20);
  });
  v.pause();
  drawing = false;
  const stopped = once(rec, 'stop');
  rec.stop();
  await stopped;
  ac.close().catch(() => {});
  URL.revokeObjectURL(v.src);
  onProgress?.(1);
  return new Blob(chunks, { type: 'video/webm' });
}

// A first-frame still for the popup tile.
export async function posterOf(blob) {
  const { video: v, width, height } = await loadVideo(blob);
  v.currentTime = 0.05;
  await once(v, 'seeked');
  const c = document.createElement('canvas');
  const s = Math.min(1, 1200 / width);
  c.width = Math.round(width * s); c.height = Math.round(height * s);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  URL.revokeObjectURL(v.src);
  return c.toDataURL('image/jpeg', 0.9);
}
