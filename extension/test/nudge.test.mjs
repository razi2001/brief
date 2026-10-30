// node --test extension/test/nudge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a chrome.storage.local in memory, for claimNudge / markUsed / markClosed
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => { Object.assign(store, structuredClone(o)); },
    },
  },
};
const { nudgeDue, nudgePageOk, claimNudge, markUsed, markClosed, QUIET_MS, EVERY_MS } = await import('../nudge.js');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 12);
const due = (o) => nudgeDue({ now: NOW, paired: true, recording: false, ...o });

test('due after 7 days without a brief, never before', () => {
  assert.equal(QUIET_MS, 7 * DAY);
  assert.equal(due({ usedAt: NOW - 8 * DAY }), true);
  assert.equal(due({ usedAt: NOW - 7 * DAY }), true);
  assert.equal(due({ usedAt: NOW - 7 * DAY + 1 }), false);
  assert.equal(due({ usedAt: NOW - DAY }), false);
});

test('at most once a week', () => {
  assert.equal(EVERY_MS, 7 * DAY);
  assert.equal(due({ usedAt: NOW - 30 * DAY, shownAt: NOW - 2 * DAY }), false);
  assert.equal(due({ usedAt: NOW - 30 * DAY, shownAt: NOW - 7 * DAY }), true);
});

test('never unpaired, never while recording, never without a start to count from', () => {
  assert.equal(due({ usedAt: NOW - 8 * DAY, paired: false }), false);
  assert.equal(due({ usedAt: NOW - 8 * DAY, recording: true }), false);
  assert.equal(due({}), false);
});

test('the page: a Replay site when there are some, any web page otherwise', () => {
  const sites = ['app.acme.com', '*.thunders.ai'];
  assert.equal(nudgePageOk('https://app.acme.com/settings', { sites }), true);
  assert.equal(nudgePageOk('https://x.thunders.ai/', { sites }), true);
  assert.equal(nudgePageOk('https://news.ycombinator.com/', { sites }), false);
  assert.equal(nudgePageOk('https://news.ycombinator.com/', { sites: [] }), true);
  assert.equal(nudgePageOk('http://localhost:5173/', {}), true);
});

test('the page: never Brief itself, never a browser page', () => {
  const appUrl = 'https://cloud.get-brief.app';
  for (const url of ['https://get-brief.app/', 'https://get-brief.app/pricing', 'https://cloud.get-brief.app/tickets', 'https://www.get-brief.app/']) {
    assert.equal(nudgePageOk(url, { appUrl }), false, url);
    assert.equal(nudgePageOk(url, { appUrl, sites: ['*.get-brief.app'] }), false, url);
  }
  // a local Brief app (config.js ENV = "local")
  assert.equal(nudgePageOk('http://localhost:3000/tickets', { appUrl: 'http://localhost:3000' }), false);
  assert.equal(nudgePageOk('http://localhost:3001/', { appUrl: 'http://localhost:3000' }), true);
  for (const url of ['chrome://extensions', 'chrome-extension://abc/popup.html', 'about:blank', 'file:///C:/x.html', 'not a url']) {
    assert.equal(nudgePageOk(url, {}), false, url);
  }
});

const claim = (o) => claimNudge({ url: 'https://app.acme.com/', paired: true, recording: false, sites: [], appUrl: 'https://cloud.get-brief.app', now: NOW, ...o });

test('a browser paired before this version starts its week on the first page load', async () => {
  delete store.nudge;
  assert.equal(await claim({}), false);
  assert.equal(store.nudge.usedAt, NOW);
  assert.equal(await claim({ now: NOW + 6 * DAY }), false);
  assert.equal(await claim({ now: NOW + 7 * DAY }), true);
});

test('an unpaired browser keeps no clock', async () => {
  delete store.nudge;
  assert.equal(await claim({ paired: false }), false);
  assert.equal(store.nudge, undefined);
});

test('shown once, then not again for a week, even on another tab at the same moment', async () => {
  store.nudge = { usedAt: NOW - 8 * DAY };
  const [a, b] = await Promise.all([claim({}), claim({})]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(store.nudge.shownAt, NOW);
  assert.equal(await claim({ now: NOW + 6 * DAY }), false);
  assert.equal(await claim({ now: NOW + 7 * DAY }), true);
});

test('not on the wrong page, and a page that does not get it does not use up the week', async () => {
  store.nudge = { usedAt: NOW - 8 * DAY };
  assert.equal(await claim({ url: 'https://cloud.get-brief.app/tickets' }), false);
  assert.equal(await claim({ url: 'https://other.com/', sites: ['app.acme.com'] }), false);
  assert.equal(await claim({ recording: true }), false);
  assert.equal(store.nudge.shownAt, undefined);
  assert.equal(await claim({ sites: ['app.acme.com'] }), true);
});

test('a brief made here starts the week over; closing the card restarts the wait', async () => {
  store.nudge = { usedAt: NOW - 8 * DAY };
  await markUsed(NOW);
  assert.equal(await claim({ now: NOW + 6 * DAY }), false);
  assert.equal(await claim({ now: NOW + 7 * DAY }), true);
  await markClosed(NOW + 9 * DAY);
  assert.equal(await claim({ now: NOW + 15 * DAY }), false);
  assert.equal(await claim({ now: NOW + 16 * DAY }), true);
});
