// node --test extension/test/replay-merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skipIdle, cutTimeline } from '../replay-merge.js';

const T0 = 1_000_000;
const meta = (ms) => ({ type: 4, timestamp: T0 + ms, data: { href: 'https://app.test/search' } });
const full = (ms) => ({ type: 2, timestamp: T0 + ms, data: {} });
const click = (ms) => ({ type: 3, timestamp: T0 + ms, data: { source: 2, type: 2, id: 1, x: 10, y: 10 } });
const mutation = (ms) => ({ type: 3, timestamp: T0 + ms, data: { source: 0, adds: [], removes: [], texts: [], attributes: [] } });
const net = (ms) => ({ type: 5, timestamp: T0 + ms, data: { tag: 'brief', payload: { kind: 'network', method: 'GET', url: '/api/search', status: 200, ms: 9000 } } });

test('a slow call that returns after a long pause keeps itself and what follows it in the replay', () => {
  // the call comes back 9 s after the click, a millisecond before the page shows the results
  const events = [meta(0), full(20), click(4000), net(13000), mutation(13001)];
  const end = T0 + 15000;
  const view = skipIdle(events, [{ a: T0, b: end, recorded: true }], { end });
  const times = view.events.map((e) => e.timestamp);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'still in time order once the pause is squeezed');

  const t0 = view.events[0].timestamp;
  const last = view.events[view.events.length - 1].timestamp;
  const cut = cutTimeline(view.events, view.segments, [{ a: t0, b: last }]);
  assert.equal(cut.events.length, events.length, 'nothing is cut away');
  assert.ok(cut.events.some((e) => e.type === 5), 'the slow call is in the replay');
});

test('a squeezed pause still plays 1.5 s, and the moments around it keep their order', () => {
  const view = skipIdle([meta(0), full(20), click(1000), mutation(20000)], [], { end: T0 + 21000 });
  assert.equal(view.events[3].timestamp - view.events[2].timestamp, 1500);
});
