// Brief - what happens inside the page, for the ticket's technical logs
//
// installPageCapture runs in the page's own world (chrome.scripting
// executeScript, world: 'MAIN'), so it is serialized: everything it needs lives
// inside it. It reports with window.postMessage({ __brief: ... }), which our
// content scripts pick up - content.js for a recording, replay.js for the
// replay buffer. Every message carries `at`: the real time (epoch ms), which a
// replay's cut-out idle time can't shift, so the ticket can give the clock
// time a server log would show.
//
//   network          every fetch / XHR: method, url, status, ms, and the
//                    backend's trace id when the response carries one; a
//                    FAILED call (4xx/5xx/no answer) also its request and
//                    response bodies, a SLOW one (1 s+) its request body -
//                    text only, 2 KB each, secrets masked
//   network-error    a failed one (kept for servers that predate `network`)
//   console-error / console-warn / js-error / promise-rejection
//   nav              the page's address (on load, and as the app changes it)
//
// URLs keep their path; the values of query parameters whose names look like
// secrets are masked, and so are the same fields inside bodies.
export function installPageCapture() {
  if (window.__briefConsoleInstalled) return;
  window.__briefConsoleInstalled = true;

  const post = (msg) => { try { window.postMessage({ ...msg, at: Date.now() }, '*'); } catch {} };
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
  const SECRET = /token|key|secret|pass|auth|session|sig|code|credential|cookie|card|cvv|cvc|iban|ssn/i;
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

  // ---- bodies of failed calls: text only, capped, secrets masked ----
  const BODY_MAX = 2000;
  const maskJson = (v, depth = 0) => {
    if (depth > 8 || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => maskJson(x, depth + 1));
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '***' : maskJson(x, depth + 1);
    return out;
  };
  const maskBody = (text) => {
    if (typeof text !== 'string' || !text) return '';
    const t = text.trim();
    if (/^[[{]/.test(t)) {
      try { return JSON.stringify(maskJson(JSON.parse(t))).slice(0, BODY_MAX); } catch {}
    }
    // form-encoded / free text: mask `name=value` and `"name": value` pairs
    return t
      .replace(/([?&]|^)([^=&\s]+)=([^&\s]*)/g, (m, p, k, v) => (SECRET.test(k) ? `${p}${k}=***` : m))
      .replace(/("?)([\w-]+)\1(\s*[:=]\s*)("[^"]*"|[^\s,}]+)/g, (m, q, k, sep) => (SECRET.test(k) ? `${q}${k}${q}${sep}"***"` : m))
      .slice(0, BODY_MAX);
  };
  const bodyText = (body) => {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return ''; // FormData, Blob, streams: not text we can show safely
  };
  const TRACE = ['x-request-id', 'request-id', 'x-correlation-id', 'x-ms-request-id', 'traceparent', 'x-amzn-trace-id', 'x-trace-id', 'x-b3-traceid', 'x-cloud-trace-context'];
  const traceOf = (get) => {
    for (const h of TRACE) {
      try { const v = get(h); if (v) return `${h}: ${String(v).slice(0, 120)}`; } catch {}
    }
    return '';
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

  // ---- network: every request, how long it took, and its trace id ----
  const net = (c) => {
    const m = (c.method || 'GET').toUpperCase();
    const u = clean(c.url);
    const failed = !c.status || c.status >= 400;
    const msg = { method: m, url: u, status: c.status || 0, ms: Math.round(c.ms), reason: c.reason || '' };
    if (c.trace) msg.trace = c.trace;
    // a failed call: what was sent and what came back; a slow one: what was
    // sent (often why it was slow). Never for calls that just worked.
    const slow = c.ms >= 1000;
    if ((failed || slow) && c.request) msg.request = maskBody(c.request);
    if (failed && c.response) msg.response = maskBody(c.response);
    post({ __brief: 'network', ...msg });
    if (failed) post({ __brief: 'network-error', method: m, url: u, status: c.status || 0, reason: c.reason || '' });
  };
  const isText = (type) => !type || /json|text|xml|javascript|x-www-form-urlencoded|problem/i.test(type);

  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const request = bodyText(init && init.body);
      const t0 = performance.now();
      return origFetch.apply(this, arguments).then((res) => {
        const ms = performance.now() - t0;
        const status = res && res.status;
        const trace = res ? traceOf((h) => res.headers.get(h)) : '';
        if (res && !res.ok && isText(res.headers.get('content-type'))) {
          // a copy: the page still reads its own response
          res.clone().text().then(
            (response) => net({ method, url, status, ms, reason: res.statusText, trace, request, response }),
            () => net({ method, url, status, ms, reason: res.statusText, trace, request }),
          );
        } else {
          net({ method, url, status, ms, reason: res && !res.ok ? res.statusText : '', trace, request });
        }
        return res;
      }, (err) => {
        net({ method, url, status: 0, ms: performance.now() - t0, reason: (err && err.message) || 'network error', request });
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
      XHR.prototype.send = function (body) {
        const t0 = performance.now();
        const request = bodyText(body);
        this.addEventListener('loadend', () => {
          const status = this.status;
          const reason = status ? (status >= 400 ? this.statusText : '') : 'network error';
          let response = '';
          try {
            if (status >= 400 && (this.responseType === '' || this.responseType === 'text') && isText(this.getResponseHeader('content-type'))) response = this.responseText;
            else if (status >= 400 && this.responseType === 'json' && this.response) response = JSON.stringify(this.response);
          } catch {}
          net({ method: this.__brief_m, url: this.__brief_u, status, ms: performance.now() - t0, reason, trace: traceOf((h) => this.getResponseHeader(h)), request, response });
        });
        return send.apply(this, arguments);
      };
    }
  } catch {}

  // ---- the page's address: where it starts, then as the app changes it ----
  let last = location.href;
  // `load`: the page itself (re)loaded, as opposed to the app changing its address
  post({ __brief: 'nav', url: clean(location.href), title: document.title, load: true });
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
