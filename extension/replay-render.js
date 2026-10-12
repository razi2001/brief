// Brief - a replay, rendered to a video (runs in the offscreen document)
//
// A replay is page structure (rrweb), which a tracker can't play. This turns
// the saved edit (replay.json: trimmed, idle squeezed out, cropped) and its
// voice-over into a webm: VP9 video, Opus voice.
//
// How a frame is drawn: the replayed document is serialized as it is into an
// SVG <foreignObject> and painted by the browser. rrweb already holds the
// page's CSS as text, so nothing is computed per element (a DOM-to-canvas
// library that reads every computed style took ~11s a frame on a busy app
// page; this takes ~0.2s). Images and fonts become data: URLs once, reused.
// A frame is only redrawn when the page changed; a pointer move just moves
// the cursor over the last picture. Timestamps come from the replay, not the
// clock, so the video plays at normal speed however fast it was made.
//
// No requestAnimationFrame or timers anywhere: both are paused or throttled in
// a hidden document, which this is.

import { assetUrls } from './replay-assets.js';

const FPS = 10;
const MAX_W = 1600;
const BUDGET_MS = 4 * 60 * 1000; // give up rather than hold a ticket forever

let libs = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}
function loadLibs() {
  libs ??= (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/rrweb-player.css';
    document.head.appendChild(css);
    await loadScript('vendor/rrweb-player.min.js');
    await loadScript('vendor/webm-muxer.js');
  })();
  return libs;
}

// a yield that a hidden page doesn't throttle
const channel = new MessageChannel();
const waiters = [];
channel.port1.onmessage = () => waiters.shift()?.();
const tick = () => new Promise((r) => { waiters.push(r); channel.port2.postMessage(0); });

// ---------- assets: fetched once, as data: URLs ----------
const assets = new Map();
function dataUrlOf(url) {
  if (!assets.has(url)) {
    assets.set(url, (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return '';
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => resolve('');
          fr.readAsDataURL(blob);
        });
      } catch { return ''; }
    })());
  }
  return assets.get(url);
}

async function inlineUrls(html, base) {
  // only what the picture draws: never a link's target or a frame
  const found = assetUrls(html);
  // fetched all at once (one by one, a page's fonts and icons took ~5s)
  const swaps = await Promise.all([...found].map(async (raw) => {
    if (raw.startsWith('data:') || raw.startsWith('#')) return null;
    let abs;
    try { abs = new URL(raw.replace(/&amp;/g, '&'), base).href; } catch { return null; }
    // blob: URLs of the recorded page are gone
    return [raw, abs.startsWith('blob:') ? '' : await dataUrlOf(abs)];
  }));
  let out = html;
  for (const swap of swaps) if (swap) out = out.split(swap[0]).join(swap[1]);
  return out;
}

