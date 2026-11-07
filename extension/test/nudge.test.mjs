// node --test extension/test/nudge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a chrome.storage.local in memory, for claimNudge / missedNudge
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => { Object.assign(store, structuredClone(o)); },
    },
  },
};
const { nudgePageOk, claimNudge, missedNudge, cardEvent, syncNudge, syncNudgeIfStale, TRIES_PER_DAY } = await import('../nudge.js');

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 7, 12);
const claim = (o) => claimNudge({ url: 'https://app.acme.com/', paired: true, recording: false, appUrl: 'https://cloud.get-brief.app', now: NOW, ...o });
const push = { id: 'p1', at: '' };

test('the page: any web page, or the sites given', () => {
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


test('nothing opens on its own: no push, no reminder, however long the user has been quiet', async () => {
  store.nudge = { usedAt: NOW - 60 * DAY, shownAt: NOW - 30 * DAY };
  assert.equal(await claim({}), false);
  assert.equal(await claim({ push: null }), false);
  delete store.nudge;
  assert.equal(await claim({}), false);
  assert.equal(store.nudge, undefined);
});

test("the owner's push opens once, even on another tab at the same moment", async () => {
  delete store.nudge;
  const [a, b] = await Promise.all([claim({ push }), claim({ push })]);
  assert.deepEqual([a, b].sort(), [false, true]);
  assert.equal(store.nudge.pushSeen, 'p1');
  assert.equal(await claim({ push, now: NOW + DAY }), false);
  assert.equal(await claim({ push: { id: 'p2', at: '' }, now: NOW + DAY }), true);
});

test('a push opens on any web page, never on Brief, unpaired or while recording, and waits for a page that can carry it', async () => {
  delete store.nudge;
  assert.equal(await claim({ push, url: 'https://cloud.get-brief.app/tickets' }), false);
  assert.equal(await claim({ push, url: 'https://get-brief.app/' }), false);
  assert.equal(await claim({ push, url: 'chrome://extensions' }), false);
  assert.equal(await claim({ push, paired: false }), false);
  assert.equal(await claim({ push, recording: true }), false);
  assert.equal(store.nudge?.pushSeen, undefined);
  assert.equal(await claim({ push, url: 'https://news.example/' }), true);
});

test('Chrome refused to open it: tried again on a later page load, a few times a day', async () => {
  store.nudge = { pushSeen: 'p0' };
  for (let i = 0; i < TRIES_PER_DAY; i++) {
    assert.equal(await claim({ push, now: NOW + i }), true, `try ${i + 1}`);
    await missedNudge(NOW + i);
    assert.equal(store.nudge.pushSeen, 'p0');
  }
  assert.equal(await claim({ push, now: NOW + 10 }), false, 'out of tries today');
  assert.equal(await claim({ push, now: NOW + DAY }), true, 'tomorrow it tries again');
});

test('refused the very first time: nothing to put back, still pending', async () => {
  delete store.nudge;
  assert.equal(await claim({ push }), true);
  await missedNudge(NOW);
  assert.equal(store.nudge.pushSeen, undefined);
  assert.equal(await claim({ push, now: NOW + 1 }), true);
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

