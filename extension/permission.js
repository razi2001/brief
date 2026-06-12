// Brief - microphone permission page
//
// This page exists only to fire Chrome's native mic prompt reliably (a
// top-level extension tab is the one context where it works). Once mic is
// granted, we hand off to the Brief Cloud connect page so the user can pair the
// extension (the old settings/options page has been removed).

import { APP_URL } from './cloud.js';

const grantBtn = document.getElementById('grantBtn');
const statusEl = document.getElementById('status');

function setStatus(kind, message) {
  statusEl.className = `status ${kind} show`;
  statusEl.textContent = message;
}
function hideStatus() { statusEl.className = 'status'; }

async function checkMic() {
  try {
    if (navigator.permissions?.query) {
      const s = await navigator.permissions.query({ name: 'microphone' });
      return s.state;
    }
  } catch {}
  return 'prompt';
}

function goToOnboarding() {
  // Mic granted - send the user to Brief Cloud to pair the extension.
  location.href = `${APP_URL}/connect?ext=${chrome.runtime.id}`;
}

(async () => {
  const state = await checkMic();
  if (state === 'granted') {
    grantBtn.textContent = '✓ Microphone already granted';
    grantBtn.disabled = true;
    setStatus('ok', 'Microphone access is set up - continuing…');
    setTimeout(goToOnboarding, 700);
  }
})();

grantBtn.addEventListener('click', async () => {
  hideStatus();
  grantBtn.disabled = true;
  grantBtn.textContent = 'Requesting…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    grantBtn.textContent = '✓ Microphone granted';
    setStatus('ok', 'Granted - continuing to setup…');
    setTimeout(goToOnboarding, 800);
  } catch (err) {
    grantBtn.disabled = false;
    grantBtn.textContent = 'Try again';
    if (err?.name === 'NotAllowedError') {
      setStatus('err', "Blocked. Click the mic/camera icon in Chrome's address bar to allow, then try again.");
    } else if (err?.name === 'NotFoundError') {
      setStatus('err', 'No microphone found. Plug one in and try again.');
    } else {
      setStatus('err', `Mic error: ${err?.message || err}`);
    }
  }
});
