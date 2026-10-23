// Shared setup for the extension's end-to-end suites (concatenated with a
// suite by run.mjs): a test site, Chrome for Testing with the unpacked
// extension, raw CDP, and the helpers the suites use. See README.md.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = process.env.CHROME_PATH;
if (!CHROME) { console.error('Set CHROME_PATH to a Chrome for Testing binary (see extension/test/e2e/README.md)'); process.exit(2); }
const EXT = process.env.BRIEF_EXTENSION_DIR;
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'brief-e2e-out-'));
const SCRATCH = OUT; // screenshots and the rendered video land here
const PORT = 9398, WEB = 3996;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

const page = (title, body) => `<!doctype html><html><head><title>${title}</title>
<style>body{font:16px sans-serif;padding:40px;background:#fff} .err{color:#c00} button{font-size:18px;padding:8px 16px}</style></head><body>${body}</body></html>`;
const PAGES = {
  '/home': page('Home', `<h2>Marketing home</h2><p>Visits: <b id="n">0</b></p><button id="add">Add</button><a id="go" href="/settings">Settings</a>
<script>let n=0;add.onclick=()=>{n++;document.getElementById('n').textContent=n;};</script>`),
  '/settings': page('Settings', `<h2>Account settings</h2><button id="add">Save</button><p id="n"></p><script>add.onclick=()=>{document.getElementById('n').textContent='saved';};</script>`),
  '/secret': page('Mail', `<h2>SECRET-UNWATCHED inbox</h2><input id="card"/><button id="add">Send</button>`),
  // its last script takes 4s: the page shows, but it hasn't finished loading
  '/slow': page('Slow', `<h2>Reports</h2><p>Loading the rest</p><script src="/slow.js"></script>`),
  '/': page('Checkout', `<h2>Checkout</h2><p>Items: <b id="n">0</b></p><input id="card" placeholder="Card number"/>
<button id="add">Add item</button> <button id="pay">Pay</button><p id="msg"></p>
<script>let n=0;add.onclick=()=>{n++;document.getElementById('n').textContent=n;};
const cv=document.createElement('canvas');cv.width=24;cv.height=24;const g=cv.getContext('2d');g.fillStyle='#dd6936';g.fillRect(0,0,24,24);cv.toBlob((b)=>{const u=URL.createObjectURL(b);const im=new Image();im.id='blobimg';im.onload=()=>URL.revokeObjectURL(u);im.src=u;document.body.appendChild(im);});
pay.onclick=()=>{msg.className='err';msg.textContent='Payment failed: 500 Internal Server Error';fetch('/api/pay?token=abc123&amount=5',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount:5,password:'hunter2'})}).catch(()=>{});console.error('pay failed', 500);};</script>`),
};
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/slow.js')) { setTimeout(() => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('window.slowDone = true;'); }, 4000); return; }
  if (req.url.startsWith('/api/pay')) { setTimeout(() => { res.writeHead(500, { 'content-type': 'application/json', 'x-request-id': 'req-7f3a9c' }); res.end('{"error":"boom","session":"s3cr3t"}'); }, 1200); return; }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGES[req.url.split('?')[0]] || PAGES['/']);
}).listen(WEB);

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-browser-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`,
  '--enable-unsafe-extension-debugging', '--window-size=1400,900', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });

let msgId = 0;
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const pending = new Map(); const listeners = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else listeners.forEach((l) => l(m)); };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++msgId; const to = setTimeout(() => { pending.delete(id); reject(new Error(method + ': timeout')); }, 15000);
    pending.set(id, (m) => { clearTimeout(to); m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result); });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { send, on: (l) => listeners.push(l) };
}

async function main() {
  let ver;
  for (let i = 0; i < 150; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  const b = await connect(ver.webSocketDebuggerUrl);
  const exceptions = [];
  b.on((m) => { if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  const attach = async (targetId) => { const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true }); await b.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {}); return sessionId; };
  const evalIn = async (sid, expression) => {
    const r = await b.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const { id: extId } = await b.send('Extensions.loadUnpacked', { path: path.resolve(EXT) });
  const { targetId: driverT } = await b.send('Target.createTarget', { url: `chrome-extension://${extId}/player.html` });
  await sleep(800);
  const dS = await attach(driverT);
  const W = (e) => evalIn(dS, e).catch((err) => /timeout/.test(err.message) ? evalIn(dS, e) : Promise.reject(err));
  await W(`chrome.storage.local.set({ replaySites: ['*.brief.localhost'], micGrantedAt: Date.now() })`);

  const open = async (url) => {
    const { targetId } = await b.send('Target.createTarget', { url });
    const sid = await attach(targetId); await b.send('Runtime.enable', {}, sid); await b.send('Page.enable', {}, sid);
    return { targetId, sid };
  };
  const click = async (sid, sel) => {
    const { x, y } = await evalIn(sid, `(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, sid);
    await sleep(400);
  };
  const focus = async (t) => { await b.send('Target.activateTarget', { targetId: t.targetId }); await sleep(700); };
