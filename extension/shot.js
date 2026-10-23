// Brief - the screenshot editor over the page, right after a capture.
//
// The same editor as a screenshot opened from the popup (editor/shot-editor.js:
// draw, crop), filling the page's overlay instead of a tab. The content script
// hands over the work: a fresh capture as a data URL, or an existing
// screenshot's id - its clean capture comes straight out of the blob store
// (this document runs at the extension origin) - plus the strokes to restore.
// The result goes back to the content script, which relays it to the worker.

import { getFile, putFile, shotKey } from './filestore.js';
import { buildPage } from './editor/shell.js';
import { mountShotEditor } from './editor/shot-editor.js';

const params = new URLSearchParams(location.hash.slice(1));
const itemId = params.get('itemId') || '';
let shotId = '';

function post(type, payload = {}) {
  window.parent.postMessage({ app: 'brief-shot', type, ...payload }, '*');
}
const cancel = () => post('cancel');
const page = buildPage({ title: 'Screenshot', timed: false, onCancel: cancel });

let started = false;
window.addEventListener('message', async (e) => {
  const m = e.data;
  if (!m || m.app !== 'brief-shot' || m.type !== 'image' || started) return;
  started = true;
  shotId = m.shotId || '';
  const strokes = Array.isArray(m.strokes) ? m.strokes : [];
  let src = m.dataUrl;
  let revoke = null;
  if (!src && shotId) {
    const blob = await getFile(shotKey(shotId)).catch(() => null);
    if (blob) { src = URL.createObjectURL(blob); revoke = src; }
  }
  if (!src) { cancel(); return; }
  const image = new Image();
  image.onerror = () => cancel();
  image.onload = () => {
    if (revoke) URL.revokeObjectURL(revoke);
    mountShotEditor(page, {
      image,
      strokes,
      onCancel: cancel,
      onSave: async (r) => {
        // the clean capture (stored by the worker on capture) follows the crop
        if (r.cropped && shotId) await putFile(shotKey(shotId), r.cleanBlob).catch(() => {});
        post('save', { itemId, shotId, dataUrl: r.dataUrl, annotated: r.annotated, strokes: r.strokes });
      },
    });
  };
  image.src = src;
});

// Tell the parent we're ready for the image.
post('ready');
