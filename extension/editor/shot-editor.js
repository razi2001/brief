// Brief - the screenshot editor, in the same shell as the recording's:
//
//   header  Screenshot · Cancel · Save
//   stage   the clean capture, the marks drawn over it, the crop
//   tools   Draw (pen, arrow, box; four colors; undo, clear) · Crop
//
// It runs in two places that differ only in where the result goes: over the
// page right after a capture (shot.html, in the page's overlay) and in its own
// tab from the popup (image.html). Marks are kept as strokes in the clean
// capture's pixels, so a screenshot stays editable: Save flattens them onto a
// copy, crops both, and hands back the picture, the cropped clean capture and
// the strokes moved with the crop.

import { ICON, fitBox, toast } from './shell.js';
import { cropControl, renderFormats } from './crop.js';

export const PEN_RED = '#ff2d2d';
const COLORS = [['#ff2d2d', 'Red'], ['#ffb020', 'Yellow'], ['#2f7bff', 'Blue'], ['#22c55e', 'Green']];
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SHAPES = [
  ['pen', 'Pen', svg('<path d="M3 21c3-1 4.5-3 6-6s3.5-6 7-8 4.5 1.5 2.5 4-6 5-9 7"/>')],
  ['arrow', 'Arrow', svg('<path d="M5 19 19 5M10 5h9v9"/>')],
  ['box', 'Box', svg('<rect x="4" y="6" width="16" height="12" rx="2"/>')],
];
const DRAW_ICON = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
const UNDO_ICON = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>');

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
  const fit = () => { const s = fitBox(page.stage, natW, natH); box.style.width = `${s.width}px`; box.style.height = `${s.height}px`; };
  fit();
  new ResizeObserver(fit).observe(page.stage);
  const ictx = ink.getContext('2d');

  let drawTool;
  const redraw = () => {
    ictx.clearRect(0, 0, natW, natH);
    paintStrokes(ictx, strokes, natW);
    drawTool?.mark(strokes.length > 0);
    drawTool?.refresh(); // Undo / Clear follow what there is to undo
  };

  // ---- drawing ----
  let drawingOn = false;
  let dragging = false;
  const at = (e) => {
    const r = ink.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * natW, y: ((e.clientY - r.top) / r.height) * natH };
  };
  ink.addEventListener('pointerdown', (e) => {
    if (!drawingOn || (e.button !== undefined && e.button !== 0)) return;
    dragging = true;
    ink.setPointerCapture(e.pointerId);
    strokes.push({ tool, color, points: [at(e)] });
    redraw();
  });
  ink.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = strokes[strokes.length - 1];
    if (s.tool === 'pen') s.points.push(at(e));
    else s.points[1] = at(e); // a shape: just where it ends
    ictx.clearRect(0, 0, natW, natH);
    paintStrokes(ictx, strokes, natW);
  });
  const end = () => {
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
  const undo = () => { if (strokes.length) { strokes.pop(); redraw(); } };
  const clear = () => { if (strokes.length) { strokes = []; redraw(); } };

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
    for (const [k, label, icon] of SHAPES) add(`${icon}<span>${label}</span>`, label, tool === k, () => { tool = k; drawTool.refresh(); });
    sep();
    for (const [c, label] of COLORS) add(`<i class="swatch" style="background:${c}"></i>`, label, color === c, () => { color = c; remember(); drawTool.refresh(); });
    sep();
    add(UNDO_ICON, 'Undo', null, undo, !strokes.length);
    add(ICON.trash, 'Clear', null, clear, !strokes.length);
  };

  let cropTool;
  const crop = cropControl(box, natW, natH, () => cropTool?.mark(crop.isCropped()));
  drawTool = page.addTool({
    icon: DRAW_ICON,
    label: 'Draw',
    onToggle: (on) => { drawingOn = on; box.classList.toggle('drawing', on); },
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
