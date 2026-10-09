// Brief - crop the frame: a rectangle over the media, everything outside dimmed.
// Normalized to the media (x, y, w, h in 0..1). A format (16:9, 1:1...) locks
// the rectangle's shape in real pixels; Free lets it take any shape.

export const FORMATS = [
  { key: 'free', label: 'Free', r: null },
  { key: '16:9', label: '16:9', r: 16 / 9 },
  { key: '4:3', label: '4:3', r: 4 / 3 },
  { key: '1:1', label: '1:1', r: 1 },
  { key: '9:16', label: '9:16', r: 9 / 16 },
];
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.06;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function cropControl(box, srcW, srcH, onChange) {
  const layer = document.createElement('div');
  layer.className = 'crop-layer';
  layer.innerHTML = '<div class="crop-box"><div class="grid"></div><span class="c nw"></span><span class="c ne"></span><span class="c sw"></span><span class="c se"></span></div>';
  box.appendChild(layer);
  const el = layer.firstChild;
  let rect = { ...FULL };
  let format = 'free';

  // shape in normalized units: w/h such that (w*srcW)/(h*srcH) = r
  const ratioN = () => { const f = FORMATS.find((x) => x.key === format); return f?.r ? f.r * (srcH / srcW) : null; };
  const isCropped = () => rect.x > 0.001 || rect.y > 0.001 || rect.w < 0.999 || rect.h < 0.999;
  const paint = () => {
    el.style.left = `${rect.x * 100}%`;
    el.style.top = `${rect.y * 100}%`;
    el.style.width = `${rect.w * 100}%`;
    el.style.height = `${rect.h * 100}%`;
    el.style.visibility = isCropped() || layer.classList.contains('editing') ? 'visible' : 'hidden';
  };

  el.addEventListener('pointerdown', (e) => {
    if (!layer.classList.contains('editing')) return;
    e.preventDefault();
    const corner = e.target.classList.contains('c') ? ['nw', 'ne', 'sw', 'se'].find((c) => e.target.classList.contains(c)) : null;
    const b = box.getBoundingClientRect();
    const start = { ...rect };
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const dx = (ev.clientX - x0) / b.width;
      const dy = (ev.clientY - y0) / b.height;
      if (!corner) {
        rect.x = clamp(start.x + dx, 0, 1 - start.w);
        rect.y = clamp(start.y + dy, 0, 1 - start.h);
      } else {
        // the opposite corner stays put
        const ax = corner.includes('w') ? start.x + start.w : start.x;
        const ay = corner.includes('n') ? start.y + start.h : start.y;
        const sx = corner.includes('w') ? -1 : 1;
        const sy = corner.includes('n') ? -1 : 1;
        let w = clamp((corner.includes('w') ? start.w - dx : start.w + dx), MIN, sx < 0 ? ax : 1 - ax);
        let h = clamp((corner.includes('n') ? start.h - dy : start.h + dy), MIN, sy < 0 ? ay : 1 - ay);
        const r = ratioN();
        if (r) {
          const maxH = sy < 0 ? ay : 1 - ay;
          const maxW = sx < 0 ? ax : 1 - ax;
          h = w / r;
          if (h > maxH) { h = maxH; w = h * r; }
          if (w > maxW) { w = maxW; h = w / r; }
        }
        rect = { x: sx < 0 ? ax - w : ax, y: sy < 0 ? ay - h : ay, w, h };
      }
      paint();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onChange?.(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  const api = {
    get format() { return format; },
    isCropped,
    setEditing(on) { layer.classList.toggle('editing', on); paint(); },
    // the largest centered rectangle of that format
    setFormat(key) {
      format = key;
      const r = ratioN();
      if (!r) { rect = { ...FULL }; }
      else {
        let w = 1, h = 1 / r;
        if (h > 1) { h = 1; w = r; }
        rect = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
      }
      paint();
      onChange?.();
    },
    reset() { format = 'free'; rect = { ...FULL }; paint(); onChange?.(); },
    setRect(r) { if (r) { rect = { x: r.x, y: r.y, w: r.w, h: r.h }; paint(); onChange?.(); } },
  };
  Object.defineProperty(api, 'rect', { get: () => ({ ...rect }) });
  paint();
  return api;
}

// The format chips, rendered into a tool's options row.
export function renderFormats(opts, crop, onPick) {
  for (const f of FORMATS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `opt${crop.format === f.key ? ' on' : ''}`;
    b.textContent = f.label;
    b.addEventListener('click', () => { crop.setFormat(f.key); onPick?.(); });
    opts.appendChild(b);
  }
}
