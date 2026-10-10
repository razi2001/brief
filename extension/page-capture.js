// Brief - what happens inside the page, for the ticket's technical details
//
// installPageCapture runs in the page's own world (chrome.scripting
// executeScript, world: 'MAIN'), so it is serialized: everything it needs lives
// inside it. It reports with window.postMessage({ __brief: ... }), which our
// content scripts pick up - content.js for a recording, replay.js for the
// replay buffer:
//
//   network          every fetch / XHR: method, url, status, ms (bodies never)
//   network-error    a failed one (kept for servers that predate `network`)
//   console-error / console-warn / js-error / promise-rejection
//   nav              the address changed inside the app (pushState, hash...)
//
// URLs keep their path, but the values of query parameters that look like
// secrets (token, key, password, auth, session, signature, code) are masked.
export function installPageCapture() {
  if (window.__briefConsoleInstalled) return;
  window.__briefConsoleInstalled = true;

  const post = (msg) => { try { window.postMessage(msg, '*'); } catch {} };
  const serialize = (a) => {
    try {
      if (a == null) return String(a);
      if (typeof a === 'string') return a.slice(0, 500);
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      return JSON.stringify(a).slice(0, 500);
    } catch {
      return String(a).slice(0, 500);
    }
  };
  const SECRET = /token|key|secret|pass|auth|session|sig|code|credential/i;
  const clean = (u) => {
    try {
      const url = new URL(String(u), location.href);
      for (const k of [...url.searchParams.keys()]) if (SECRET.test(k)) url.searchParams.set(k, '***');
      const s = url.href;
      return s.length > 400 ? `${s.slice(0, 400)}…` : s;
    } catch {
      return String(u).slice(0, 400);
    }
  };

  // ---- console ----
  const origError = console.error;
  console.error = function (...args) {
    post({ __brief: 'console-error', args: args.map(serialize) });
    return origError.apply(this, args);
  };
  const origWarn = console.warn;
  console.warn = function (...args) {
    post({ __brief: 'console-warn', args: args.map(serialize) });
    return origWarn.apply(this, args);
  };
  window.addEventListener('error', (e) => {
    post({ __brief: 'js-error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno });
  });
  window.addEventListener('unhandledrejection', (e) => {
    post({ __brief: 'promise-rejection', reason: serialize(e.reason) });
  });

  // ---- network: every request, with how long it took ----
  const net = (method, url, status, ms, reason) => {
    const m = (method || 'GET').toUpperCase();
    const u = clean(url);
    const failed = !status || status >= 400;
    post({ __brief: 'network', method: m, url: u, status: status || 0, ms: Math.round(ms), reason: reason || '' });
    if (failed) post({ __brief: 'network-error', method: m, url: u, status: status || 0, reason: reason || '' });
  };
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const t0 = performance.now();
      return origFetch.apply(this, arguments).then((res) => {
        net(method, url, res && res.status, performance.now() - t0, res && !res.ok ? res.statusText : '');
        return res;
      }, (err) => {
        net(method, url, 0, performance.now() - t0, (err && err.message) || 'network error');
        throw err;
      });
    };
  }
  try {
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const open = XHR.prototype.open;
      const send = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__brief_m = method; this.__brief_u = url;
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        const t0 = performance.now();
        this.addEventListener('loadend', () => {
          const reason = this.status ? (this.status >= 400 ? this.statusText : '') : 'network error';
          net(this.__brief_m, this.__brief_u, this.status, performance.now() - t0, reason);
        });
        return send.apply(this, arguments);
      };
    }
  } catch {}

  // ---- the page's address, as the app changes it ----
  let last = location.href;
  const nav = () => {
    if (location.href === last) return;
    last = location.href;
    post({ __brief: 'nav', url: clean(location.href), title: document.title });
  };
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function () { const r = orig.apply(this, arguments); setTimeout(nav, 0); return r; };
  }
  window.addEventListener('popstate', nav);
  window.addEventListener('hashchange', nav);
}
