// Brief - editor timeline: one strip, two handles. What sits between them is
// kept; drag the strip to scrub.

export const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const MIN_KEEP_MS = 500;

export function createTimeline(host, { duration, onSeek, onChange }) {
  host.className = 'tl';
  host.innerHTML =
    '<div class="tl-track"></div><div class="tl-out l"></div><div class="tl-out r"></div><div class="tl-sel"></div>' +
    '<span class="tl-h" data-edge="a"></span><span class="tl-h" data-edge="b"></span><div class="tl-marks"></div><div class="tl-head"></div>';
  const track = host.querySelector('.tl-track');
  const outL = host.querySelector('.tl-out.l');
  const outR = host.querySelector('.tl-out.r');
  const sel = host.querySelector('.tl-sel');
  const [hA, hB] = host.querySelectorAll('.tl-h');
  const head = host.querySelector('.tl-head');
  const range = { a: 0, b: duration };

  const pct = (t) => `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`;
  const tAt = (x) => {
    const r = host.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((x - r.left) / r.width) * duration));
  };
  const changed = () => onChange?.({ ...range });

  function paint() {
    outL.style.left = '0'; outL.style.width = pct(range.a);
    outR.style.left = pct(range.b); outR.style.right = '0';
    sel.style.left = pct(range.a); sel.style.width = pct(range.b - range.a);
    hA.style.left = pct(range.a); hB.style.left = pct(range.b);
  }

  for (const h of [hA, hB]) {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const edge = h.dataset.edge;
      const move = (ev) => {
        const t = tAt(ev.clientX);
        if (edge === 'a') range.a = Math.min(t, range.b - MIN_KEEP_MS);
        else range.b = Math.max(t, range.a + MIN_KEEP_MS);
        paint();
        onSeek?.(range[edge]);
        changed();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onSeek?.(tAt(e.clientX));
    const move = (ev) => onSeek?.(tAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  paint();
  return {
    get range() { return { ...range }; },
    // what is kept, as pieces (one: the trimmed range)
    get kept() { return [{ ...range }]; },
    setHead(t) { head.style.left = pct(t); },
    setThumbs(urls) { track.innerHTML = urls.map((u) => `<img src="${u}" alt="">`).join(''); },
    // `make(cell, i, n)` fills each cell itself (a replay draws tiny live frames)
    setCells(n, make) {
      track.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        track.appendChild(cell);
        make(cell, i, n);
      }
    },
    // moments worth seeing (a replay's clicks), as faint ticks
    // the reporter's marks (where the bug is): flags; click one to jump there
    setMarks(marks, onPick) {
      const box = host.querySelector('.tl-marks');
      box.innerHTML = '';
      for (const m of marks) {
        const f = document.createElement('button');
        f.type = 'button';
        f.className = 'tl-mark';
        f.style.left = pct(m.t);
        f.title = m.note ? `${clock(m.t)} \u00b7 ${m.note}` : clock(m.t);
        f.addEventListener('pointerdown', (e) => e.stopPropagation());
        f.addEventListener('click', () => onPick?.(m));
        box.appendChild(f);
      }
    },
    setTicks(times) { track.insertAdjacentHTML('beforeend', times.map((t) => `<span class="tick" style="left:${pct(t)}"></span>`).join('')); },
  };
}
