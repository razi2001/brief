// Brief — settings / how-it-works page.
//
// The filing skill ships inside every brief zip (see skill/ in each
// ~/Downloads/brief/brief-<id>.zip), so there's no install step. This page is
// mostly informational; the one bit of real state it owns is the user's
// natural-language ticket-creation guidance, which gets appended to the
// Export prompt so the agent applies it to every ticket it files.

const guidanceEl = document.getElementById('ticketGuidance');
const statusEl = document.getElementById('guidanceStatus');

// ---------- Load ----------
chrome.storage.local.get('ticketGuidance', ({ ticketGuidance }) => {
  if (guidanceEl && typeof ticketGuidance === 'string') {
    guidanceEl.value = ticketGuidance;
  }
});

// ---------- Save (debounced as the user types) ----------
let saveTimer = null;
let lastSaved = '';

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle('show', !!text);
  statusEl.classList.toggle('saved', kind === 'saved');
}

function scheduleSave() {
  if (!guidanceEl) return;
  setStatus('Saving…', 'pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

function persist() {
  if (!guidanceEl) return;
  const next = guidanceEl.value;
  if (next === lastSaved) {
    setStatus('Saved', 'saved');
    return;
  }
  chrome.storage.local.set({ ticketGuidance: next }, () => {
    lastSaved = next;
    setStatus('Saved', 'saved');
    // Fade the indicator out after a beat so it doesn't linger as visual noise.
    setTimeout(() => {
      if (guidanceEl.value === lastSaved) setStatus('', null);
    }, 1500);
  });
}

guidanceEl?.addEventListener('input', scheduleSave);
guidanceEl?.addEventListener('blur', persist);
