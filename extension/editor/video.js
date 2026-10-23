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

// Bakes the edit into a new file: the kept range, cropped, with the sound the
// edit asks for (the original or silence, plus the voice-over).
//   range  {a, b} ms   crop {x, y, w, h} 0..1
//   sound  { original: bool, over: { blob, startMs } | null }
// The fast way reads the frames straight out of the file and encodes them as
// fast as the machine goes (seconds for a minute of video); a file it can't
// read (a picked .mp4 or .mov) is played and re-recorded in real time.
export async function exportVideo(blob, range, crop, sound, onProgress) {
  try {
    return await exportFast(blob, range, crop, sound, onProgress);
  } catch (err) {
    console.warn('[brief/editor] fast export failed, exporting in real time:', err?.message || err);
    onProgress?.(0);
    return exportRealtime(blob, range, crop, sound, onProgress);
  }
}

// ---------- the fast way: WebCodecs ----------

// A Matroska/WebM reader, just enough for what MediaRecorder (and the export
// below) writes: the video track's codec and size, and its frames with their
// times. Segments and clusters may have an unknown size, so the file is walked
// flat: containers are entered, everything else is read or skipped.
const EBML = { Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1 };
const CONTAINERS = new Set([EBML.Segment, EBML.Info, EBML.Tracks, EBML.TrackEntry, EBML.Video, EBML.Cluster, EBML.BlockGroup]);

function readWebm(buf) {
  const b = new Uint8Array(buf);
  const vint = (p, keepMarker) => {
    const first = b[p];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    if (len > 8) throw new Error('bad EBML');
    let v = keepMarker ? first : first & (0xff >> len);
    let allOnes = (first & (0xff >> len)) === (0xff >> len);
    for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
    return { v, len, unknown: !keepMarker && allOnes };
  };
  const uint = (p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
  const tracks = [];
  let track = null, scale = 1e6, cluster = 0;
  const frames = [];
  let p = 0;
  // the EBML header first
  const head = vint(p, true); if (head.v !== 0x1a45dfa3) throw new Error('not WebM');
  const hs = vint(p + head.len); p += head.len + hs.len + hs.v;
  while (p < b.length - 2) {
    const id = vint(p, true); const sz = vint(p + id.len);
    const data = p + id.len + sz.len;
    if (CONTAINERS.has(id.v)) {
      if (id.v === EBML.TrackEntry) tracks.push(track = {});
      p = data; // entered, not skipped
      continue;
    }
    if (sz.unknown) throw new Error('unknown-size element');
    const n = sz.v;
    if (data + n > b.length) break; // a cut-off tail
    switch (id.v) {
      case EBML.TimecodeScale: scale = uint(data, n); break;
      case EBML.TrackNumber: if (track) track.number = uint(data, n); break;
      case EBML.TrackType: if (track) track.type = uint(data, n); break;
      case EBML.CodecID: if (track) track.codec = new TextDecoder().decode(b.subarray(data, data + n)); break;
      case EBML.PixelWidth: if (track) track.width = uint(data, n); break;
      case EBML.PixelHeight: if (track) track.height = uint(data, n); break;
      case EBML.Timecode: cluster = uint(data, n); break;
      case EBML.SimpleBlock: case EBML.Block: {
        const tn = vint(data);
        const rel = ((b[data + tn.len] << 8) | b[data + tn.len + 1]) << 16 >> 16; // signed 16-bit
        const flags = b[data + tn.len + 2];
        if (flags & 0x06) throw new Error('laced block');
        frames.push({ track: tn.v, ms: ((cluster + rel) * scale) / 1e6, data: b.subarray(data + tn.len + 3, data + n) });
        break;
      }
    }
    p = data + n;
  }
  const video = tracks.find((t) => t.type === 1 || /^V_/.test(t.codec || ''));
  if (!video) throw new Error('no video track');
  return { video, frames: frames.filter((f) => f.track === video.number) };
}

// Keyframes, from the bitstream itself (container flags differ by writer).
function isKey(codec, d) {
  if (codec === 'V_VP8') return (d[0] & 1) === 0;
  // VP9: frame_marker(2) profile(2) [reserved(1) at profile 3] show_existing(1) frame_type(1)
  let bit = 0;
  const read = () => (d[bit >> 3] >> (7 - (bit++ & 7))) & 1;
  read(); read();
  const profile = read() | (read() << 1);
  if (profile === 3) read();
  if (read()) return false; // shows an existing frame
  return read() === 0;
}

let muxerLib = null;
function loadMuxer() {
  muxerLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/webm-muxer.js';
    s.onload = () => resolve(window.WebMMuxer);
    s.onerror = () => reject(new Error('could not load the muxer'));
    document.head.appendChild(s);
  });
  return muxerLib;
}

