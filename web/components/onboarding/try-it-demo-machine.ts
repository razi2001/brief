/**
 * The get-brief.app hero demo, ported as is (brief-marketing-website,
 * index.html at 4e55799, `initDemo`): a fake checkout with two planted bugs.
 * Pay fails (record it) and the CVC field hangs off the card (screenshot it).
 * One small state machine drives it, and a hint always points at the next
 * thing to click.
 *
 * What differs from the website, because this runs inside onboarding:
 *  - no start screen: it opens on the bug 1 intro;
 *  - no sign-up link: when both bugs are in, the end bar offers the Guide;
 *  - it can be unmounted (Back, finish, a route change), so `initDemo` returns
 *    a cleanup that clears every timer and listener;
 *  - SVG ids carry a `td-` prefix (ids are global to the page).
 */

type Kind = "shot" | "video" | "replay";
type Snap = { node: HTMLElement; W: number; H: number };
type Tile = { kind: Kind; snap: Snap | null; ink?: string | null; dur?: number; errors?: boolean; fresh: boolean };
type Bug = {
  title: string;
  sum: (err: boolean) => string;
  steps: string[];
  exp: string;
  act: string;
  label: [string, string];
};
type Goal = "pay" | "look";
type Tracker = "linear" | "jira" | "github";
type SkinKey = Tracker | "draft";
type Phase = "idle" | "popup" | "chooser" | "sending" | "recording" | "countdown" | "shot" | "ticket";
type Point = [number, number];
type State = {
  phase: Phase;
  tiles: Tile[];
  paid: boolean;
  paidRec: boolean;
  tracker: Tracker;
  draft: boolean;
  strokes: Point[][];
  done: boolean;
  recStart: number;
  recIv: number;
  shotSnap: Snap | null;
  bug: Bug;
  next?: Goal | null;
};

const LINE_A = "Okay, my card is in. Now I click Pay…";
const LINE_B = "It spins, then “Something went wrong.” I expected a confirmation.";
/* what the ticket says, for each planted bug */
const BUGS: Record<Goal, Bug> = {
  pay: {
    title: "Pay fails at checkout with a 500",
    sum: (err) =>
      "Clicking Pay $49.00 spins, then shows “Something went wrong.” " +
      (err ? "The payment call returns a 500, so the order never goes through." : "The order never goes through."),
    steps: ["Open acme.shop/checkout.", "Fill in the card details.", "Click <b>Pay $49.00</b>.", "It spins, then says “Something went wrong.”"],
    exp: "The order goes through and a confirmation shows.",
    act: "“Something went wrong.” No order.",
    label: ["Checkout", "#2f5bd3"],
  },
  look: {
    title: "CVC field sticks out of the checkout card",
    sum: () => "On the checkout page, the CVC field is pushed past the right edge of the card. It overlaps the border and looks broken.",
    steps: ["Open acme.shop/checkout.", "Look at the card details, next to Expiry."],
    exp: "The CVC field sits inside the card, next to Expiry.",
    act: "The CVC field hangs off the card’s right edge.",
    label: ["UI", "#8b5cf6"],
  },
};
const SKINS: Record<SkinKey, { name: string; id: string; team: string; url: string; logo: string; color: string; status: string }> = {
  linear: { name: "Linear", id: "ENG-142", team: "Engineering", url: "linear.app/acme/issue/ENG-142", logo: "lg-linear", color: "#5e6ad2", status: "Todo" },
  jira: { name: "Jira", id: "SHOP-87", team: "Shop", url: "acme.atlassian.net/browse/SHOP-87", logo: "lg-jira", color: "#2684ff", status: "To Do" },
  github: { name: "GitHub", id: "#412", team: "acme/shop", url: "github.com/acme/shop/issues/412", logo: "lg-github", color: "#1f2328", status: "Open" },
  draft: { name: "Drafts", id: "brief-15", team: "Drafts", url: "cloud.get-brief.app/drafts/brief-15", logo: "mark", color: "#dd6936", status: "Draft" },
};
/* the card that says which bug is next */
const SCENES: Record<Goal, [string, string, string]> = {
  look: ["Bug 1 of 2", "The CVC field is off", "Report it with a screenshot."],
  pay: ["Bug 2 of 2", "Pay fails", "Click it, then report it with Replay."],
};

