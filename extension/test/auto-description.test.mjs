// node --test extension/test/auto-description.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDraft, landRecording, applyAutoDescription, clearAutoDescription } from '../draft.js';

test('a fresh draft has no AI description', () => {
  assert.equal(emptyDraft().descriptionAuto, false);
});

test('the AI fills an empty description', () => {
  const d = emptyDraft();
  assert.equal(applyAutoDescription(d, 'Pay spins forever.'), true);
  assert.equal(d.description, 'Pay spins forever.');
  assert.equal(d.descriptionAuto, true);
});

test('the AI replaces its own untouched text', () => {
  const d = { ...emptyDraft(), description: 'Old take.', descriptionAuto: true };
  assert.equal(applyAutoDescription(d, 'New take.'), true);
  assert.equal(d.description, 'New take.');
});

test('the AI never replaces what the reporter wrote', () => {
  const d = { ...emptyDraft(), description: 'my words', descriptionAuto: false };
  assert.equal(applyAutoDescription(d, 'AI words.'), false);
  assert.equal(d.description, 'my words');
  assert.equal(d.descriptionAuto, false);
});

test('whitespace-only reporter text still counts as empty', () => {
  const d = { ...emptyDraft(), description: '  \n' };
  assert.equal(applyAutoDescription(d, 'AI words.'), true);
});

test('an empty or missing summary changes nothing', () => {
  const d = emptyDraft();
  assert.equal(applyAutoDescription(d, '   '), false);
  assert.equal(applyAutoDescription(d, undefined), false);
  assert.equal(d.description, '');
  assert.equal(d.descriptionAuto, false);
});

test('clearing removes only AI text', () => {
  const auto = { ...emptyDraft(), description: 'AI words.', descriptionAuto: true };
  clearAutoDescription(auto);
  assert.equal(auto.description, '');
  assert.equal(auto.descriptionAuto, false);
  const mine = { ...emptyDraft(), description: 'my words' };
  clearAutoDescription(mine);
  assert.equal(mine.description, 'my words');
});

test('a new recording clears the AI description of the old one', () => {
  const d = { ...emptyDraft(), description: 'About the old video.', descriptionAuto: true };
  landRecording(d, { uploading: true });
  assert.equal(d.description, '');
  const mine = { ...emptyDraft(), description: 'my words' };
  landRecording(mine, { uploading: true });
  assert.equal(mine.description, 'my words');
});
