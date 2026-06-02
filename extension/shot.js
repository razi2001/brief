// Brief — screenshot annotator overlay.
// Receives a captured screenshot dataURL from the content script, lets the user
// draw in red to point at the issue, then flattens the result and sends it back.

const params = new URLSearchParams(location.hash.slice(1));
const itemId = params.get('itemId') || '';

const stage = document.getElementById('stage');
const shotCanvas = document.getElementById('shot');
const drawCanvas = document.getElementById('draw');
const sctx = shotCanvas.getContext('2d');
const dctx = drawCanvas.getContext('2d');

const hintEl = document.getElementById('hint');
const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

let img = null;          // the loaded screenshot Image
let natW = 0, natH = 0;  // natural (device) pixels
let dispW = 0, dispH = 0; // displayed CSS pixels
const strokes = [];      // [{points:[{x,y}...]}] in natural-pixel coords
let drawing = false;

function post(type, payload = {}) {
  window.parent.postMessage({ app: 'brief-shot', type, ...payload }, '*');
}

// Receive the screenshot from the content script.
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.app !== 'brief-shot') return;
  if (m.type === 'image' && m.dataUrl) loadImage(m.dataUrl);
});

function loadImage(dataUrl) {
  img = new Image();
  img.onload = () => {
    natW = img.naturalWidth;
    natH = img.naturalHeight;
    layout();
  };
  img.src = dataUrl;
}

// Fit the image within the viewport (minus margins) preserving aspect ratio.
function layout() {
  if (!img) return;
  const margin = 80; // leave room for the toolbar + breathing space
  const availW = window.innerWidth - margin;
  const availH = window.innerHeight - margin - 40;
  const scale = Math.min(availW / natW, availH / natH, 1);
  dispW = Math.round(natW * scale);
  dispH = Math.round(natH * scale);

  // Backing stores at natural resolution (crisp), CSS size = displayed.
  for (const c of [shotCanvas, drawCanvas]) {
    c.width = natW;
    c.height = natH;
    c.style.width = dispW + 'px';
    c.style.height = dispH + 'px';
  }
  sctx.drawImage(img, 0, 0, natW, natH);
  redraw();
}
window.addEventListener('resize', () => { if (img) layout(); });

// Map a pointer event to natural-pixel coordinates on the canvas.
function toCanvas(e) {
  const r = drawCanvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * natW;
  const y = (e.clientY - r.top) / r.height * natH;
  return { x, y };
}

function redraw() {
  dctx.clearRect(0, 0, natW, natH);
  // Stroke width scales with image size so it reads at any resolution.
  const w = Math.max(3, Math.round(natW / 300));
  dctx.strokeStyle = '#ff2d2d';
  dctx.lineJoin = 'round';
  dctx.lineCap = 'round';
  dctx.lineWidth = w;
  // Subtle dark halo so red reads on light AND dark pages.
  dctx.shadowColor = 'rgba(0,0,0,0.35)';
  dctx.shadowBlur = Math.max(2, w * 0.6);
  for (const s of strokes) {
    if (s.points.length < 2) {
      // a dot
      const p = s.points[0];
      if (!p) continue;
      dctx.beginPath();
      dctx.arc(p.x, p.y, w / 1.5, 0, Math.PI * 2);
      dctx.fillStyle = '#ff2d2d';
      dctx.fill();
      continue;
    }
    dctx.beginPath();
    dctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) dctx.lineTo(s.points[i].x, s.points[i].y);
    dctx.stroke();
  }
  dctx.shadowBlur = 0;
  const has = strokes.length > 0;
  undoBtn.disabled = !has;
  clearBtn.disabled = !has;
}

// ---- Drawing (pointer events; works for mouse + pen + touch) ----
drawCanvas.addEventListener('pointerdown', (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  drawing = true;
  drawCanvas.setPointerCapture(e.pointerId);
  strokes.push({ points: [toCanvas(e)] });
  redraw();
});
drawCanvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  strokes[strokes.length - 1].points.push(toCanvas(e));
  redraw();
});
function endStroke() { drawing = false; }
drawCanvas.addEventListener('pointerup', endStroke);
drawCanvas.addEventListener('pointercancel', endStroke);
drawCanvas.addEventListener('pointerleave', endStroke);

undoBtn.addEventListener('click', () => { strokes.pop(); redraw(); });
clearBtn.addEventListener('click', () => { strokes.length = 0; redraw(); });
cancelBtn.addEventListener('click', () => post('cancel'));

saveBtn.addEventListener('click', () => {
  // Flatten screenshot + drawing into one PNG at natural resolution.
  const out = document.createElement('canvas');
  out.width = natW; out.height = natH;
  const octx = out.getContext('2d');
  octx.drawImage(shotCanvas, 0, 0);
  octx.drawImage(drawCanvas, 0, 0);
  const dataUrl = out.toDataURL('image/png');
  const annotated = strokes.length > 0;
  post('save', { itemId, dataUrl, annotated });
});

// Esc cancels.
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') post('cancel');
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { strokes.pop(); redraw(); }
});

// Tell the parent we're ready for the image.
post('ready');
