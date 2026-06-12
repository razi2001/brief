// Shared brief-bundle helpers: the README, the bundled skill files, and the
// zip assembly for a recorded brief. Used by bar.js (local export when not
// connected to Brief Cloud) and offscreen.js (zip fallback when a background
// cloud upload fails) so the bundle format stays identical in both paths.

import { makeZip } from './lib/zip.js';

// The canonical skill files ship inside the extension; we fetch them and add
// them to each brief zip so the brief is self-contained and install-free.
const SKILL_FILES = [
  'skill/SKILL.md',
  'skill/playbooks/ticket.md',
  'skill/playbooks/inbox.md',
];

export async function loadSkillEntries() {
  const entries = [];
  for (const rel of SKILL_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(rel));
      const text = await res.text();
      entries.push({ name: rel, data: new TextEncoder().encode(text) });
    } catch (err) {
      console.warn('[brief/bundle] could not bundle skill file', rel, err);
    }
  }
  return entries;
}

// Dropped into each brief folder so any agent (Claude Code, Cursor, etc.) that
// opens it knows what this is and how to act on it.
export const BRIEF_README = `# Brief

This folder is a voice+screen "brief" recorded with the Brief browser extension.
It contains everything needed to file a tracker ticket from it.

## What's here
- \`brief.json\` - transcript, screen keyframes (with timestamps), page URL/title,
  the click/scroll/keypress event log, and recording metadata.
- \`recording.webm\` - the raw screen recording with mic audio.
- \`keyframes/\` - PNG snapshots referenced by brief.json.
- \`skill/\` - the playbook for turning this brief into a high-quality ticket.

## How to act on it (for the AI agent reading this)
Read \`skill/SKILL.md\` and follow it. In short: read brief.json, scan the
keyframes (binary-search the timestamps around the moment described in the
transcript), then file ONE ticket in the user's connected tracker (Linear /
Jira / GitHub / Notion) with the screenshots embedded inline. Don't ask
clarifying questions about team/project - infer from the workspace.

When multiple briefs are processed together, see \`skill/playbooks/inbox.md\`.
`;

export function dataUrlToBytes(dataUrl) {
  const b64 = (dataUrl || '').split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Assemble the full brief zip. `keyframeEntries` are {name, data} (already
 * named keyframes/keyframe-NNN.png); `recordingBytes` may be empty;
 * `screenshotDataUrl` is the optional annotated screenshot.
 */
export async function buildBriefZipBytes({ briefJson, recordingBytes, keyframeEntries, screenshotDataUrl }) {
  const entries = [
    { name: 'README.md', data: new TextEncoder().encode(BRIEF_README) },
    { name: 'brief.json', data: new TextEncoder().encode(JSON.stringify(briefJson, null, 2)) },
  ];
  if (recordingBytes && recordingBytes.length) {
    entries.push({ name: 'recording.webm', data: recordingBytes });
  }
  entries.push(...(keyframeEntries || []));
  entries.push(...(await loadSkillEntries()));
  if (screenshotDataUrl) {
    try {
      entries.push({ name: 'screenshot.png', data: dataUrlToBytes(screenshotDataUrl) });
    } catch {}
  }
  return makeZip(entries);
}
