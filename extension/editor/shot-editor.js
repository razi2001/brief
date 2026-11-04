// Brief - the screenshot editor, in the same shell as the recording's:
//
//   header  Screenshot · Cancel · Save
//   stage   the clean capture, the marks drawn over it, the crop
//   tools   Draw (pen, arrow, box, text; four colors; undo, clear) · Crop
//
// It runs in two places that differ only in where the result goes: over the
// page right after a capture (shot.html, in the page's overlay) and in its own
// tab from the popup (image.html). Marks are kept as strokes in the clean
// capture's pixels, so a screenshot stays editable: Save flattens them onto a
// copy, crops both, and hands back the picture, the cropped clean capture and
// the strokes moved with the crop.
//
// A text mark is a block in the color picked: { tool: 'text', color, size,
// text, points: [its top left corner] }. Its size is kept in the mark, so a
// crop doesn't shrink it.

import { ICON, fitBox, toast } from './shell.js';
import { cropControl, renderFormats } from './crop.js';

export const PEN_RED = '#ff2d2d';
const COLORS = [['#ff2d2d', 'Red'], ['#ffb020', 'Yellow'], ['#2f7bff', 'Blue'], ['#22c55e', 'Green']];
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SHAPES = [
  ['pen', 'Pen', svg('<path d="M3 21c3-1 4.5-3 6-6s3.5-6 7-8 4.5 1.5 2.5 4-6 5-9 7"/>')],
  ['arrow', 'Arrow', svg('<path d="M5 19 19 5M10 5h9v9"/>')],
  ['box', 'Box', svg('<rect x="4" y="6" width="16" height="12" rx="2"/>')],
  ['text', 'Text', svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>')],
];
const DRAW_ICON = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
const UNDO_ICON = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>');

// ---- text blocks ----
export const TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// the size a new block gets: it reads the same at any capture size, and still
// reads once a ticket shows the picture smaller
export const textSize = (natW) => Math.max(14, Math.round(natW / 50));
const textBox = (size) => ({ padX: size * 0.45, padY: size * 0.3, lh: size * 1.25, radius: size * 0.3 });
// white words on red and blue, dark ones on yellow and green
export function textInk(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#fff';
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.3 ? '#1a1612' : '#fff';
}
// a line wider than `room` breaks between words, a word wider than it anywhere
function wrapLine(ctx, line, room, out) {
  if (ctx.measureText(line).width <= room) { out.push(line); return; }
  let cur = '';
  for (const word of line.split(/(?<=\s)/)) {
    if (ctx.measureText(cur + word).width <= room) { cur += word; continue; }
    if (cur) out.push(cur.trimEnd());
    let w = word;
    while (w.length > 1 && ctx.measureText(w).width > room) {
      let n = w.length - 1;
      while (n > 1 && ctx.measureText(w.slice(0, n)).width > room) n--;
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    cur = w;
  }
  out.push(cur.trimEnd());
}
// Where a text block sits and how big it is, in the capture's pixels. It is
// never wider than the capture (`maxW`): longer lines wrap.
export function textLayout(ctx, s, maxW) {
  const size = s.size || 20;
  const { padX, padY, lh, radius } = textBox(size);
  ctx.font = `600 ${size}px ${TEXT_FONT}`;
  const lines = [];
  const room = Math.max(size, maxW - padX * 2);
  for (const raw of String(s.text || '').split('\n')) wrapLine(ctx, raw, room, lines);
  const widest = Math.max(size * 0.6, ...lines.map((l) => ctx.measureText(l).width));
  const p = s.points[0];
  return { x: p.x, y: p.y, w: widest + padX * 2, h: lines.length * lh + padY * 2, lines, size, padX, padY, lh, radius };
}
function paintText(ctx, s, maxW) {
  const L = textLayout(ctx, s, maxW);
  const c = s.color || PEN_RED;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = L.size * 0.5;
  ctx.shadowOffsetY = L.size * 0.08;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.roundRect(L.x, L.y, L.w, L.h, L.radius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = textInk(c);
  // each line centered in its line box, the way the text field lays it out
  const m = ctx.measureText('Hg');
  const asc = m.fontBoundingBoxAscent ?? L.size * 0.8;
  const desc = m.fontBoundingBoxDescent ?? L.size * 0.2;
  ctx.textBaseline = 'alphabetic';
  L.lines.forEach((line, i) => ctx.fillText(line, L.x + L.padX, L.y + L.padY + i * L.lh + (L.lh - asc - desc) / 2 + asc));
  ctx.restore();
}

// The marks, onto a canvas at the capture's own size. Strokes saved before
// shapes existed have neither tool nor color: a red pen.
export function paintStrokes(ctx, strokes, natW) {
  // Stroke width scales with image size so it reads at any resolution.
  const w = Math.max(3, Math.round(natW / 300));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  // Subtle dark halo so every color reads on light AND dark pages.
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = Math.max(2, w * 0.6);
  for (const s of strokes) {
    const c = s.color || PEN_RED;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    const [a, b] = s.points || [];
    if (!a) continue;
    if (s.tool === 'text') {
      if (String(s.text || '').trim()) paintText(ctx, s, natW);
      continue;
    }
    if (s.tool === 'box' || s.tool === 'arrow') {
      if (!b) continue;
      ctx.beginPath();
      if (s.tool === 'box') {
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        // the shaft, then the head at the end it points to
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.min(Math.max(w * 4.5, 16), Math.hypot(b.x - a.x, b.y - a.y) * 0.6);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.moveTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      }
      ctx.stroke();
      continue;
    }
    if (s.points.length < 2) {
      ctx.beginPath(); // a dot
      ctx.arc(a.x, a.y, w / 1.5, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * image    the clean capture, loaded (an <img>)
 * strokes  the marks already made, in the image's pixels
 * onSave({ dataUrl, annotated, strokes, cleanBlob, cropped })   async
 * onCancel()
 */
export function mountShotEditor(page, { image, strokes: initial = [], onSave, onCancel }) {
  const natW = image.naturalWidth, natH = image.naturalHeight;
  let strokes = (initial || []).filter((s) => s && Array.isArray(s.points)).map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) }));
  // Always the pen to start with; the last color picked comes back.
  let tool = 'pen';
  let color = PEN_RED;
  try { const s = JSON.parse(localStorage.getItem('briefPen') || '{}'); if (COLORS.some(([c]) => c === s.color)) color = s.color; } catch {}
  const remember = () => { try { localStorage.setItem('briefPen', JSON.stringify({ color })); } catch {} };

  // ---- the stage: the capture, the marks over it, the crop over both ----
  const box = document.createElement('div');
  box.className = 'media shot-media';
  image.className = 'pic';
  image.draggable = false;
  box.appendChild(image);
  const ink = document.createElement('canvas');
  ink.className = 'ink';
  ink.width = natW;
  ink.height = natH;
  box.appendChild(ink);
  page.stage.innerHTML = '';
  page.stage.appendChild(box);
  let placeEditor = () => {};
  const fit = () => { const s = fitBox(page.stage, natW, natH); box.style.width = `${s.width}px`; box.style.height = `${s.height}px`; placeEditor(); };
  fit();
  new ResizeObserver(fit).observe(page.stage);
  const ictx = ink.getContext('2d');

  let drawTool;
  // the text block being typed shows as a field, not on the canvas
  let editing = null; // { s, el }
  const paint = () => {
    ictx.clearRect(0, 0, natW, natH);
    paintStrokes(ictx, editing ? strokes.filter((s) => s !== editing.s) : strokes, natW);
  };
  const redraw = () => {
    paint();
    drawTool?.mark(strokes.length > 0);
    drawTool?.refresh(); // Undo / Clear follow what there is to undo
  };

  // ---- text: typed in a field on the picture, a block once done ----
  // keep the whole block on the picture
  const fitText = (s) => {
    const L = textLayout(ictx, s, natW);
    const p = s.points[0];
    p.x = Math.max(0, Math.min(p.x, natW - L.w));
    p.y = Math.max(0, Math.min(p.y, natH - L.h));
    return { ...L, x: p.x, y: p.y };
  };
  placeEditor = () => {
    if (!editing) return;
    const { s, el } = editing;
    s.text = el.value;
    const L = fitText(s);
    const k = box.clientWidth / natW;
    Object.assign(el.style, {
      left: `${L.x * k}px`, top: `${L.y * k}px`, width: `${L.w * k + 3}px`, height: `${L.h * k}px`,
      fontSize: `${L.size * k}px`, lineHeight: `${L.lh * k}px`, padding: `${L.padY * k}px ${L.padX * k}px`,
      borderRadius: `${L.radius * k}px`, background: s.color, color: textInk(s.color),
    });
  };
  // done typing: an empty block goes away
  const closeText = () => {
    if (!editing) return;
    const { s, el } = editing;
    editing = null;
    s.text = el.value.replace(/\s+$/, '');
    el.remove();
    const i = strokes.indexOf(s);
    if (!s.text.trim()) { if (i >= 0) strokes.splice(i, 1); }
    else if (i < 0) strokes.push(s);
    redraw();
  };
  const openText = (s) => {
    closeText();
    const el = document.createElement('textarea');
    el.className = 'text-edit';
    el.spellcheck = false;
    el.value = s.text || '';
    ink.after(el); // under the crop's shade, like the marks
    editing = { s, el };
    placeEditor();
    paint();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.addEventListener('input', placeEditor);
    // Enter or Esc is done (Shift+Enter is a new line); so is a click elsewhere
    el.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); closeText(); }
    });
    // (switching to another window keeps it open: the field gets focus back)
    el.addEventListener('blur', () => { if (document.hasFocus()) closeText(); });
  };
  const textAt = (p) => {
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.tool !== 'text' || s === editing?.s || !s.points[0]) continue;
      const L = textLayout(ictx, s, natW);
      if (p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h) return s;
    }
    return null;
  };

  // ---- drawing ----
  let drawingOn = false;
  let dragging = false;
  // the Text tool: a click on the picture starts a block, on a block edits it,
  // a drag moves it
  let grab = null; // { s, p0, from, moved }
  const at = (e) => {
    const r = ink.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * natW, y: ((e.clientY - r.top) / r.height) * natH };
  };
  ink.addEventListener('pointerdown', (e) => {
    if (!drawingOn || (e.button !== undefined && e.button !== 0)) return;
    if (tool === 'text') {
      const p = at(e);
      const hit = textAt(p);
      // a click away from the block being typed just finishes it
      if (editing) { closeText(); if (!hit) return; }
      ink.setPointerCapture(e.pointerId);
      grab = { s: hit, p0: p, from: hit && { ...hit.points[0] }, moved: false };
      return;
    }
    dragging = true;
    ink.setPointerCapture(e.pointerId);
    strokes.push({ tool, color, points: [at(e)] });
    redraw();
  });
  ink.addEventListener('pointermove', (e) => {
    if (grab) {
      if (!grab.s) return;
      const p = at(e);
      const dx = p.x - grab.p0.x, dy = p.y - grab.p0.y;
      if (!grab.moved && Math.hypot(dx, dy) < natW / 200) return;
      grab.moved = true;
      grab.s.points[0] = { x: grab.from.x + dx, y: grab.from.y + dy };
      fitText(grab.s);
      paint();
      return;
    }
    if (!dragging) {
      if (drawingOn && tool === 'text') ink.style.cursor = textAt(at(e)) ? 'move' : '';
      return;
    }
    const s = strokes[strokes.length - 1];
    if (s.tool === 'pen') s.points.push(at(e));
    else s.points[1] = at(e); // a shape: just where it ends
    paint();
  });
  const end = (e) => {
    if (grab) {
      const g = grab;
      grab = null;
      if (e.type === 'pointercancel' || g.moved) { redraw(); return; }
      if (g.s) { openText(g.s); return; }
      // a new block, its first line where the click was
      const size = textSize(natW);
      const { padX, padY, lh } = textBox(size);
      openText({ tool: 'text', color, size, text: '', points: [{ x: g.p0.x - padX, y: g.p0.y - padY - lh / 2 }] });
      return;
    }
    if (!dragging) return;
    dragging = false;
    // a click with the arrow or the box draws nothing: drop it
    const s = strokes[strokes.length - 1];
    const [a, b] = s?.points || [];
    if (s && s.tool !== 'pen' && (!b || Math.hypot(b.x - a.x, b.y - a.y) < natW / 200)) strokes.pop();
    redraw();
  };
  ink.addEventListener('pointerup', end);
  ink.addEventListener('pointercancel', end);
  const undo = () => { closeText(); if (strokes.length) { strokes.pop(); redraw(); } };
  const clear = () => { closeText(); if (strokes.length) { strokes = []; redraw(); } };

  // the Draw tool's options: the shape, the color, then undo / clear
  const renderDraw = (opts) => {
    const add = (html, title, on, onClick, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `opt${on ? ' on' : ''}`;
      b.innerHTML = html;
      b.title = title;
      b.setAttribute('aria-label', title);
      if (on !== null) b.setAttribute('aria-pressed', String(!!on));
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      opts.appendChild(b);
    };
    const sep = () => opts.insertAdjacentHTML('beforeend', '<span class="vsep"></span>');
    const pick = (k) => {
      if (k !== tool) closeText();
      tool = k;
      box.classList.toggle('texting', k === 'text');
      ink.style.cursor = '';
      drawTool.refresh();
    };
    for (const [k, label, icon] of SHAPES) add(`${icon}<span>${label}</span>`, label, tool === k, () => pick(k));
    sep();
    // a color picked while typing recolors that block (the buttons never take focus)
    const recolor = (c) => {
      color = c;
      remember();
      if (editing) { editing.s.color = c; placeEditor(); }
      drawTool.refresh();
    };
    for (const [c, label] of COLORS) add(`<i class="swatch" style="background:${c}"></i>`, label, color === c, () => recolor(c));
    sep();
    add(UNDO_ICON, 'Undo', null, undo, !strokes.length);
    add(ICON.trash, 'Clear', null, clear, !strokes.length);
  };

  let cropTool;
  const crop = cropControl(box, natW, natH, () => cropTool?.mark(crop.isCropped()));
  drawTool = page.addTool({
    icon: DRAW_ICON,
    label: 'Draw',
    onToggle: (on) => { if (!on) closeText(); drawingOn = on; box.classList.toggle('drawing', on); },
    render: renderDraw,
  });
  cropTool = page.addTool({
    icon: ICON.crop,
    label: 'Crop',
    onToggle: (on) => crop.setEditing(on),
    render: (opts) => renderFormats(opts, crop, () => cropTool.refresh()),
  });
  // start with the pen in hand
  drawTool.el.click();
  redraw();

  // ---- save: flatten, crop, hand back ----
  const result = async () => {
    const r = crop.rect;
    const cropped = crop.isCropped();
    const px = cropped
      ? { x: Math.round(r.x * natW), y: Math.round(r.y * natH), w: Math.max(1, Math.round(r.w * natW)), h: Math.max(1, Math.round(r.h * natH)) }
      : { x: 0, y: 0, w: natW, h: natH };
    const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const clean = canvas(px.w, px.h);
    clean.getContext('2d').drawImage(image, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
    const moved = strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x - px.x, y: p.y - px.y })) }));
    const flat = canvas(px.w, px.h);
    const fctx = flat.getContext('2d');
    fctx.drawImage(clean, 0, 0);
    // the marks keep the width they had on the whole capture
    fctx.save();
    paintStrokes(fctx, moved, natW);
    fctx.restore();
    const cleanBlob = await new Promise((res) => clean.toBlob(res, 'image/png'));
    return { dataUrl: flat.toDataURL('image/png'), annotated: strokes.length > 0, strokes: moved, cleanBlob, cropped };
  };
  let saving = false;
  const save = async () => {
    if (saving) return;
    closeText(); // the block being typed is part of it
    saving = true;
    page.save.disabled = true;
    try { await onSave(await result()); }
    catch (err) { saving = false; page.save.disabled = false; toast(`Couldn’t save: ${err?.message || err}`); }
  };
  page.save.addEventListener('click', save);

  // Esc cancels, Enter saves, Ctrl/Cmd+Z undoes
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
    else if (e.key === 'Enter') { e.preventDefault(); save(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });
}
