// node --test extension/test/suspects.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSuspects } from '../suspects.js';

const T0 = 1_000_000;
const brief = (ms, payload) => ({ type: 5, timestamp: T0 + ms, data: { tag: 'brief', payload } });
const click = (ms, x = 100, y = 100) => ({ type: 3, timestamp: T0 + ms, data: { source: 2, type: 2, id: 1, x, y } });
const mutation = (ms, text) => ({
  type: 3,
  timestamp: T0 + ms,
  data: { source: 0, adds: text ? [{ parentId: 1, node: { type: 3, textContent: text, id: 9 } }] : [], removes: [], texts: [], attributes: [] },
});
const start = { type: 4, timestamp: T0, data: {} };

test('a failed request is the top suspect, with what failed', () => {
  const s = detectSuspects([start, click(1000), brief(1200, { kind: 'network', method: 'POST', url: 'https://app.acme.com/api/orders', status: 500, ms: 120 })], T0);
  assert.equal(s[0].kind, 'request-failed');
  assert.equal(s[0].t, 1200);
  assert.match(s[0].note, /POST \/api\/orders failed \(500\)/);
});

test('third-party noise is ignored', () => {
  const s = detectSuspects([start, brief(500, { kind: 'network', method: 'GET', url: 'https://www.google-analytics.com/collect', status: 0, ms: 10 })], T0);
  assert.equal(s.length, 0);
});

test('a JS error is found', () => {
  const s = detectSuspects([start, brief(800, { kind: 'js-error', message: "Cannot read properties of undefined (reading 'valid')" })], T0);
  assert.equal(s[0].kind, 'js-error');
  assert.match(s[0].note, /reading 'valid'/);
});

test('three clicks in the same spot are a rage click', () => {
  const s = detectSuspects([start, click(1000), mutation(1050), click(1300), mutation(1350), click(1600), mutation(1650)], T0);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'rage-click');
  assert.match(s[0].note, /3 times/);
});

test('a click that changes nothing is a dead click', () => {
  const s = detectSuspects([start, click(2000)], T0);
  assert.equal(s[0].kind, 'dead-click');
  const fine = detectSuspects([start, click(2000), mutation(2100)], T0);
  assert.equal(fine.length, 0);
});

test('error text appearing on the page is found', () => {
  const s = detectSuspects([start, click(500), mutation(700, 'Oops - something went wrong. Please try again later.')], T0);
  assert.equal(s[0].kind, 'error-text');
  assert.match(s[0].note, /something went wrong/i);
});

test('slow requests and reloads count, the first page load does not', () => {
  const s = detectSuspects(
    [start, brief(0, { kind: 'nav', load: true, url: 'x' }), brief(4000, { kind: 'network', method: 'GET', url: 'https://a.com/api/list', status: 200, ms: 4200 }), brief(9000, { kind: 'nav', load: true, url: 'x' })],
    T0,
  );
  assert.deepEqual(s.map((x) => x.kind), ['request-slow', 'reload']);
  assert.match(s[0].note, /took 4\.2s/);
});

test('one suspect per moment (the strongest), at most four, in time order', () => {
  const ev = [start];
  for (let i = 0; i < 8; i++) ev.push(brief(i * 3000, { kind: 'network', method: 'GET', url: `https://a.com/api/${i}`, status: i % 2 ? 500 : 404, ms: 50 }));
  ev.push(brief(3100, { kind: 'console-error', args: ['boom'] })); // same moment as a 500: the 500 wins
  const s = detectSuspects(ev, T0);
  assert.equal(s.length, 4);
  assert.ok(s.every((x) => x.kind === 'request-failed' && /500/.test(x.note)));
  assert.deepEqual(s.map((x) => x.t), [...s.map((x) => x.t)].sort((a, b) => a - b));
});

test('nothing wrong: no suspects', () => {
  assert.deepEqual(detectSuspects([start, click(1000), mutation(1100), brief(1200, { kind: 'network', method: 'GET', url: 'https://a.com/api', status: 200, ms: 90 })], T0), []);
});
