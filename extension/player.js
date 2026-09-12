// Brief - the recording, full size in its own tab.
//
// The popup can't do this: an extension popup is a fixed little window, so its
// video's fullscreen button does nothing, and a blob URL minted there dies the
// moment the popup loses focus. This page runs at the extension origin like the
// popup does, so it reads the recording out of the shared blob store and mints
// its own URL, which lives as long as the tab.

import { getFile, recKey } from './filestore.js';

const briefId = decodeURIComponent(location.hash.slice(1));

(async function play() {
  let blob = null;
  try { blob = briefId ? await getFile(recKey(briefId)) : null; } catch {}
  if (!blob) {
    const p = document.createElement('p');
    p.className = 'gone';
    p.textContent = 'This recording is no longer on this device.';
    document.body.appendChild(p);
    return;
  }
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = url;
  v.controls = true;
  v.autoplay = true;
  v.playsInline = true;
  document.body.appendChild(v);
  window.addEventListener('pagehide', () => URL.revokeObjectURL(url));
})();
