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
const { nudgeDue, nudgePageOk, claimNudge, missedNudge, markUsed, cardEvent, syncNudge, syncNudgeIfStale, QUIET_MS, EVERY_MS } = await import('../nudge.js');

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

// 'weekly' reads as true here; a push answers 'push'
const claim = async (o) => { const r = await claimNudge({ url: 'https://app.acme.com/', paired: true, recording: false, sites: [], appUrl: 'https://cloud.get-brief.app', now: NOW, ...o }); return r === 'weekly' ? true : r; };

test('a browser paired before this version: the server says when they last made a brief, no week to wait', async () => {
  delete store.nudge;
  assert.equal(await claim({ lastBriefAt: NOW - 30 * DAY }), true);
  assert.deepEqual(store.nudge, { usedAt: NOW - 30 * DAY, shownAt: NOW });
});

test('…and one that made a brief 2 days ago waits the rest of its week', async () => {
  delete store.nudge;
  assert.equal(await claim({ lastBriefAt: NOW - 2 * DAY }), false);
  assert.equal(store.nudge.usedAt, NOW - 2 * DAY);
  assert.equal(await claim({ now: NOW + 4 * DAY }), false);
  assert.equal(await claim({ now: NOW + 5 * DAY }), true);
});

test('a brief made in another browser moves the week forward; an older one does not move it back', async () => {
  store.nudge = { usedAt: NOW - 20 * DAY };
  assert.equal(await claim({ lastBriefAt: NOW - DAY }), false);
  assert.equal(store.nudge.usedAt, NOW - DAY);
  store.nudge = { usedAt: NOW - DAY };
  assert.equal(await claim({ lastBriefAt: NOW - 20 * DAY }), false);
  assert.equal(store.nudge.usedAt, NOW - DAY);
});

test('with nothing to count from yet (the server has not answered), no card and nothing stored', async () => {
  delete store.nudge;
  assert.equal(await claim({}), false);
  assert.equal(store.nudge, undefined);
});

test('an unpaired browser keeps no clock', async () => {
  delete store.nudge;
  assert.equal(await claim({ paired: false, lastBriefAt: NOW - 30 * DAY }), false);
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

test('a brief made here starts the week over', async () => {
  store.nudge = { usedAt: NOW - 8 * DAY };
  await markUsed(NOW);
  assert.equal(await claim({ now: NOW + 6 * DAY }), false);
  assert.equal(await claim({ now: NOW + 7 * DAY }), true);
});

test('Chrome refused to open it: not shown, the last showing comes back, a few tries a day', async () => {
  store.nudge = { usedAt: NOW - 30 * DAY, shownAt: NOW - 10 * DAY };
  assert.equal(await claim({}), true);
  await missedNudge(NOW);
  assert.equal(store.nudge.shownAt, NOW - 10 * DAY, 'the week was not used up');
  assert.deepEqual(store.nudge.tries, { day: Math.floor(NOW / DAY), n: 1 });
  assert.equal(await claim({ now: NOW + 60_000 }), true);
  await missedNudge(NOW + 60_000);
  assert.equal(await claim({ now: NOW + 120_000 }), true);
  await missedNudge(NOW + 120_000);
  assert.equal(await claim({ now: NOW + 180_000 }), false, 'three refusals: done for today');
  assert.equal(await claim({ now: NOW + DAY }), true, 'tomorrow it tries again');
  assert.equal(store.nudge.shownAt, NOW + DAY);
  assert.equal(store.nudge.prevShownAt, NOW - 10 * DAY);
});

test('refused the very first time: no showing to put back', async () => {
  store.nudge = { usedAt: NOW - 30 * DAY };
  assert.equal(await claim({}), true);
  await missedNudge(NOW);
  assert.equal('shownAt' in store.nudge, false);
  assert.equal(await claim({ now: NOW + 1000 }), true);
});

test('the reminder logs only its three events, with nothing about the page', async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return { ok: true }; };
  store.briefCloudToken = 'bxt_test';
  await cardEvent('nudge.shown', { replay: true, url: 'https://bank.example/', title: 'Inbox' });
  await cardEvent('nudge.shown', {});
  await cardEvent('nudge.brief_it', { url: 'https://bank.example/' });
  await cardEvent('nudge.closed');
  await cardEvent('nudge.closed', { push: 'p-9', url: 'https://bank.example/' });
  await cardEvent('brief.created');
  await cardEvent('page.view', { path: '/x' });
  assert.deepEqual(sent.map((s) => s.body), [
    { name: 'nudge.shown', props: { replay: true } },
    { name: 'nudge.shown', props: { replay: false } },
    { name: 'nudge.brief_it', props: {} },
    { name: 'nudge.closed', props: {} },
    { name: 'nudge.closed', props: { push: 'p-9' } },
  ]);
  assert.ok(sent.every((s) => s.url === 'https://cloud.get-brief.app/api/extension-events' && s.auth === 'Bearer bxt_test'));
  delete store.briefCloudToken;
  await cardEvent('nudge.closed');
  assert.equal(sent.length, 5, 'nothing is sent unpaired');
  globalThis.fetch = async () => { throw new Error('offline'); };
  store.briefCloudToken = 'bxt_test';
  await cardEvent('nudge.closed'); // never throws
});

