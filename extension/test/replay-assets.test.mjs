// node --test extension/test/replay-assets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrls } from '../replay-assets.js';

test('a picture fetches what it draws: images, posters, stylesheets, svg images, css urls', () => {
  const html = [
    '<img src="/logo.png">',
    '<video poster="poster.jpg"></video>',
    '<link rel="stylesheet" href="/app.css">',
    '<svg><image xlink:href="icon.svg"></image><use href="#sprite"></use></svg>',
    '<div style="background:url(\'bg.png\')"></div>',
  ].join('');
  assert.deepEqual([...assetUrls(html)].sort(), ['#sprite', '/app.css', '/logo.png', 'bg.png', 'icon.svg', 'poster.jpg'].sort());
});

test("a link's target, a favicon or a frame is never fetched", () => {
  const html = [
    '<a href="https://chromewebstore.google.com/detail/brief/abc">Install</a>',
    '<link rel="icon" href="/favicon.ico">',
    '<link rel="preload" href="/big.js">',
    '<iframe src="https://ads.example/frame"></iframe>',
    '<area href="/map">',
  ].join('');
  assert.deepEqual([...assetUrls(html)], []);
});