// ---------- one frame ----------
async function drawPage(doc, w, h) {
  // what a picture can't keep: scroll offsets and typed values
  const scrolled = [];
  for (const el of doc.querySelectorAll('*')) {
    if (el.scrollTop || el.scrollLeft) {
      el.setAttribute('data-brief-scroll', scrolled.length);
      scrolled.push([el.scrollLeft, el.scrollTop]);
    }
  }
  // (a field's state lives in properties; the picture is drawn from attributes)
  for (const el of doc.querySelectorAll('input:not([type=password]),textarea,select')) {
    if (el.tagName === 'TEXTAREA') el.textContent = el.value;
    else if (el.tagName === 'SELECT') for (const o of el.options) o.toggleAttribute('selected', o.selected);
    else if (el.type === 'checkbox' || el.type === 'radio') el.toggleAttribute('checked', el.checked);
    else el.setAttribute('value', el.value);
  }
  const root = doc.scrollingElement;
  const rx = root?.scrollLeft || 0, ry = root?.scrollTop || 0;
  let html = new XMLSerializer().serializeToString(doc.documentElement);
  for (const el of doc.querySelectorAll('[data-brief-scroll]')) el.removeAttribute('data-brief-scroll');

  const shift = scrolled.map(([x, y], i) => `[data-brief-scroll="${i}"]>*{transform:translate(${-x}px,${-y}px)}`).join('');
  html = html
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '') // the page's no-JS fallback text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head([^>]*)>/, `<head$1><style>${shift}html{transform:translate(${-rx}px,${-ry}px)}</style>`);
  html = await inlineUrls(html, doc.baseURI);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="100%" height="100%">${html}</foreignObject></svg>`;
  const img = new Image();
  // a data: URL, not a blob: one - the latter taints the canvas
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  return img;
}

// A picture that is one flat colour (a page not built yet).
function isBlank(img) {
  const c = new OffscreenCanvas(32, 18);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 32, 18);
  const px = g.getImageData(0, 0, 32, 18).data;
  for (let i = 4; i < px.length; i += 4) {
    if (Math.abs(px[i] - px[0]) + Math.abs(px[i + 1] - px[1]) + Math.abs(px[i + 2] - px[2]) > 24) return false;
  }
  return true;
}

function drawCursor(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 17); ctx.lineTo(4.5, 13); ctx.lineTo(8, 20);
  ctx.lineTo(10.5, 19); ctx.lineTo(7, 12); ctx.lineTo(12.5, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// events that can change what the page looks like (not pointer moves/touches)
const looks = (e) => e.type === 2 || (e.type === 3 && e.data?.source !== 1 && e.data?.source !== 6);

// ---------- the voice-over, as Opus ----------
async function encodeVoice(blob, offsetMs, endMs, muxer) {
  const ac = new OfflineAudioContext(1, 1, 48000);
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  const rate = buf.sampleRate;
  const pcm = buf.getChannelData(0);
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { throw e; } });
  enc.configure({ codec: 'opus', sampleRate: rate, numberOfChannels: 1, bitrate: 64000 });
  const step = Math.round(rate / 50); // 20ms
  const room = Math.max(0, Math.round(((endMs - offsetMs) / 1000) * rate));
  for (let i = 0; i < Math.min(pcm.length, room); i += step) {
    const data = pcm.subarray(i, Math.min(i + step, pcm.length));
    const frame = new AudioData({
      format: 'f32', sampleRate: rate, numberOfFrames: data.length, numberOfChannels: 1,
      timestamp: Math.round(offsetMs * 1000 + (i / rate) * 1e6), data,
    });
    enc.encode(frame);
    frame.close();
  }
  await enc.flush();
  enc.close();
  return rate;
}

/**
 * payload: the saved replay.json ({ events, crop, voice: { offsetMs } | null }).
 * voiceBlob: its voice-over (webm/opus) or null.
 * Resolves a video/webm Blob.
 */
// `stillsAt` (ms into the replay): pictures taken in the same pass, as JPEG
// data: URLs, handed to `onStill(index, dataUrl)` - the one-click report gets
// its key-moment stills this way, with no page on screen.
export async function renderReplay(payload, voiceBlob, { onProgress, stillsAt = [], onStill } = {}) {
  const started = performance.now();
  await loadLibs();
  const events = payload.events;
  const meta = events.find((e) => e.type === 4)?.data || { width: 1280, height: 800 };
  const W = meta.width, H = meta.height;

  // the crop, in page pixels, and the video size (even, at most MAX_W wide)
  const c = payload.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = c.x * W, sy = c.y * H, sw = Math.max(16, c.w * W), sh = Math.max(16, c.h * H);
  const k = Math.min(1, MAX_W / sw);
  const VW = Math.max(16, Math.round((sw * k) / 2) * 2), VH = Math.max(16, Math.round((sh * k) / 2) * 2);

  const stage = document.createElement('div');
  stage.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden`;
  document.body.appendChild(stage);
  const Player = window.rrwebPlayer.default || window.rrwebPlayer;
  // rrweb warns when a change points at a node outside its snapshot (normal
  // for a buffer that starts mid-session): it skips it and goes on - and the
  // warning lands in chrome://extensions as an error. Quiet.
  const player = new Player({
    target: stage,
    props: { events, width: W, height: H, autoPlay: false, showController: false, skipInactive: false, mouseTail: false, showWarning: false },
  });
  const rep = player.getReplayer();
  const total = player.getMetaData().totalTime;
  const t0 = events[0].timestamp;

  const canvas = new OffscreenCanvas(VW, VH);
  const ctx = canvas.getContext('2d');
  const { Muxer, ArrayBufferTarget } = window.WebMMuxer;
  const target = new ArrayBufferTarget();
  const withVoice = !!(voiceBlob && payload.voice);
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width: VW, height: VH, frameRate: FPS },
    ...(withVoice ? { audio: { codec: 'A_OPUS', sampleRate: 48000, numberOfChannels: 1 } } : {}),
    firstTimestampBehavior: 'permissive',
  });
  let encError = null;
  const enc = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: (e) => { encError = e; } });
  enc.configure({ codec: 'vp09.00.10.08', width: VW, height: VH, bitrate: 1_500_000, framerate: FPS });

  // rrweb shows the events strictly BEFORE the time it is asked for, and a
  // replay opens with the page's catch-up on its very first instant (a cut
  // pulls everything before it there): asked for 0 it shows the bare first
  // snapshot - the page as it was long before the part kept. A frame at t
  // shows everything up to t, as the change check below counts it.
  const at = (t) => rep.pause(t + 1);
  try {
    // The first frame is the video's thumbnail in a ticket: let the first
    // page finish building (stylesheets, fonts) before drawing it. A real
    // timer here, once - throttled in a hidden page, but only ~1s at worst.
    at(0);
    for (let i = 0; i < 5; i++) {
      const body = rep.iframe.contentDocument?.body;
      if (body && body.innerText.trim() && body.getBoundingClientRect().height > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const n = Math.max(1, Math.ceil((total / 1000) * FPS));
    let next = 0;
    let page = null;
    let lastSig = -1;
    let started0 = false;
    let encoded = 0;
    const pending = stillsAt.map((t, index) => ({ t, index })).sort((x, y) => x.t - y.t);
    const takeStill = async (index) => {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      const url = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
      if (url) onStill?.(index, url);
    };
    // Each field's state as the input events left it (ticked, typed, picked).
    // Seeking rebuilds the page through rrweb's virtual DOM, which doesn't
    // always carry it over, and a picture showing a box unticked that the
    // reporter ticked reads as a bug. Put back on the page before each draw.
    const fields = new Map();
    const applyFields = () => {
      const mirror = rep.getMirror?.();
      if (!mirror) return;
      for (const [id, d] of fields) {
        const el = mirror.getNode(id);
        if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '')) continue;
        try {
          if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!d.isChecked;
          else if (typeof d.text === 'string') el.value = d.text;
        } catch {}
      }
    };
    for (let i = 0; i <= n; i++) {
      if (encError) throw encError;
      if (performance.now() - started > BUDGET_MS) throw new Error('took too long');
      const t = Math.min(total, (i * 1000) / FPS);
      let changed = i === 0;
      while (next < events.length && events[next].timestamp - t0 <= t) {
        const e = events[next++];
        if (e.type === 2) fields.clear(); // a new page: its own nodes
        else if (e.type === 3 && e.data?.source === 5) fields.set(e.data.id, e.data);
        changed = looks(e) || changed;
      }
      at(t);
      await tick();
      applyFields();
      // The replayer also builds parts of the page on its own schedule (a
      // full snapshot waits for its stylesheets): a page that changed size
      // since the last picture is redrawn even with no event behind it.
      const doc = rep.iframe.contentDocument;
      const sig = doc?.documentElement ? doc.documentElement.outerHTML.length : 0;
      if (sig !== lastSig) { changed = true; lastSig = sig; }
      if (changed || !page) {
        try { page = await drawPage(doc, W, H); }
        catch (e) { if (!page) throw e; } // keep the last good picture
      }
      // The first frame is the ticket's thumbnail. A page that starts blank
      // (an app building itself) opens on its first real picture instead, as
      // long as that comes within the first second.
      if (!started0) {
        if (isBlank(page) && t < 1000) { onProgress?.(i / n); continue; }
        started0 = true;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VW, VH);
      ctx.drawImage(page, sx, sy, sw, sh, 0, 0, VW, VH);
      const mouse = stage.querySelector('.replayer-mouse');
      if (mouse && mouse.style.left) {
        const mx = parseFloat(mouse.style.left), my = parseFloat(mouse.style.top);
        if (isFinite(mx) && isFinite(my)) drawCursor(ctx, (mx - sx) * k, (my - sy) * k, Math.max(0.7, k));
      }
      const first = encoded === 0;
      const frame = new VideoFrame(canvas, { timestamp: first ? 0 : Math.round(t * 1000), duration: Math.round(1e6 / FPS) });
      enc.encode(frame, { keyFrame: first || i % (FPS * 2) === 0 });
      encoded++;
      frame.close();
      while (pending.length && pending[0].t <= t) await takeStill(pending.shift().index);
      onProgress?.(i / n);
    }
    // moments at the very end: the last picture
    while (pending.length) await takeStill(pending.shift().index);
    await enc.flush();
    if (withVoice) await encodeVoice(voiceBlob, payload.voice.offsetMs || 0, total, muxer);
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/webm' });
  } finally {
    try { enc.close(); } catch {}
    try { rep.destroy?.(); } catch {}
    stage.remove();
  }
}
