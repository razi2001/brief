// Brief - the small reminder the worker opens under the toolbar icon
// (background.js maybeNudge): the owner's text or "Seen a bug?", Brief it, ×.
// Brief it turns this same popup into Brief's own (popup.html). A port stays
// open while it is up, so the worker hears what happened to it.

const port = chrome.runtime.connect({ name: 'nudge-reminder' });

chrome.storage.local.get('nudgeReminder').then(({ nudgeReminder }) => {
  chrome.storage.local.remove('nudgeReminder').catch(() => {});
  const text = typeof nudgeReminder?.text === 'string' ? nudgeReminder.text.trim().slice(0, 80) : '';
  // textContent, never HTML: the text comes from the server
  if (text) document.getElementById('text').textContent = text;
}).catch(() => {});

document.getElementById('go').addEventListener('click', async () => {
  port.postMessage({ type: 'brief_it' });
  // popup.js keeps the port going, without the line on top
  await chrome.storage.local.set({ nudgeReminder: { at: Date.now(), carry: true } }).catch(() => {});
  location.href = 'popup.html';
});

document.getElementById('close').addEventListener('click', () => window.close());