// The sound, mixed offline (no playback): the original's kept range (or
// silence) plus the voice-over where it was recorded.
async function mixSound(blob, range, sound, rate) {
  const len = Math.max(1, Math.ceil(((range.b - range.a) / 1000) * rate));
  const ctx = new OfflineAudioContext(2, len, rate);
  const decode = async (b) => new OfflineAudioContext(2, 1, rate).decodeAudioData(await b.arrayBuffer());
  if (sound.original) {
    try {
      const src = ctx.createBufferSource();
      src.buffer = await decode(blob);
      src.connect(ctx.destination);
      src.start(0, range.a / 1000);
    } catch { /* no sound track: silence */ }
  }
  if (sound.over) {
    const src = ctx.createBufferSource();
    src.buffer = await decode(sound.over.blob);
    src.connect(ctx.destination);
    const lead = sound.over.startMs / 1000; // kept time: 0 = the first kept frame
    src.start(Math.max(0, lead), Math.max(0, -lead));
  }
  return ctx.startRendering();
}

async function exportFast(blob, range, crop, sound, onProgress) {
  if (!('VideoDecoder' in window) || !('VideoEncoder' in window) || !('AudioEncoder' in window)) throw new Error('no WebCodecs');
  const { video: track, frames } = readWebm(await blob.arrayBuffer());
  const codec = { V_VP8: 'vp8', V_VP9: 'vp09.00.10.08' }[track.codec];
  if (!codec || !frames.length) throw new Error(`can't read ${track.codec || 'this video'}`);
  const width = track.width, height = track.height;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const W = even(width * crop.w), H = even(height * crop.h);
  const RATE = 48000;

  const { Muxer, ArrayBufferTarget } = await loadMuxer();
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width: W, height: H, frameRate: 30 },
    audio: { codec: 'A_OPUS', sampleRate: RATE, numberOfChannels: 2 },
    firstTimestampBehavior: 'permissive',
  });
  let failed = null;
  const fail = (e) => { failed ??= e; };

  // sound first: it is quick, and the muxer holds it until the video catches up
  const mixed = await mixSound(blob, range, sound, RATE);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: fail });
  aenc.configure({ codec: 'opus', sampleRate: RATE, numberOfChannels: 2, bitrate: 128_000 });
  const L = mixed.getChannelData(0), R = mixed.getChannelData(1);
  for (let i = 0; i < mixed.length; i += 960) { // 20ms
    const n = Math.min(960, mixed.length - i);
    const pcm = new Float32Array(n * 2);
    pcm.set(L.subarray(i, i + n), 0);
    pcm.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / RATE) * 1e6), data: pcm });
    aenc.encode(ad);
    ad.close();
  }
  await aenc.flush();
  aenc.close();
  onProgress?.(0.05);

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: fail });
  // near what the recording was made at (1.2 Mbps): a bigger file only uploads slower
  const vcfg = { codec: 'vp09.00.10.08', width: W, height: H, bitrate: 1_500_000, framerate: 30, latencyMode: 'realtime' };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error('no VP9 encoder');
  venc.configure(vcfg);
  let lastKey = -Infinity;
  const span = Math.max(1, range.b - range.a);
  const decoded = [];
  const vdec = new VideoDecoder({ output: (f) => decoded.push(f), error: fail });
  vdec.configure({ codec, codedWidth: width, codedHeight: height });
  // a decoded frame: kept ones are cropped and encoded, the rest dropped
  const take = async () => {
    while (decoded.length) {
      const f = decoded.shift();
      const ms = f.timestamp / 1000;
      if (ms >= range.a && ms < range.b) {
        const t = ms - range.a;
        ctx.drawImage(f, crop.x * f.displayWidth, crop.y * f.displayHeight, crop.w * f.displayWidth, crop.h * f.displayHeight, 0, 0, W, H);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(t * 1000) });
        const key = t - lastKey >= 2000;
        if (key) lastKey = t;
        venc.encode(vf, { keyFrame: key });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => venc.addEventListener('dequeue', r, { once: true }));
        onProgress?.(0.05 + 0.93 * Math.min(1, t / span));
      }
      f.close();
    }
  };

  // start at the last keyframe at or before the cut
  let start = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].ms > range.a) break;
    if (isKey(track.codec, frames[i].data)) start = i;
  }
  if (!isKey(track.codec, frames[start].data)) throw new Error('no keyframe to start from');
  for (let i = start; i < frames.length && frames[i].ms < range.b; i++) {
    if (failed) throw failed;
    const fr = frames[i];
    vdec.decode(new EncodedVideoChunk({ type: i === start || isKey(track.codec, fr.data) ? 'key' : 'delta', timestamp: Math.round(fr.ms * 1000), data: fr.data }));
    while (vdec.decodeQueueSize > 4) await new Promise((r) => vdec.addEventListener('dequeue', r, { once: true }));
    await take();
  }
  await vdec.flush();
  await take();
  vdec.close();
  await venc.flush();
  venc.close();
  if (failed) throw failed;
  muxer.finalize();
  onProgress?.(1);
  return new Blob([target.buffer], { type: 'video/webm' });
}

// ---------- the real-time way: play it through a canvas and re-record ----------
async function exportRealtime(blob, range, crop, sound, onProgress) {
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