test("the owner's push shows once, whatever the week says", async () => {
  store.nudge = { usedAt: NOW - DAY, shownAt: NOW - DAY };
  const push = { id: 'p1', at: new Date(NOW).toISOString() };
  assert.equal(await claim({ push }), 'push');
  assert.equal(store.nudge.pushSeen, 'p1');
  assert.equal(store.nudge.shownAt, NOW);
  assert.equal(await claim({ push, now: NOW + 60_000 }), false);
  // a new push shows again
  assert.equal(await claim({ push: { id: 'p2', at: '' }, now: NOW + 120_000 }), 'push');
});

test("a push also reaches a browser with no clock yet (the server hasn't answered)", async () => {
  delete store.nudge;
  assert.equal(await claim({ push: { id: 'p1', at: '' } }), 'push');
  assert.equal(store.nudge.pushSeen, 'p1');
  assert.equal(store.nudge.usedAt, undefined);
});

test('Chrome refused a push: it is tried again on a later page load', async () => {
  store.nudge = { usedAt: NOW - DAY, pushSeen: 'p0' };
  const push = { id: 'p1', at: '' };
  assert.equal(await claim({ push }), 'push');
  await missedNudge(NOW);
  assert.equal(store.nudge.pushSeen, 'p0');
  assert.equal(await claim({ push, now: NOW + 60_000 }), 'push');
  assert.equal(store.nudge.pushSeen, 'p1');
  // a refused weekly one leaves the push it already showed alone
  store.nudge = { usedAt: NOW - 8 * DAY, pushSeen: 'p1' };
  assert.equal(await claim({ push }), true);
  await missedNudge(NOW);
  assert.equal(store.nudge.pushSeen, 'p1');
});

test("a push still never shows on Brief, unpaired, or while recording, and waits for a page that can carry it", async () => {
  store.nudge = { usedAt: NOW - DAY };
  const push = { id: 'p1', at: '' };
  assert.equal(await claim({ push, url: 'https://cloud.get-brief.app/tickets' }), false);
  assert.equal(await claim({ push, recording: true }), false);
  assert.equal(await claim({ push, paired: false }), false);
  assert.equal(store.nudge.pushSeen, undefined);
  assert.equal(await claim({ push }), 'push');
});

test('syncNudge: pulls the text and the push with the pairing token, keeps the last answer offline', async () => {
  store.briefCloudToken = 'tok';
  let asked = null;
  globalThis.fetch = async (url, init) => {
    asked = { url, auth: init.headers.Authorization };
    return { ok: true, status: 200, json: async () => ({ message: ' Found a glitch? ', button: 'Report', push: { id: 'p9', at: '2026-11-07T10:00:00Z' }, extra: 1 }) };
  };
  const cfg = await syncNudge();
  assert.match(asked.url, /\/api\/nudge$/);
  assert.equal(asked.auth, 'Bearer tok');
  assert.deepEqual(cfg, { message: 'Found a glitch?', button: 'Report', push: { id: 'p9', at: '2026-11-07T10:00:00Z' } });
  // fresh: no second request
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  assert.deepEqual(await syncNudgeIfStale(60_000), cfg);
  // offline: the last answer stays
  assert.deepEqual(await syncNudge(), cfg);
  // a dead pairing: nothing
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  assert.equal(await syncNudge(), null);
  // unpaired: no request at all
  delete store.briefCloudToken;
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  assert.equal(await syncNudge(), null);
});
