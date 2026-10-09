// Brief - a screenshot in the editor: crop it to a format.
//
// Opened from the popup's screenshot sheet as image.html#<shotId>. Save crops
// the flattened image (what gets filed), the clean capture kept for redrawing
// (shot:<id>), and moves the drawing's strokes by the same offset, so "Edit
// drawing" still opens with every mark where it was.

import { getFile, putFile, shotKey } from './filestore.js';
import { getDraft, updateDraft } from './draft.js';
import { buildPage, emptyStage, fitBox, busy, toast, closeEditor, ICON } from './editor/shell.js';
import { cropControl, renderFormats } from './editor/crop.js';

const shotId = decodeURIComponent(location.hash.slice(1));
const page = buildPage({ title: 'Screenshot', timed: false });

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

function cropTo(img, px) {
  const c = document.createElement('canvas');
  c.width = px.w; c.height = px.h;
  c.getContext('2d').drawImage(img, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h);
  return c;
}

(async () => {
  const d = await getDraft();
  const shot = d?.screenshots?.find((s) => s.id === shotId);
  if (!shot) { emptyStage(page.stage, 'This screenshot is no longer in the brief.'); page.save.hidden = true; return; }

  const img = await loadImage(shot.dataUrl);
  img.className = 'pic';
  const box = document.createElement('div');
  box.className = 'media';
  box.appendChild(img);
  page.stage.innerHTML = '';
  page.stage.appendChild(box);
  const fit = () => { const s = fitBox(page.stage, img.naturalWidth, img.naturalHeight); box.style.width = `${s.width}px`; box.style.height = `${s.height}px`; };
  fit();
  new ResizeObserver(fit).observe(page.stage);

  let cropTool;
  const crop = cropControl(box, img.naturalWidth, img.naturalHeight, () => cropTool?.mark(crop.isCropped()));
  cropTool = page.addTool({
    icon: ICON.crop,
    label: 'Crop',
    onToggle: (on) => crop.setEditing(on),
    render: (opts) => renderFormats(opts, crop, () => cropTool.refresh()),
  });
  // a screenshot has one tool: start on it
  cropTool.el.click();

  page.save.addEventListener('click', async () => {
    if (!crop.isCropped()) { closeEditor(); return; }
    page.save.disabled = true;
    const ui = busy('Saving');
    try {
      const r = crop.rect;
      const W = img.naturalWidth, H = img.naturalHeight;
      const px = { x: Math.round(r.x * W), y: Math.round(r.y * H), w: Math.max(1, Math.round(r.w * W)), h: Math.max(1, Math.round(r.h * H)) };
      const dataUrl = cropTo(img, px).toDataURL('image/png');
      ui.progress(0.5);
      // the clean capture behind the drawing, cropped the same way
      const clean = await getFile(shotKey(shotId)).catch(() => null);
      let shift = { x: px.x, y: px.y }; // strokes live in the clean capture's pixels
      if (clean) {
        const url = URL.createObjectURL(clean);
        const cimg = await loadImage(url);
        URL.revokeObjectURL(url);
        const k = cimg.naturalWidth / W; // the clean capture can be a different size
        const cpx = { x: Math.round(px.x * k), y: Math.round(px.y * k), w: Math.round(px.w * k), h: Math.round(px.h * k) };
        const out = await new Promise((res) => cropTo(cimg, cpx).toBlob(res, 'image/png'));
        if (out) await putFile(shotKey(shotId), out);
        shift = { x: cpx.x, y: cpx.y };
      }
      const ok = await updateDraft(null, (x) => {
        const s = (x.screenshots || []).find((y) => y.id === shotId);
        if (!s) return;
        s.dataUrl = dataUrl;
        s.cropped = true;
        s.strokes = (s.strokes || []).map((st) => ({
          ...st,
          points: (st.points || []).map((p) => ({ ...p, x: p.x - shift.x, y: p.y - shift.y })),
        }));
      });
      if (!ok) throw new Error('This brief was filed or reset meanwhile.');
      ui.progress(1);
      closeEditor(300);
    } catch (err) {
      ui.done();
      page.save.disabled = false;
      toast(`Couldn’t save: ${err?.message || err}`);
    }
  });
})();
