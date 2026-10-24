// Builds the ticket eval's SCREEN RECORDING cases (rec-*): a reporter talks
// through a recording that crosses pages, so the writer has to work out from
// what they say, and when, where the bug is. The replay cases come from the
// real extension (extension/test/e2e/record-cases.mjs); these are put together
// the way the extension would upload them: brief.json with the capture's event
// log, keyframes every 2 s, and audio.webm, the reporter's voice (OpenAI TTS,
// each sentence at its moment). overrides.json carries the transcript the
// popup would send.
//
//   CHROME_PATH=<any chrome> node scripts/ticket-eval/make-recording-cases.mjs [case ...] [--env <file>]
//
// Needs ffmpeg on the PATH and OPENAI_API_KEY (from the environment, else --env,
// default web/.env.local).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
if (!process.env.OPENAI_API_KEY) {
  try {
    for (const line of readFileSync(arg("env", path.join(here, "..", "..", ".env.local")), "utf8").split(/\r?\n/)) {
      const m = /^\s*(OPENAI_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) process.env.OPENAI_API_KEY = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
}
const CHROME = process.env.CHROME_PATH;
if (!CHROME || !process.env.OPENAI_API_KEY) {
  console.error("Set CHROME_PATH and OPENAI_API_KEY (or pass --env <file>)");
  process.exit(2);
}

// ---------- the pages ----------
const page = ({ app, accent = "#2f6fed", nav = [], body }) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#1d2330;background:#f6f7f9}
header{display:flex;align-items:center;gap:22px;padding:14px 28px;background:#fff;border-bottom:1px solid #e3e6eb}
header b{font-size:17px;color:${accent}}header a{color:#4a5262;text-decoration:none}header .on{color:#1d2330;font-weight:600}
main{padding:26px 28px;max-width:940px}h1{font-size:22px;margin:0 0 16px}
.card{background:#fff;border:1px solid #e3e6eb;border-radius:10px;padding:18px 20px;margin-bottom:14px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px 6px;border-bottom:1px solid #eef0f3}th{color:#6b7280;font-weight:500;font-size:13px}
.r{text-align:right}button{font:inherit;padding:8px 16px;border-radius:7px;border:1px solid ${accent};background:${accent};color:#fff}
button.ghost{background:#fff;color:${accent}}input{font:inherit;padding:8px 10px;border:1px solid #cfd4dc;border-radius:7px;width:220px}
.row{display:flex;gap:10px;align-items:center}.muted{color:#6b7280}.tot{font-size:20px;font-weight:700}
</style></head><body><header><b>${app}</b>${nav.map((n) => `<a class="${n.on ? "on" : ""}">${n.label}</a>`).join("")}</header><main>${body}</main></body></html>`;

const shopNav = (on) => ["Products", "Cart", "Orders"].map((label) => ({ label, on: label === on }));
const cartItems = `<table><tr><th>Item</th><th>Qty</th><th class="r">Price</th></tr>
<tr><td>Trail running shoes</td><td>1</td><td class="r">$64.00</td></tr><tr><td>Merino socks</td><td>2</td><td class="r">$20.00</td></tr></table>`;
const checkout = ({ code = "", busy = false }) =>
  page({
    app: "Acme Shop",
    nav: shopNav(""),
    body: `<h1>Checkout</h1><div class="card">${cartItems}</div>
<div class="card"><div class="muted" style="margin-bottom:8px">Coupon code</div><div class="row"><input value="${code}" placeholder="Enter a code"><button class="ghost"${busy ? " disabled" : ""}>${busy ? "Applying…" : "Apply"}</button></div></div>
<div class="card row" style="justify-content:space-between"><span>Total</span><span class="tot">$84.00</span></div><button>Place order</button>`,
  });

const facturoNav = (on) => ["Tableau de bord", "Factures", "Clients"].map((label) => ({ label, on: label === on }));
const invoices = page({
  app: "Facturo",
  accent: "#0f8a6a",
  nav: facturoNav("Factures"),
  body: `<h1>Factures</h1><div class="card"><table><tr><th>N°</th><th>Client</th><th>Statut</th><th class="r">Montant</th></tr>
<tr><td><a style="color:#0f8a6a">F-1043</a></td><td>Boulangerie Martin</td><td>Brouillon</td><td class="r">58,00 €</td></tr>
<tr><td><a style="color:#0f8a6a">F-1042</a></td><td>Atelier Durand</td><td>Envoyée</td><td class="r">100,00 €</td></tr>
<tr><td><a style="color:#0f8a6a">F-1041</a></td><td>Café du Port</td><td>Payée</td><td class="r">312,50 €</td></tr></table></div>`,
});
const invoice = page({
  app: "Facturo",
  accent: "#0f8a6a",
  nav: facturoNav("Factures"),
  body: `<h1>Facture F-1042</h1><div class="card"><div class="row" style="justify-content:space-between"><span>Client : <b>Atelier Durand</b></span><span>Émise le 3 février 2026</span></div>
<div class="muted" style="margin-top:6px">Due: March 3, 2026</div></div>
<div class="card"><table><tr><th>Désignation</th><th>Qté</th><th class="r">Prix unitaire</th><th class="r">Total</th></tr>
<tr><td>Atelier photo produit</td><td>1</td><td class="r">40,00 €</td><td class="r">40,00 €</td></tr>
<tr><td>Retouches (lot de 10)</td><td>1</td><td class="r">40,00 €</td><td class="r">40,00 €</td></tr>
<tr><td>Livraison des fichiers</td><td>1</td><td class="r">40,00 €</td><td class="r">40,00 €</td></tr></table></div>
<div class="card row" style="justify-content:space-between"><span>Total TTC</span><span class="tot">100,00 €</span></div>`,
});

const todoNav = (on) => ["To-dos", "Settings"].map((label) => ({ label, on: label === on }));
const todos = (items) =>
  page({
    app: "Tasks",
    accent: "#7c4dff",
    nav: todoNav("To-dos"),
    body: `<h1>To-dos</h1><div class="card"><div class="row"><input placeholder="New to-do"><button>Add</button></div></div><div class="card">${items
      .map(([t, done]) => `<div class="row" style="padding:7px 0"><input type="checkbox"${done ? " checked" : ""} style="width:auto"><span${done ? ' style="text-decoration:line-through;color:#9aa1ad"' : ""}>${t}</span></div>`)
      .join("")}</div>`,
  });
const todoSettings = page({
  app: "Tasks",
  accent: "#7c4dff",
  nav: todoNav("Settings"),
  body: `<h1>Settings</h1><div class="card"><div class="muted">Theme</div><div>Light</div></div><div class="card"><div class="muted">Week starts on</div><div>Monday</div></div>`,
});

// ---------- the cases ----------
// A beat: the reporter says something (or not), and what they do lands while
// they say it. Actions: click(label), nav(path, title), net(method, path, status, ms, response?).
const click = (text) => ({ click: text });
const nav = (p, title) => ({ nav: p, title });
const net = (method, p, status, ms, response) => ({ net: { method, p, status, ms, response } });

const CASES = {
  "rec-coupon-midway": {
    origin: "https://shop.acme.test",
    start: { path: "/products", title: "Products - Acme Shop" },
    voice: "alloy",
    states: {
      shop: page({ app: "Acme Shop", nav: shopNav("Products"), body: `<h1>Products</h1><div class="card">Trail running shoes · $64.00</div><div class="card">Merino socks · $10.00</div><div class="card">Rain jacket · $120.00</div>` }),
      cart: page({ app: "Acme Shop", nav: shopNav("Cart"), body: `<h1>Your cart</h1><div class="card">${cartItems}</div><button>Checkout</button>` }),
      checkout: checkout({}),
      typed: checkout({ code: "SPRING10" }),
      applying: checkout({ code: "SPRING10", busy: true }),
    },
    beats: [
      { say: "Okay, I'm on the shop.", state: "shop" },
      { say: "I open my cart.", then: [click("Cart"), nav("/cart", "Your cart - Acme Shop")], state: "cart" },
      { say: "Two items, that's right. I go to checkout.", then: [click("Checkout"), nav("/checkout", "Checkout - Acme Shop")], state: "checkout" },
      { say: "I type my coupon code, SPRING10, and I click Apply.", then: [click("Enter a code"), { state: "typed" }, click("Apply"), { state: "applying" }, net("POST", "/api/coupons/apply", 500, 640, '{"error":"coupon service unavailable"}'), { state: "typed" }] },
      { say: "And nothing. No message, and the total is still eighty four dollars." },
      { say: "It should take ten percent off, or at least tell me the code doesn't work." },
      { say: "Anyway, I'll go back to the products.", then: [click("Products"), nav("/products", "Products - Acme Shop")], state: "shop" },
      { say: "That's it." },
    ],
    expect: {
      kind: "failure",
      page: "/checkout",
      bug: "Applying a coupon at checkout does nothing: the coupon request fails with a server error, the page shows no message and the total stays $84.00.",
      facts: [
        "The reporter typed the code SPRING10 and clicked Apply on /checkout.",
        "POST /api/coupons/apply returns 500 with the body {\"error\":\"coupon service unavailable\"} after about 0.6 s.",
        "The recording starts on /products, goes to /cart and /checkout, and ends back on /products.",
      ],
      variants: [{ name: "narrated" }, { name: "described", description: "coupon not applied" }],
    },
  },
  "rec-invoice-total-fr": {
    origin: "https://app.facturo.test",
    start: { path: "/invoices", title: "Factures - Facturo" },
    voice: "alloy",
    states: { invoices, invoice },
    beats: [
      { say: "Bon, je suis sur la liste des factures.", state: "invoices" },
      { say: "J'ouvre la facture 1042.", then: [click("F-1042"), nav("/invoices/1042", "Facture F-1042 - Facturo"), net("GET", "/api/invoices/1042", 200, 120)], state: "invoice" },
      { say: "Il y a trois lignes à quarante euros." },
      { say: "Donc normalement, le total devrait faire cent vingt euros." },
      { say: "Mais regarde, le total affiche cent euros. C'est faux." },
      { say: "Et aussi, la date d'échéance est en anglais, alors que tout le reste est en français." },
      { say: "Je retourne à la liste.", then: [click("Factures"), nav("/invoices", "Factures - Facturo")], state: "invoices" },
    ],
    expect: {
      kind: "ui",
      page: "/invoices/1042",
      also: "The due date is shown in English (\"Due: March 3, 2026\") while the rest of the page is in French.",
      bug: "Invoice F-1042 shows a total of 100,00 € although its three lines at 40,00 € add up to 120,00 €.",
      facts: [
        "GET /api/invoices/1042 returns 200; no request fails and nothing is logged.",
        "The invoice list also shows 100,00 € for F-1042.",
        "The due date line reads \"Due: March 3, 2026\" in English while the rest of the page is in French.",
      ],
      variants: [{ name: "narrated" }],
    },
  },
  "rec-todo-clean": {
    origin: "https://todo.acme.test",
    start: { path: "/todos", title: "To-dos - Tasks" },
    voice: "alloy",
    states: {
      list: todos([["Call the plumber", false], ["Book flights", true]]),
      added: todos([["Call the plumber", false], ["Book flights", true], ["Buy milk", false]]),
      ticked: todos([["Call the plumber", false], ["Book flights", true], ["Buy milk", true]]),
      settings: todoSettings,
    },
    beats: [
      { say: "So this is my to-do list.", state: "list" },
      { say: "I add a new one, buy milk, and I press Add.", then: [click("New to-do"), click("Add"), net("POST", "/api/todos", 201, 90)], state: "added" },
      { say: "There it is." },
      { say: "I tick it.", then: [click("Buy milk"), net("PATCH", "/api/todos/7", 200, 70)], state: "ticked" },
      { say: "Okay. Something felt a bit off, I don't know." },
      { say: "Let me look at the settings.", then: [click("Settings"), nav("/settings", "Settings - Tasks")], state: "settings" },
    ],
    expect: {
      kind: "none",
      bug: "Nothing is wrong: adding a to-do and ticking it both work; the reporter only says something felt off.",
      facts: ["POST /api/todos returns 201 and the item appears; PATCH /api/todos/7 returns 200 and it shows ticked.", "No request fails and no error is logged."],
      variants: [{ name: "narrated" }],
    },
  },
};

// ---------- building one ----------
const work = mkdtempSync(path.join(os.tmpdir(), "brief-rec-cases-"));
const ffprobe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

async function speak(text, voice, file) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3", instructions: "A tester talking through a bug while recording their screen: casual, natural pace." }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return ffprobe(file) * 1000;
}

function shoot(html, file) {
  const src = path.join(work, `${path.basename(file)}.html`);
  writeFileSync(src, html);
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--screenshot=${file}`, "--window-size=1000,625", pathToFileURL(src).href], { stdio: "ignore" });
}

async function build(name, c) {
  const out = path.join(here, "cases", name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, "keyframes"), { recursive: true });
  const at0 = Date.parse("2026-10-20T09:14:05.000Z");
  const events = [];
  const stateAt = []; // [t, state]
  const clips = []; // [t, file]
  let url = c.origin + c.start.path;
  let t = 600;
  for (const [i, b] of c.beats.entries()) {
    let ms = 0;
    if (b.say) {
      const file = path.join(work, `${name}-${i}.mp3`);
      ms = await speak(b.say, c.voice, file);
      clips.push([t, file]);
    }
    // what they do lands while they say it, a little apart; the screen changes
    // with the page it opens, or once what they did is done
    let ta = t + Math.min(ms * 0.55, 1800);
    const opens = (b.then ?? []).some((a) => a.nav);
    for (const a of b.then ?? []) {
      if (a.click) events.push({ type: "click", tMs: Math.round(ta), at: at0 + Math.round(ta), url, element: { tag: "button", selector: "button", text: a.click }, x: 400, y: 300 });
      if (a.nav) {
        url = c.origin + a.nav;
        events.push({ type: "nav", tMs: Math.round(ta + 250), at: at0 + Math.round(ta + 250), url, title: a.title, load: false });
        if (b.state) stateAt.push([ta + 250, b.state]);
      }
      if (a.state) stateAt.push([ta, a.state]);
      if (a.net) {
        const n = a.net;
        events.push({ type: "network", tMs: Math.round(ta + 80), at: at0 + Math.round(ta + 80), method: n.method, url: c.origin + n.p, status: n.status, ms: n.ms, ...(n.response ? { response: n.response } : {}) });
        ta += n.ms;
      }
      ta += 500;
    }
    if (b.state && !opens) stateAt.push([b.then?.length ? ta : t, b.state]);
    t = Math.max(t + ms + 700, ta + 300);
  }
  const durationMs = Math.round(t + 800);
  stateAt.sort((a, b) => a[0] - b[0]);
  const stateAtT = (x) => {
    let s = stateAt[0][1];
    for (const [ts, st] of stateAt) if (ts <= x) s = st;
    return s;
  };

  // keyframes every 2 s, like the recorder; only the ones where the screen
  // changed are kept (loading drops the repeats anyway)
  const shots = new Map();
  for (const [st, html] of Object.entries(c.states)) {
    const f = path.join(work, `${name}-${st}.png`);
    shoot(html, f);
    shots.set(st, readFileSync(f));
  }
  const keyframes = [];
  let shown = "";
  for (let k = 0, x = 0; x < durationMs; k++, x += 2000) {
    const st = stateAtT(x);
    if (st === shown) continue;
    shown = st;
    const file = `keyframes/keyframe-${String(k).padStart(3, "0")}.png`;
    writeFileSync(path.join(out, file), shots.get(st));
    keyframes.push({ index: k, timestamp: x, file });
  }

  // the voice: each sentence at its moment, as the mic track
  const inputs = clips.flatMap(([, f]) => ["-i", f]);
  const delays = clips.map(([ts], i) => `[${i}:a]adelay=${Math.round(ts)}:all=1[a${i}]`).join(";");
  const mix = `${delays};${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0,apad[out]`;
  execFileSync("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", mix, "-map", "[out]", "-t", String(durationMs / 1000), "-c:a", "libopus", "-b:a", "32k", path.join(out, "audio.webm")]);

  const transcript = c.beats.map((b) => b.say).filter(Boolean).join(" ");
  const brief = {
    id: name,
    schemaVersion: 2,
    createdAt: new Date(at0).toISOString(),
    durationMs,
    intent: "brief",
    pageUrl: c.origin + c.start.path,
    pageTitle: c.start.title,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
    transcript: null,
    transcriptChunks: [],
    keyframes,
    events,
    description: "",
    hasScreenshot: false,
    screenshots: [],
    includeVideo: true,
    extra: [],
    recording: { file: "recording.webm", mimeType: "video/webm", durationMs },
  };
  writeFileSync(path.join(out, "brief.json"), JSON.stringify(brief, null, 2));
  writeFileSync(path.join(out, "overrides.json"), JSON.stringify({ title: "", includeVideo: true, transcript, description: "", extra: [], screenshots: [] }, null, 2));
  writeFileSync(path.join(out, "expect.json"), JSON.stringify(c.expect, null, 2));
  console.log(`${name}: ${keyframes.length} keyframes, ${events.length} events, ${(durationMs / 1000).toFixed(1)} s`);
}

const pick = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
for (const name of pick.length ? pick : Object.keys(CASES)) {
  if (!CASES[name]) throw new Error(`no case "${name}" (have: ${Object.keys(CASES).join(", ")})`);
  await build(name, CASES[name]);
}
rmSync(work, { recursive: true, force: true });