/** Runs the demo inside `demo` (the `.stage` element). Returns its cleanup. */
export function initDemo(demo: HTMLElement, opts: { onOpenGuide: () => void }): () => void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const $ = <E extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<E>(sel)!;

  const win = $(demo, ".win");
  const wb = $(win, ".wb");
  const acme = $(wb, ".acme");
  const payErr = $(acme, ".a-err");
  const pop = $(win, ".pop");
  const tilesEl = $(pop, ".tiles");
  const countEl = $(pop, ".pop-lbl .n");
  const addBtn = $(pop, ".add");
  const note = $<HTMLTextAreaElement>(pop, ".note");
  const createBtn = $<HTMLButtonElement>(pop, ".create");
  const draftBtn = $<HTMLButtonElement>(pop, ".savedraft");
  const toast = $(pop, ".pop-toast");
  const cloudBtn = $(pop, ".cloud-btn");
  const cd = $(wb, ".cd");
  const cdNum = $(cd, "span");
  const recbar = $(wb, ".recbar");
  const recT = $(recbar, ".rec-t");
  const cap = $(wb, ".cap");
  const capT = $(cap, ".cap-t");
  const caught = $(wb, ".caught");
  const shot = $(wb, ".shotlayer");
  const canvas = $<HTMLCanvasElement>(shot, "canvas");
  const tk = $(wb, ".tk");
  const tkTitle = $(tk, ".tk-title");
  const tkLogo = $<SVGUseElement>(tk, ".tk-logo use");
  const urlT = $(win, ".url-t");
  const tabT = $(win, ".tab-t");
  const tabFav = $<SVGUseElement>(win, ".tab-fav use");
  const coach = $(win, ".coach");
  const coachT = $(coach, ".coach-t");
  const ring = $(win, ".ring");
  const scene = $(win, ".scene");
  const T = (k: string) => $<HTMLButtonElement>(win, '[data-t="' + k + '"]');

  let st = fresh();
  let timers: number[] = [];
  let ivals: number[] = [];
  let sayId = 0;
  let coachEl: HTMLElement | null = null;
  let coachSeq = 0;
  /* which planted bug the visitor is reporting, and which ones they have */
  let goal: Goal = "look";
  let started = false;
  const reported: Record<Goal, boolean> = { pay: false, look: false };
  /* unmounted: pending promise callbacks must not touch the DOM */
  let dead = false;
  const listeners = new AbortController();
  const on = { signal: listeners.signal };

  function fresh(): State {
    return { phase: "idle", tiles: [], paid: false, paidRec: false, tracker: "linear", draft: false, strokes: [], done: false, recStart: 0, recIv: 0, shotSnap: null, bug: BUGS.pay };
  }
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(fn, ms); timers.push(id); return id; };
  const every = (fn: () => void, ms: number) => { const id = window.setInterval(fn, ms); ivals.push(id); return id; };
  function clearAll() { timers.forEach(clearTimeout); ivals.forEach(clearInterval); timers = []; ivals = []; }
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  /* ── render the parts that follow straight from state ── */
  function render() {
    const p = st.phase;
    demo.dataset.phase = p;
    pop.classList.toggle("open", p === "popup" || p === "chooser" || p === "sending");
    pop.classList.toggle("sheet-on", p === "chooser");
    wb.classList.toggle("recording", p === "recording");
    recbar.classList.toggle("on", p === "recording");
    cap.classList.toggle("on", p === "recording" && capT.textContent !== "");
    caught.hidden = p !== "recording";
    shot.classList.toggle("on", p === "shot");
    cd.classList.toggle("on", p === "countdown");
    tk.classList.toggle("on", p === "ticket");
    renderTiles();
    const can = st.tiles.length > 0 || note.value.trim() !== "";
    createBtn.disabled = !can;
    draftBtn.disabled = !can;
    const shots = st.tiles.filter((t) => t.kind === "shot").length;
    const sc = T("choice-shot");
    $(sc, ".cs").textContent = shots + " of 3";
    sc.disabled = shots >= 3;
    T("choice-video").disabled = st.tiles.some((t) => t.kind === "video");
    T("choice-replay").disabled = st.tiles.some((t) => t.kind === "replay");
    addBtn.hidden = st.tiles.length >= 3;
    coachUpdate();
  }

  function renderTiles() {
    tilesEl.textContent = "";
    let n = 0;
    st.tiles.forEach((t, i) => {
      const d = document.createElement("div");
      d.className = "tile " + t.kind + (t.fresh ? " pop-in" : "");
      const th = document.createElement("div");
      th.className = "th";
      th.appendChild(mini(t, 88, 64));
      if (t.kind === "shot") {
        n++;
        const b = document.createElement("span"); b.className = "badge"; b.textContent = String(n); th.appendChild(b);
      } else {
        th.insertAdjacentHTML("beforeend", '<span class="play"><svg aria-hidden="true"><use href="#td-i-play"/></svg></span>');
      }
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Remove");
      x.innerHTML = '<svg aria-hidden="true"><use href="#td-i-x"/></svg>';
      x.addEventListener("click", (e) => { e.stopPropagation(); st.tiles.splice(i, 1); render(); });
      th.appendChild(x);
      const s = document.createElement("div");
      s.className = "strip";
      s.innerHTML = '<span class="ok"></span>';
      s.append(t.kind === "video" ? "Video · 0:" + String(t.dur).padStart(2, "0") : t.kind === "replay" ? "Replay · 60s" : "Screenshot " + n);
      d.append(th, s);
      tilesEl.appendChild(d);
      t.fresh = false;
    });
    countEl.textContent = String(st.tiles.length);
  }

  /* a shrunk live copy of the page, plus the drawing on top */
  function snap(): Snap {
    const node = acme.cloneNode(true) as HTMLElement;
    node.querySelectorAll("[data-t],[data-act]").forEach((el) => { el.removeAttribute("data-t"); el.removeAttribute("data-act"); });
    node.querySelectorAll(".loading").forEach((el) => el.classList.remove("loading"));
    node.querySelectorAll("button").forEach((el) => el.setAttribute("tabindex", "-1"));
    return { node, W: acme.offsetWidth || 1, H: acme.offsetHeight || 1 };
  }
  function mini(t: Tile, w: number, h: number) {
    const wrap = document.createElement("div");
    wrap.className = "mini";
    wrap.setAttribute("aria-hidden", "true");
    wrap.inert = true;
    if (!t.snap) return wrap;
    const s = Math.max(w / t.snap.W, h / t.snap.H);
    const inner = document.createElement("div");
    inner.className = "mini-in";
    inner.style.width = t.snap.W + "px";
    inner.style.height = t.snap.H + "px";
    inner.style.transform = "scale(" + s + ")";
    inner.appendChild(t.snap.node.cloneNode(true));
    if (t.ink) { const img = new Image(); img.src = t.ink; img.alt = ""; img.className = "mini-ink"; inner.appendChild(img); }
    wrap.appendChild(inner);
    return wrap;
  }

  /* ── hints ── */
  function coachFor(): [string, string] | null {
    if (!started) return null;
    const p = st.phase;
    const hasAny = st.tiles.length > 0 || note.value.trim() !== "";
    if (p === "idle") {
      if (goal === "look") return ["brief", "The CVC field is off. Click Brief."];
      return st.paid ? ["brief", "Replay already kept it. Click Brief."] : ["pay", "Pay is broken. Click it."];
    }
    if (p === "chooser") {
      const order: [string, string][] = goal === "look"
        ? [["choice-shot", "Pick Screenshot"], ["choice-video", "Pick Video"], ["choice-replay", "Pick Replay"]]
        : [["choice-replay", "Pick Replay. It already has the bug."], ["choice-video", "Pick Video"], ["choice-shot", "Pick Screenshot"]];
      return order.find(([k]) => !T(k).disabled) || null;
    }
    if (p === "popup") return hasAny ? ["create", "Now click Create ticket"] : ["add", "Click Add to capture the bug"];
    if (p === "recording") return st.paidRec ? ["stop", "Got it. Click stop."] : ["pay", "Show the bug: click Pay"];
    if (p === "shot") return st.strokes.length ? ["shot-save", "Nice. Click Save."] : ["cvc", "Circle the CVC field. It sticks out."];
    if (p === "ticket" && st.done && st.draft) return ["file", "Ready? File it"];
    return null;
  }
  function coachUpdate() {
    const c = coachFor();
    const el = c && T(c[0]);
    const next = el && !el.disabled ? el : null;
    const id = ++coachSeq;
    if (!c || !next) { coachEl = null; coach.classList.remove("on"); ring.classList.remove("on"); return; }
    coachT.textContent = c[1];
    if (next === coachEl && coach.classList.contains("on")) { place(next); return; }
    /* a new target: hide the hint, wait for the panels around it to finish
       opening, then show it already in place (mid-animation it lands off) */
    coachEl = next;
    coach.classList.remove("on");
    ring.classList.remove("on");
    later(() => settled().then(() => {
      if (dead || id !== coachSeq) return;
      place(next);
      coach.classList.add("on");
      ring.classList.add("on");
    }), 30);
  }
  /* resolves once every finite animation or transition in the window is done */
  function settled(): Promise<unknown> {
    if (!win.getAnimations) return new Promise<void>((r) => { later(r, 380); });
    const busy = win.getAnimations({ subtree: true }).filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.target;
      return t && a.effect!.getComputedTiming().iterations !== Infinity && t !== ring && !coach.contains(t);
    });
    return Promise.all(busy.map((a) => a.finished.catch(() => {})));
  }
  /* a box relative to the window, in the window's own (unzoomed) pixels */
  function box(el: Element) {
    const wr = win.getBoundingClientRect(), r = el.getBoundingClientRect();
    const z = wr.width / win.offsetWidth || 1;
    const left = (r.left - wr.left) / z, top = (r.top - wr.top) / z, width = r.width / z, height = r.height / z;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  function place(el: HTMLElement | null) {
    if (!el) return;
    const r = box(el);
    if (!r.width) return;
    const W = win.offsetWidth, H = win.offsetHeight;
    const pad = 4;
    ring.style.left = (r.left - pad) + "px";
    ring.style.top = (r.top - pad) + "px";
    ring.style.width = (r.width + pad * 2) + "px";
    ring.style.height = (r.height + pad * 2) + "px";
    const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
    ring.style.borderRadius = (br + pad) + "px";
    const cw = coach.offsetWidth, ch = coach.offsetHeight;
    const pr = box(pop);
    if (pop.contains(el) && pr.left > cw + 30) {
      /* inside the popup: sit to its left so no option is covered */
      const lx = pr.left - cw - 16;
      const ly = clamp(r.top + r.height / 2 - ch / 2, 8, H - ch - 8);
      coach.style.transform = "translate(" + lx + "px," + ly + "px)";
      coach.classList.remove("above");
      coach.classList.add("side");
      coach.style.setProperty("--ay", clamp(r.top + r.height / 2 - ly, 12, ch - 12) + "px");
      return;
    }
    coach.classList.remove("side", "right");
    const cx = r.left + r.width / 2;
    const below = r.bottom + ch + 20 < H;
    if (!below && r.right + cw + 30 < W) {
      /* no room under it: sit to its right */
      const rx = r.right + 16;
      const ry = clamp(r.top + r.height / 2 - ch / 2, 8, H - ch - 8);
      coach.style.transform = "translate(" + rx + "px," + ry + "px)";
      coach.classList.remove("above");
      coach.classList.add("right");
      coach.style.setProperty("--ay", clamp(r.top + r.height / 2 - ry, 12, ch - 12) + "px");
      return;
    }
    const top = below ? r.bottom + 14 : r.top - ch - 14;
    const left = clamp(cx - cw / 2, 8, W - cw - 8);
    coach.style.transform = "translate(" + left + "px," + top + "px)";
    coach.classList.toggle("above", !below);
    coach.style.setProperty("--ax", clamp(cx - left, 14, cw - 14) + "px");
  }

  /* ── the browser's address bar and tab ── */
  function setTab(which: SkinKey | "acme") {
    if (which === "acme") {
      urlT.textContent = "acme.shop/checkout";
      tabT.textContent = "Checkout · Acme";
      tabFav.setAttribute("href", "#td-lg-acme");
      return;
    }
    const s = SKINS[which];
    urlT.textContent = s.url;
    tabT.textContent = (which === "draft" ? "Draft" : s.id) + " · " + st.bug.title;
    tabFav.setAttribute("href", "#td-" + s.logo);
  }

  /* ── actions ── */
  const act: Record<string, (arg?: string) => void> = {
    brief() {
      if (st.phase === "idle") go("popup");
      else if (st.phase === "popup" || st.phase === "chooser") go("idle");
    },
    pay() {
      const b = T("pay");
      if (b.classList.contains("loading") || st.phase === "shot") return;
      b.classList.remove("failed");
      payErr.hidden = true;
      b.classList.add("loading");
      st.paid = true;
      const duringRec = st.phase === "recording";
      render();
      later(() => {
        b.classList.remove("loading");
        b.classList.add("failed");
        payErr.hidden = false;
        later(() => b.classList.remove("failed"), 2200);
        if (duringRec && st.phase === "recording" && !st.paidRec) {
          st.paidRec = true;
          catchErrors();
          later(() => say(LINE_B), 250);
        }
        render();
      }, 900);
    },
    add() { if (st.phase === "popup") go("chooser"); },
    sheetClose() { if (st.phase === "chooser") go("popup"); },
    video() { if (st.phase === "chooser") countdown(); },
    shot() { if (st.phase === "chooser") startShot(); },
    replay() {
      if (st.phase !== "chooser") return;
      st.tiles.push({ kind: "replay", snap: snap(), fresh: true });
      go("popup");
    },
    stop() { if (st.phase === "recording") stopRec(); },
    shotUndo() { st.strokes.pop(); redraw(); render(); },
    shotCancel() { if (st.phase === "shot") go("popup"); },
    shotSave() { if (st.phase === "shot") saveShot(); },
    create() { send(false); },
    draft() { send(true); },
    fileDraft() {
      if (st.phase !== "ticket" || !st.draft) return;
      st.draft = false;
      tk.classList.remove("draft");
      skin();
      render();
    },
    tracker(k) {
      if (!k || !(k in SKINS) || st.draft) return;
      st.tracker = k as Tracker;
      skin();
      render();
    },
    restart() { reset(); },
    again() { reported.pay = reported.look = false; setGoal("look"); },
    goal(k) { setGoal(k as Goal); },
    guide() { opts.onOpenGuide(); },
  };
  function go(p: Phase) { st.phase = p; render(); }
  function intro(k: Goal, delay?: number) {
    if (reduce) return;
    const [n, t, sub] = SCENES[k];
    $(scene, ".scene-n").textContent = n;
    $(scene, ".scene-t").textContent = t;
    $(scene, ".scene-s").textContent = sub;
    scene.style.setProperty("--sd", (delay || 0) + "ms");
    scene.classList.remove("run");
    void scene.offsetWidth;
    scene.classList.add("run");
  }
  function setGoal(k: Goal) {
    goal = k;
    started = true;
    intro(k);
    reset();
  }

  demo.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-act]") : null;
    if (!b || !demo.contains(b) || b.closest(".mini")) return;
    const f = act[b.dataset.act!];
    if (f) f(b.dataset.arg);
  }, on);
  note.addEventListener("input", render, on);

  /* ── video ── */
  function countdown() {
    go("countdown");
    let n = 3;
    cdNum.textContent = String(n);
    bump(cdNum);
    const tick = () => {
      n--;
      if (n > 0) { cdNum.textContent = String(n); bump(cdNum); later(tick, reduce ? 200 : 650); }
      else startRec();
    };
    later(tick, reduce ? 200 : 650);
  }
  function bump(el: HTMLElement) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  function startRec() {
    st.paidRec = false;
    st.recStart = Date.now();
    recT.textContent = "00:00";
    caught.textContent = "";
    capT.textContent = "";
    st.recIv = every(() => {
      const s = Math.min(59, Math.floor((Date.now() - st.recStart) / 1000));
      recT.textContent = "00:" + String(s).padStart(2, "0");
    }, 250);
    go("recording");
    later(() => { if (st.phase === "recording" && !st.paidRec) say(LINE_A); }, 450);
  }
  function say(text: string) {
    const id = ++sayId;
    capT.textContent = "";
    cap.classList.add("on");
    if (reduce) { capT.textContent = text; return; }
    let i = 0;
    const step = () => {
      if (id !== sayId) return;
      capT.textContent = text.slice(0, ++i);
      if (i < text.length) later(step, 26);
    };
    step();
  }
  function catchErrors() {
    caught.textContent = "";
    const rows = [
      ["lbl", "Brief caught"],
      ["ch", "<b>500</b> POST /api/pay"],
      ["ch", "<b>TypeError</b> checkout.js:88"],
    ];
    rows.forEach(([cls, html], i) => later(() => {
      const d = document.createElement("div");
      d.className = cls;
      d.innerHTML = html;
      caught.appendChild(d);
    }, i * 260));
  }
  function stopRec() {
    clearInterval(st.recIv);
    sayId++;
    const secs = clamp(Math.round((Date.now() - st.recStart) / 1000), 1, 59);
    st.tiles.push({ kind: "video", snap: snap(), dur: secs, errors: st.paidRec, fresh: true });
    capT.textContent = "";
    go("popup");
  }

  /* ── screenshot and drawing ── */
  let dpr = 1;
  let drawing: Point[] | null = null;
  function startShot() {
    st.strokes = [];
    st.shotSnap = snap();
    go("shot");
    sizeCanvas();
    redraw();
  }
  function sizeCanvas() {
    const r = wb.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  function redraw() {
    const c = canvas.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.strokeStyle = "#e5484d";
    c.lineWidth = 4;
    c.lineCap = "round";
    c.lineJoin = "round";
    st.strokes.forEach((s) => {
      c.beginPath();
      s.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      if (s.length === 1) c.lineTo(s[0][0] + 0.1, s[0][1]);
      c.stroke();
    });
  }
  const pt = (e: PointerEvent): Point => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", (e) => {
    if (st.phase !== "shot") return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = [pt(e)];
    st.strokes.push(drawing);
    redraw();
  }, on);
  canvas.addEventListener("pointermove", (e) => { if (drawing) { drawing.push(pt(e)); redraw(); } }, on);
  const endDraw = () => { if (drawing) { drawing = null; render(); } };
  canvas.addEventListener("pointerup", endDraw, on);
  canvas.addEventListener("pointercancel", endDraw, on);
  function saveShot() {
    const ink = st.strokes.length ? canvas.toDataURL("image/png") : null;
    st.tiles.push({ kind: "shot", snap: st.shotSnap, ink, fresh: true });
    go("popup");
  }

  /* ── create: the dot flies into the cloud, then the ticket writes itself ── */
  function send(draft: boolean) {
    if (st.phase !== "popup" || createBtn.disabled) return;
    st.draft = draft;
    go("sending");
    fly(draft ? draftBtn : createBtn, cloudBtn);
    later(() => {
      cloudBtn.classList.remove("landed"); void cloudBtn.offsetWidth; cloudBtn.classList.add("landed");
      $(toast, "span").textContent = draft ? "Draft queued" : "Ticket queued";
      toast.classList.add("on");
    }, reduce ? 0 : 640);
    later(() => { toast.classList.remove("on"); showTicket(); }, reduce ? 700 : 1900);
  }
  function fly(a: HTMLElement, b: HTMLElement) {
    if (reduce || !a.animate) return;
    const ra = box(a), rb = box(b);
    const x0 = ra.left + ra.width / 2, y0 = ra.top + ra.height / 2;
    const x1 = rb.left + rb.width / 2, y1 = rb.top + rb.height / 2;
    const mx = (x0 + x1) / 2 - 50, my = Math.min(y0, y1) + (Math.abs(y1 - y0) * 0.25);
    const dot = document.createElement("span");
    dot.className = "fly";
    win.appendChild(dot);
    dot.animate([
      { transform: "translate(" + x0 + "px," + y0 + "px) scale(1)", opacity: 1 },
      { transform: "translate(" + mx + "px," + my + "px) scale(1.35)", opacity: 1, offset: 0.5 },
      { transform: "translate(" + x1 + "px," + y1 + "px) scale(.35)", opacity: 0.3 },
    ], { duration: 640, easing: "cubic-bezier(.45,0,.25,1)" }).onfinish = () => dot.remove();
  }
  function skin() {
    const key: SkinKey = st.draft ? "draft" : st.tracker;
    const s = SKINS[key];
    tk.style.setProperty("--tc", s.color);
    tkLogo.setAttribute("href", "#td-" + s.logo);
    $(tk, ".tk-id").textContent = s.id;
    $(tk, ".tk-team").textContent = s.team;
    $(tk, ".tk-status").textContent = s.status;
    tk.querySelectorAll<HTMLElement>(".tk-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.arg === st.tracker)));
    setTab(key);
    endText();
  }
  /* the bar under a finished ticket: on to the next bug, or done */
  function endText() {
    const n = st.bug === BUGS.look ? 1 : 2;
    const where = SKINS[st.draft ? "draft" : st.tracker].name;
    $(tk, ".tk-endp").innerHTML = st.next
      ? "<b>Bug " + n + " is in " + where + ".</b>" + (st.next === "pay" ? "Next: Pay fails. This time, use Replay." : "Next: the CVC field. Take a screenshot.")
      : "<b>Both bugs reported.</b>";
  }

  function showTicket() {
    st.done = false;
    /* a video or a replay means the Pay bug; screenshots alone mean the CVC field */
    const pay = st.tiles.some((t) => t.kind !== "shot") || !st.tiles.length;
    st.bug = pay ? BUGS.pay : BUGS.look;
    const hasErr = pay && st.tiles.some((t) => (t.kind === "video" && t.errors) || (t.kind === "replay" && st.paid));
    tk.classList.toggle("draft", st.draft);
    tk.classList.remove("done");
    $(tk, ".tk-sum").textContent = st.bug.sum(hasErr);
    $(tk, ".tk-steps").innerHTML = st.bug.steps.map((x) => "<li>" + x + "</li>").join("");
    $(tk, ".tk-exp").textContent = st.bug.exp;
    $(tk, ".tk-act").textContent = st.bug.act;
    $(tk, ".tk-lab2").innerHTML = '<i style="background:' + st.bug.label[1] + '"></i>' + st.bug.label[0];
    const key: Goal = pay ? "pay" : "look";
    const other: Goal = pay ? "look" : "pay";
    st.next = reported[other] ? null : other;
    const nx = $(tk, ".tk-next");
    nx.hidden = !st.next;
    nx.dataset.arg = other;
    nx.classList.remove("auto");
    $(tk, ".tk-again").hidden = !!st.next;
    $(tk, ".tk-guide").hidden = !!st.next;
    const n = $(tk, ".tk-note");
    const typed = note.value.trim();
    n.hidden = !typed;
    n.textContent = typed ? "Reporter: “" + typed.slice(0, 280) + "”" : "";
    $(tk, ".tk-logs").hidden = !hasErr;
    const ev = $(tk, ".tk-ev");
    ev.textContent = "";
    let sn = 0;
    st.tiles.forEach((t) => {
      const f = document.createElement("figure");
      f.className = "ev " + t.kind;
      const th = document.createElement("div");
      th.className = "th";
      th.appendChild(mini(t, 224, 140));
      if (t.kind !== "shot") th.insertAdjacentHTML("beforeend", '<span class="play"><svg aria-hidden="true"><use href="#td-i-play"/></svg></span>');
      const c = document.createElement("figcaption");
      c.className = "cap2";
      if (t.kind === "shot") sn++;
      c.innerHTML = '<svg aria-hidden="true"><use href="#td-' + (t.kind === "shot" ? "i-shot" : t.kind === "replay" ? "i-replay" : "i-video") + '"/></svg>';
      c.append(t.kind === "video" ? "Recording, 0:" + String(t.dur).padStart(2, "0") + ", with your voice" : t.kind === "replay" ? "Replay, the last 60 seconds" : "Screenshot " + sn + (t.ink ? ", with your drawing" : ""));
      f.append(th, c);
      ev.appendChild(f);
    });
    ev.closest("section")!.hidden = !st.tiles.length;
    skin();
    tk.querySelectorAll("[data-r]").forEach((el) => el.classList.remove("in"));
    const sc = $(tk, ".tk-scroll");
    sc.scrollTop = 0;
    tkTitle.textContent = "";
    go("ticket");

    const title = st.bug.title;
    const items = [...tk.querySelectorAll<HTMLElement>("[data-r]")].filter((el) => !el.closest("[hidden]"));
    if (reduce) {
      tkTitle.textContent = title;
      items.forEach((el) => el.classList.add("in"));
      reported[key] = true; st.done = true; tk.classList.add("done"); render();
      return;
    }
    tkTitle.classList.add("typing");
    let i = 0;
    const typeT = () => {
      tkTitle.textContent = title.slice(0, ++i);
      if (i < title.length) later(typeT, 28);
      else later(() => tkTitle.classList.remove("typing"), 400);
    };
    later(typeT, 250);
    items.forEach((el, k) => later(() => {
      el.classList.add("in");
      /* keep the line being written in view, like watching it type */
      if (el.closest(".tk-side")) return;
      const below = el.getBoundingClientRect().bottom - sc.getBoundingClientRect().bottom;
      if (below > -24) sc.scrollBy({ top: below + 40, behavior: "smooth" });
    }, 500 + k * 240));
    later(() => {
      reported[key] = true;
      st.done = true;
      tk.classList.add("done");
      render();
      /* on to the next bug by itself; Let's go only skips the wait */
      if (st.next) {
        const next = st.next;
        nx.classList.add("auto");
        later(() => setGoal(next), 3500);
      }
    }, 600 + items.length * 240);
  }

  /* ── reset ── */
  function reset() {
    clearAll();
    sayId++;
    st = fresh();
    note.value = "";
    T("pay").classList.remove("loading", "failed");
    payErr.hidden = true;
    caught.textContent = "";
    capT.textContent = "";
    recT.textContent = "00:00";
    toast.classList.remove("on");
    cloudBtn.classList.remove("landed");
    tk.classList.remove("draft", "done");
    $(tk, ".tk-next").classList.remove("auto");
    tk.querySelectorAll("[data-r]").forEach((el) => el.classList.remove("in"));
    tkTitle.textContent = "";
    setTab("acme");
    drawing = null;
    render();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (st.phase === "chooser") act.sheetClose();
    else if (st.phase === "shot") act.shotCancel();
    else if (st.phase === "popup") go("idle");
  }, on);
  /* panels slide in and the page fades in: re-aim the hint once they land */
  win.addEventListener("transitionend", (e) => { if (e.propertyName === "transform") place(coachEl); }, on);
  demo.addEventListener("animationend", (e) => { if (e.target === demo) place(coachEl); }, on);
  let rz = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = window.setTimeout(() => { if (st.phase === "shot") { sizeCanvas(); redraw(); } coachUpdate(); }, 120);
  }, on);

  /* no start screen here: straight to the bug 1 intro, then the hints */
  reset();
  started = true;
  intro(goal, 300);
  render();

  return () => {
    dead = true;
    clearAll();
    clearTimeout(rz);
    listeners.abort();
  };
}
