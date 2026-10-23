// Brief - a screenshot in the editor: draw on it, crop it.
//
// Opened from the popup's screenshot sheet as image.html#<shotId>; the same
// editor as right after a capture (editor/shot-editor.js), in its own tab. It
// works on the clean capture kept in the blob store (shot:<id>) with the marks
// as strokes, so every mark stays editable; Save writes the flattened picture
// (what gets filed), the strokes, and - when cropped - the cropped clean
// capture. A screenshot whose clean capture is gone is edited as it is: its old
// marks become part of the picture.

import { getFile, putFile, shotKey } from './filestore.js';
import { getDraft, updateDraft } from './draft.js';
import { buildPage, emptyStage, busy, closeEditor } from './editor/shell.js';
import { mountShotEditor } from './editor/shot-editor.js';

const shotId = decodeURIComponent(location.hash.slice(1));
const page = buildPage({ title: 'Screenshot', timed: false });

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

(async () => {
  const d = await getDraft();
  const shot = d?.screenshots?.find((s) => s.id === shotId);
  if (!shot) { emptyStage(page.stage, 'This screenshot is no longer in the brief.'); page.save.hidden = true; return; }

  const clean = await getFile(shotKey(shotId)).catch(() => null);
  const url = clean ? URL.createObjectURL(clean) : shot.dataUrl;
  const image = await loadImage(url);

  mountShotEditor(page, {
    image,
    strokes: clean ? shot.strokes || [] : [],
    onCancel: () => closeEditor(),
    onSave: async (r) => {
      const ui = busy('Saving');
      try {
        if (r.cropped || !clean) await putFile(shotKey(shotId), r.cleanBlob);
        ui.progress(0.5);
        const ok = await updateDraft(null, (x) => {
          const s = (x.screenshots || []).find((y) => y.id === shotId);
          if (!s) return;
          s.dataUrl = r.dataUrl;
          s.annotated = r.annotated;
          s.strokes = r.strokes;
          if (r.cropped) s.cropped = true;
        });
        if (!ok) throw new Error('This brief was filed or reset meanwhile.');
        ui.progress(1);
        closeEditor(300);
      } catch (err) {
        ui.done();
        throw err;
      }
    },
  });
})();
