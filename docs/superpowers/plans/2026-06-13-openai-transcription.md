# OpenAI Server-Side Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flaky in-browser Web Speech live transcription with a server-side OpenAI transcription pass on a dedicated audio-only track, cap recordings at 2 minutes, and remove the EN/FR language pills.

**Architecture:** The extension records a small `audio/webm;codecs=opus` track alongside the existing video and uploads it as `audio.webm`. The server (`run-processing.ts`) downloads that audio, transcribes it with `gpt-4o-mini-transcribe`, and fills `json.transcript` so the existing agent context path picks it up unchanged. Transcription is fail-soft — a brief never fails because transcription did. A 2-minute cap in the recording bar bounds audio size, video size, latency, and cost.

**Tech Stack:** Chrome MV3 extension (plain ES modules, no test runner), Next.js 16 + TypeScript backend, OpenAI Node SDK v6 (already installed), Vitest for backend tests.

**Spec:** [docs/superpowers/specs/2026-06-13-openai-transcription-design.md](../specs/2026-06-13-openai-transcription-design.md)

---

## File Structure

**Server (web/):**
- Create: `web/lib/agent/transcribe.ts` — pure-ish helper: takes audio bytes, returns transcript string or null. Injectable OpenAI call for testing. Single responsibility: "audio → text, never throws."
- Create: `web/lib/agent/transcribe.test.ts` — unit tests for the helper.
- Modify: `web/lib/agent/run-processing.ts` — download `audio.webm`, call the helper, set `json.transcript`, add the file to cleanup.
- Modify: `web/lib/agent/context-block.ts` — soften the transcript label now that it's a clean transcript.
- Modify: `web/lib/agent/context-block.test.ts` — add a test for the new transcript label/surfacing.

**Extension:**
- Modify: `extension/offscreen.js` — add a second (audio-only) MediaRecorder, push `audio.webm` into the upload, drop dead transcript/SR state, set `transcript: null` in brief.json.
- Modify: `extension/bar.js` — remove all Web Speech machinery + language-pill wiring + transcript rendering; factor stop into `stopAndSave()`; add the 2-minute cap.
- Modify: `extension/bar.html` — remove the `.lang-pills` group and the `#transcriptPanel` markup.
- Modify: `extension/bar.css` — remove now-dead lang-pill / transcript-panel / bars-anim rules.

No changes needed to `extension/cloud.js`, `web/app/api/briefs/route.ts`, or the files/process routes: the upload path creates a signed URL for whatever filenames are passed, so `audio.webm` rides along automatically and lands at `${prefix}/audio.webm`.

---

## Task 1: Transcribe helper (`web/lib/agent/transcribe.ts`)

**Files:**
- Create: `web/lib/agent/transcribe.ts`
- Test: `web/lib/agent/transcribe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/lib/agent/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { transcribeAudio } from "./transcribe";

const audio = () => ({ bytes: Buffer.from("fake-opus-bytes"), filename: "audio.webm", contentType: "audio/webm" });

describe("transcribeAudio", () => {
  it("returns null when there is no audio", async () => {
    expect(await transcribeAudio(null)).toBe(null);
  });

  it("returns null for empty bytes", async () => {
    expect(await transcribeAudio({ bytes: Buffer.alloc(0), filename: "audio.webm", contentType: "audio/webm" })).toBe(null);
  });

  it("returns trimmed text when the API returns a string", async () => {
    const create = vi.fn().mockResolvedValue("  hello world  ");
    expect(await transcribeAudio(audio(), { create })).toBe("hello world");
    expect(create).toHaveBeenCalledOnce();
  });

  it("returns text when the API returns an object with .text", async () => {
    const create = vi.fn().mockResolvedValue({ text: "from object" });
    expect(await transcribeAudio(audio(), { create })).toBe("from object");
  });

  it("returns null (never throws) when the API errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await transcribeAudio(audio(), { create })).toBe(null);
  });

  it("returns null when the API returns only whitespace", async () => {
    const create = vi.fn().mockResolvedValue("   ");
    expect(await transcribeAudio(audio(), { create })).toBe(null);
  });

  it("passes the configured model through to the API", async () => {
    const create = vi.fn().mockResolvedValue("ok");
    await transcribeAudio(audio(), { create, model: "gpt-4o-transcribe" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-4o-transcribe" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run lib/agent/transcribe.test.ts`
Expected: FAIL — `Cannot find module './transcribe'` (helper not created yet).

- [ ] **Step 3: Write the helper**

Create `web/lib/agent/transcribe.ts`:

```ts
import OpenAI, { toFile } from "openai";

export interface TranscribeInput {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

export interface TranscribeDeps {
  /** Injectable for tests; defaults to a real OpenAI transcription call. */
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  /** Override the model; defaults to TRANSCRIBE_MODEL env or gpt-4o-mini-transcribe. */
  model?: string;
}

/**
 * Transcribe an audio clip with OpenAI. Fail-soft by contract: returns the
 * trimmed transcript, or null for missing/empty audio, empty results, or ANY
 * error. Callers must never let a transcription failure fail the brief.
 */
export async function transcribeAudio(
  input: TranscribeInput | null,
  deps: TranscribeDeps = {},
): Promise<string | null> {
  if (!input || !input.bytes || input.bytes.length === 0) return null;
  const model = deps.model || process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  try {
    const create =
      deps.create ||
      (async (args: Record<string, unknown>) => {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return client.audio.transcriptions.create(args as never);
      });
    const file = await toFile(input.bytes, input.filename, { type: input.contentType });
    const res = await create({ file, model, response_format: "text" });
    const text = typeof res === "string" ? res : ((res as { text?: string })?.text ?? "");
    const trimmed = String(text).trim();
    return trimmed || null;
  } catch (err) {
    console.warn("[transcribe] failed:", (err as { message?: string })?.message ?? err);
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npx vitest run lib/agent/transcribe.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/transcribe.ts web/lib/agent/transcribe.test.ts
git commit -m "feat(web): add fail-soft OpenAI transcription helper"
```

---

## Task 2: Wire transcription into `run-processing.ts`

**Files:**
- Modify: `web/lib/agent/run-processing.ts` (import near top; insert after brief.json parse at line 84; add to cleanup list at line ~203)

- [ ] **Step 1: Add the import**

At the top of `web/lib/agent/run-processing.ts`, alongside the other `@/lib/agent` imports (after the `process-brief` import on line 6), add:

```ts
import { transcribeAudio } from "@/lib/agent/transcribe";
```

- [ ] **Step 2: Insert the transcription step**

In `web/lib/agent/run-processing.ts`, immediately AFTER this existing block (currently lines 83-84):

```ts
    const briefJsonBuf = await dl(`${prefix}/brief.json`);
    const json = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};
```

insert:

```ts
    // Transcribe the audio-only track (uploaded alongside the video) with
    // OpenAI and surface it as json.transcript so buildContextBlock picks it up
    // unchanged. Fail-soft: missing audio or any API error leaves transcript
    // null and the brief still files on visual + console/network evidence.
    let audioInput: { bytes: Buffer; filename: string; contentType: string } | null = null;
    const audioBuf = await dl(`${prefix}/audio.webm`);
    if (audioBuf) {
      audioInput = { bytes: audioBuf, filename: "audio.webm", contentType: "audio/webm" };
    } else {
      // Older drafts (created before the audio track existed) only have the
      // video. Transcribe it directly when it's under OpenAI's 25 MB cap.
      const recBuf = await dl(`${prefix}/recording.webm`);
      if (recBuf && recBuf.length <= 25 * 1024 * 1024) {
        audioInput = { bytes: recBuf, filename: "recording.webm", contentType: "video/webm" };
      }
    }
    const transcript = await transcribeAudio(audioInput);
    if (transcript) json.transcript = transcript;
```

- [ ] **Step 3: Add audio.webm to the storage cleanup list**

In `web/lib/agent/run-processing.ts`, find the cleanup line (currently line 203):

```ts
    const toDelete: string[] = [`${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/screenshot.png`, ...names.map((n) => `${prefix}/keyframes/${n}`)];
```

Replace it with (adds `audio.webm`):

```ts
    const toDelete: string[] = [`${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/audio.webm`, `${prefix}/screenshot.png`, ...names.map((n) => `${prefix}/keyframes/${n}`)];
```

- [ ] **Step 4: Typecheck and run the full backend test suite**

Run: `cd web; npx tsc --noEmit; npm test`
Expected: tsc reports no errors; all Vitest tests pass (including the new `transcribe.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/run-processing.ts
git commit -m "feat(web): transcribe uploaded audio before filing the brief"
```

---

## Task 3: Soften the transcript label in the agent context

**Files:**
- Modify: `web/lib/agent/context-block.ts:56-61`
- Test: `web/lib/agent/context-block.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/lib/agent/context-block.test.ts`, add a new `describe` block at the end of the file (after the closing `});` of the network-errors describe on line 43):

```ts
describe("buildContextBlock - narration", () => {
  it("surfaces the transcript under a 'transcribed audio' label and includes the text", () => {
    const block = buildContextBlock({ transcript: "the save button does nothing" });
    expect(block).toContain("transcribed audio");
    expect(block).toContain("the save button does nothing");
    expect(block).not.toContain("rough draft");
  });

  it("omits the narration block when there is no transcript", () => {
    const block = buildContextBlock({ pageUrl: "https://example.com" });
    expect(block).not.toContain("SPOKEN NARRATION");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web; npx vitest run lib/agent/context-block.test.ts`
Expected: FAIL — the new "transcribed audio" assertion fails (current label says "rough draft - speech-to-text").

- [ ] **Step 3: Update the label**

In `web/lib/agent/context-block.ts`, replace this block (currently lines 56-61):

```ts
  if (typeof j.transcript === "string" && j.transcript.trim()) {
    block +=
      (block ? "\n\n" : "") +
      "SPOKEN NARRATION (rough draft - speech-to-text; trust the screenshots/console/events over it, never quote it):\n" +
      j.transcript.trim().slice(0, 4000);
  }
```

with:

```ts
  if (typeof j.transcript === "string" && j.transcript.trim()) {
    block +=
      (block ? "\n\n" : "") +
      "SPOKEN NARRATION (transcribed audio - the reporter's intent; corroborate against the screenshots/console/events, and quote it when it's relevant):\n" +
      j.transcript.trim().slice(0, 4000);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web; npx vitest run lib/agent/context-block.test.ts`
Expected: PASS — all assertions (including the existing network-error tests) pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/context-block.ts web/lib/agent/context-block.test.ts
git commit -m "feat(web): trust the transcribed audio in the agent context"
```

---

## Task 4: Extension offscreen — audio-only track + clean brief.json

**Files:**
- Modify: `extension/offscreen.js`

The extension has no test runner; verify each step with `node --check` (syntax) and the manual Chrome run in Task 7.

- [ ] **Step 1: Remove dead transcript/SR module state**

In `extension/offscreen.js`, delete these now-unused module variables (currently lines 21-25):

```js
let recognizer = null;
let transcriptFinal = '';
let transcriptInterim = '';
let transcriptChunks = [];
let recognitionShouldRun = false;
```

Add a new variable for the audio recorder next to `let mediaRecorder = null;` (line 19):

```js
let audioRecorder = null;
let audioChunks = [];
```

- [ ] **Step 2: Stop snapshotting transcript state on START**

In `startRecording` (currently lines 104-107), delete the three transcript resets and the lang line, leaving the rest:

```js
  transcriptFinal = '';
  transcriptInterim = '';
  transcriptChunks = [];
  recordingLang = lang || 'en-US';
```

Replace those four lines with just:

```js
  audioChunks = [];
```

Also delete the now-unused `let recordingLang = 'en-US';` declaration (line 27).

- [ ] **Step 3: Start the audio-only recorder alongside the video recorder**

In `startRecording`, immediately AFTER `mediaRecorder.start(1000);` (currently line 163), insert:

```js
  // Audio-only recorder for server-side transcription. Records JUST the mixed
  // tab+mic audio (dest.stream) as a small opus webm (~1-2 MB for 2 min), so it
  // always fits under OpenAI's 25 MB transcription cap - no video bloat.
  const audioMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  try {
    audioRecorder = new MediaRecorder(new MediaStream(dest.stream.getAudioTracks()), { mimeType: audioMime });
    audioRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    audioRecorder.start(1000);
  } catch (err) {
    // Non-fatal: if the audio recorder can't start we just upload without a
    // transcribable track; the brief still files on visual evidence.
    log('audio recorder failed to start:', err);
    audioRecorder = null;
  }
```

Note: `dest` is the mixed-audio `MediaStreamDestination` created earlier in `startRecording` (the variable named `dest` around line 135). Confirm it is in scope at this insertion point (it is — same function).

- [ ] **Step 4: Replace the no-op SR functions with audio-recorder stop**

In `extension/offscreen.js`, replace the two no-op functions (currently lines 215-222):

```js
function startSpeechRecognition(lang) {
  // Intentionally unused - SR runs in the bar iframe instead.
  // Kept as a no-op so the rest of the message handling doesn't break.
}

function stopSpeechRecognition() {
  // No-op - see startSpeechRecognition.
}
```

with a single audio-flush helper:

```js
// Stop the audio-only recorder and wait for its final chunk to flush.
function stopAudioRecorder() {
  return new Promise((resolve) => {
    if (!audioRecorder || audioRecorder.state === 'inactive') return resolve();
    audioRecorder.onstop = () => resolve();
    try { audioRecorder.stop(); } catch { resolve(); }
  });
}
```

- [ ] **Step 5: Flush + package the audio in collectRecording**

In `collectRecording` (currently lines 226-254), replace the leading `stopSpeechRecognition();` call (line 228) with awaiting the audio recorder, and add the audio blob to the returned object.

Change the top of the function from:

```js
async function collectRecording() {
  log('collectRecording');
  stopSpeechRecognition();
  stopKeyframeCapture();
```

to:

```js
async function collectRecording() {
  log('collectRecording');
  await stopAudioRecorder();
  stopKeyframeCapture();
```

Then, in the `collected` object (currently lines 241-250), add an `audioBlob` field. Change:

```js
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const collected = {
    blob,
    mimeType: 'video/webm',
    keyframes: keyframes.slice(),
    durationMs: Date.now() - recordingStartMs,
    startedAtMs: recordingStartMs,
    // Snapshot the lang NOW - a new recording can reuse this document while
    // the upload is still running and would clobber the module-level value.
    lang: recordingLang,
  };
  recordedChunks = [];
  keyframes = [];
  return collected;
```

to:

```js
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const audioBlob = audioChunks.length ? new Blob(audioChunks, { type: 'audio/webm' }) : null;
  const collected = {
    blob,
    audioBlob,
    mimeType: 'video/webm',
    keyframes: keyframes.slice(),
    durationMs: Date.now() - recordingStartMs,
    startedAtMs: recordingStartMs,
  };
  recordedChunks = [];
  audioChunks = [];
  audioRecorder = null;
  keyframes = [];
  return collected;
```

- [ ] **Step 6: Stop reading transcript fields from the STOP message**

In the message router's `STOP` case (currently lines 56-71), the handler forwards `transcriptFinal`/`transcriptChunks` from the bar. The bar no longer sends them. Change the `uploadAndFinish({...})` call (currently lines 63-69) from:

```js
          uploadAndFinish({
            briefId: message.briefId,
            intent: message.intent || 'brief',
            transcriptFinal: (message.transcriptFinal || '').trim(),
            transcriptChunks: message.transcriptChunks || [],
            ...data,
          });
```

to:

```js
          uploadAndFinish({
            briefId: message.briefId,
            intent: message.intent || 'brief',
            ...data,
          });
```

- [ ] **Step 7: Update uploadAndFinish — drop transcript params, add audio.webm, null out transcript**

In `extension/offscreen.js`, update the `uploadAndFinish` signature (currently line 261) from:

```js
async function uploadAndFinish({ briefId, intent, transcriptFinal, transcriptChunks, blob, mimeType, keyframes: frames, durationMs, startedAtMs, lang }) {
```

to:

```js
async function uploadAndFinish({ briefId, intent, blob, audioBlob, mimeType, keyframes: frames, durationMs, startedAtMs }) {
```

In the `briefJson` object (currently lines 288-313), change the transcript fields. Replace:

```js
    transcriptLang: lang || recordingLang,
    transcript: transcriptFinal || null,
    transcriptChunks: transcriptChunks || [],
```

with:

```js
    transcript: null,        // filled server-side by OpenAI transcription
    transcriptChunks: [],
```

In the `files` array assembly (currently lines 316-326), add the audio file right after the recording is pushed. Change:

```js
    if (blob && blob.size) {
      files.push({ name: 'recording.webm', blob, contentType: mimeType });
    }
```

to:

```js
    if (blob && blob.size) {
      files.push({ name: 'recording.webm', blob, contentType: mimeType });
    }
    if (audioBlob && audioBlob.size) {
      files.push({ name: 'audio.webm', blob: audioBlob, contentType: 'audio/webm' });
    }
```

In the `cloudMeta` object (currently lines 337-345), the `transcript: transcriptFinal || ''` field is now stale. Change it to:

```js
      transcript: '',
```

- [ ] **Step 8: Syntax-check the file**

Run: `node --check extension/offscreen.js`
Expected: no output (exit 0) — file parses.

- [ ] **Step 9: Commit**

```bash
git add extension/offscreen.js
git commit -m "feat(extension): record + upload an audio-only track for transcription"
```

---

## Task 5: Extension bar — remove Web Speech, add 2-minute cap

**Files:**
- Modify: `extension/bar.js`

- [ ] **Step 1: Remove transcript/SR/lang module state and DOM refs**

In `extension/bar.js`, delete the language + transcript DOM refs (currently lines 26-28):

```js
const langPills = Array.from(document.querySelectorAll('.lang-pill'));
const transcriptText = document.getElementById('transcriptText');
const transcriptPanel = document.getElementById('transcriptPanel');
```

Delete the `currentLang` param (line 13):

```js
let currentLang = params.get('lang') || 'en-US';
```

Delete the transcript/SR state variables (currently lines 37-41):

```js
let transcriptFinalCache = '';
let transcriptInterimCache = '';
let transcriptChunksCache = [];
let recognizer = null;
let recognitionShouldRun = false;
```

Add a cap/stop guard variable next to the other state (near line 36):

```js
let stopping = false;       // guards stopAndSave against double-invocation
let capTimer = null;        // 2-minute hard-cap timer
```

- [ ] **Step 2: Remove the language-pill block**

Delete the entire "Language pills" block (currently lines 43-60):

```js
// ---------- Language pills (choose EN/FR for speech recognition) ----------
function paintLangPills() {
  langPills.forEach((p) => p.classList.toggle('active', p.dataset.lang === currentLang));
}
paintLangPills();
langPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const next = pill.dataset.lang;
    if (next === currentLang) return;
    currentLang = next;
    paintLangPills();
    chrome.storage.local.set({ lang: currentLang });
    // Restart recognition in the new language if we're mid-recording.
    if (recognitionShouldRun) {
      startSpeechRecognition();
    }
  });
});
```

- [ ] **Step 3: Drop the transcript-panel toggle in setView**

In `setView` (currently lines 75-83), delete this line (line 77):

```js
  if (transcriptPanel) transcriptPanel.hidden = name !== 'recording';
```

- [ ] **Step 4: Remove SR warm-up from init and stop passing lang to START**

In `init` (currently lines 125-156), delete the warm-up call and its comment (currently lines 128-131):

```js
  // Warm up speech recognition NOW, in parallel with stream acquisition in
  // the offscreen document. The SR engine takes ~1s to start accepting audio;
  // starting it only after RECORDING_STARTED used to eat the first words.
  startSpeechRecognition();
```

Change the START call (line 133) from:

```js
    const res = await sendToOffscreen('START', { streamId, lang: currentLang });
```

to:

```js
    const res = await sendToOffscreen('START', { streamId });
```

Delete the `stopSpeechRecognition();` call inside the `if (!res?.ok)` branch (currently line 135).

- [ ] **Step 5: Remove SR from the RECORDING_STARTED / TRANSCRIPT_UPDATE handlers**

In the offscreen message listener (currently lines 159-181), inside the `RECORDING_STARTED` branch, delete the SR comment + warm-up safety net (currently lines 167-172):

```js
    // Speech recognition runs here in the bar - it doesn't work in offscreen
    // documents (they're invisible and SR silently fails to produce results).
    // It was already warmed up during init (before the streams were acquired)
    // so the first words aren't lost; this is just a safety net in case that
    // start failed.
    if (!recognitionShouldRun) startSpeechRecognition();
```

Delete the entire `TRANSCRIPT_UPDATE` branch (currently lines 173-178):

```js
  } else if (message.type === 'TRANSCRIPT_UPDATE') {
    // Legacy path from offscreen, kept for safety
    transcriptFinalCache = message.final || '';
    transcriptInterimCache = message.interim || '';
    renderTranscript(transcriptFinalCache, transcriptInterimCache);
  }
```

So the `if/else if` collapses to just the `RECORDING_STARTED` `if` block. After editing, the listener body reads:

```js
  if (message.type === 'RECORDING_STARTED') {
    recordingStartMs = message.startedAt || Date.now();
    chrome.runtime.sendMessage({ type: 'BRIEF_START', briefId, startedAt: recordingStartMs }).catch(() => {});
    setView('recording');
    startTimer();
  }
  sendResponse({ ok: true });
  return false;
```

- [ ] **Step 6: Arm the 2-minute cap inside the timer**

In `startTimer` (currently lines 184-193), add the cap check inside `tick`. Replace:

```js
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const total = Math.max(0, Math.floor((Date.now() - recordingStartMs) / 1000));
    timerEl.textContent =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
```

with:

```js
const MAX_RECORDING_SECONDS = 120; // hard 2-minute cap

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const total = Math.max(0, Math.floor((Date.now() - recordingStartMs) / 1000));
    timerEl.textContent =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    if (total >= MAX_RECORDING_SECONDS) {
      stopAndSave('2 min limit reached — saving…');
    }
  };
  tick();
  timerInterval = setInterval(tick, 500);
}
```

- [ ] **Step 7: Delete the Web Speech functions and the transcript ticker**

In `extension/bar.js`, delete the entire block from `// ---------- Speech recognition (in the bar, NOT in offscreen) ----------` through the end of `escapeHtml` — i.e. the functions `startSpeechRecognition`, `stopSpeechRecognition`, `renderTranscript`, and `escapeHtml` (currently lines 196-328).

- [ ] **Step 8: Factor stop into `stopAndSave()` and call it from the button**

Replace the stop-button handler (currently lines 356-378):

```js
// ---------- Stop & save ----------
stopBtn?.addEventListener('click', async () => {
  stopBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  stopTimer();
  setView('saving'); // show feedback immediately while transcription flushes
  await stopSpeechRecognition(); // <- wait for buffered final chunks to land
  const res = await sendToOffscreen('STOP', {
    briefId,
    intent,
    transcriptFinal: transcriptFinalCache,
    transcriptChunks: transcriptChunksCache,
  });
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  if (res?.ok) {
    // Cloud-only: the offscreen document uploads the draft in the BACKGROUND
    // (it holds the blob and outlives this bar). Mark the inbox entry as
    // uploading and close immediately - no waiting, no local zip.
    await finishToInbox(briefId, intent, undefined, { uploading: true });
  } else {
    showError(res?.error || 'Could not save the recording.');
  }
});
```

with:

```js
// ---------- Stop & save ----------
// Single stop path, shared by the Stop button and the 2-minute cap. Guarded so
// the cap firing at the same instant as a manual click can't double-upload.
async function stopAndSave(savingMessage) {
  if (stopping) return;
  stopping = true;
  if (capTimer) { clearTimeout(capTimer); capTimer = null; }
  if (stopBtn) stopBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  stopTimer();
  setView('saving'); // show feedback immediately while the recorder flushes
  if (savingMessage) setSavingText(savingMessage);
  const res = await sendToOffscreen('STOP', { briefId, intent });
  chrome.runtime.sendMessage({ type: 'BRIEF_STOP' }).catch(() => {});
  if (res?.ok) {
    // Cloud-only: the offscreen document uploads the draft in the BACKGROUND
    // (it holds the blob and outlives this bar). Mark the inbox entry as
    // uploading and close immediately - no waiting, no local zip.
    await finishToInbox(briefId, intent, undefined, { uploading: true });
  } else {
    showError(res?.error || 'Could not save the recording.');
  }
}

stopBtn?.addEventListener('click', () => { stopAndSave(); });
```

- [ ] **Step 9: Remove SR from the cancel handler**

In the cancel handler (currently lines 380-389), delete the `stopSpeechRecognition();` call (line 385) and add `stopping = true;` + cap-timer clear at the top so a cap can't fire mid-cancel. Change:

```js
cancelBtn?.addEventListener('click', async () => {
  cancelBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  stopTimer();
  stopSpeechRecognition();
  await sendToOffscreen('CANCEL');
```

to:

```js
cancelBtn?.addEventListener('click', async () => {
  stopping = true;
  if (capTimer) { clearTimeout(capTimer); capTimer = null; }
  cancelBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  stopTimer();
  await sendToOffscreen('CANCEL');
```

- [ ] **Step 10: Syntax-check the file**

Run: `node --check extension/bar.js`
Expected: no output (exit 0) — file parses, and no lingering references to removed identifiers (`recognizer`, `transcriptText`, `langPills`, `renderTranscript`, etc.).

Also grep to confirm nothing references the removed symbols:
Run (PowerShell): `Select-String -Path extension/bar.js -Pattern 'recognizer|transcript|langPill|SpeechRecognition|currentLang'`
Expected: no matches.

- [ ] **Step 11: Commit**

```bash
git add extension/bar.js
git commit -m "feat(extension): drop Web Speech transcription, add 2-min recording cap"
```

---

## Task 6: Extension markup/styles — remove lang pills + transcript panel

**Files:**
- Modify: `extension/bar.html`
- Modify: `extension/bar.css`

- [ ] **Step 1: Remove the language-pill group from the recording state**

In `extension/bar.html`, inside the `data-state="recording"` block, delete the `.lang-pills` span (currently lines 37-40):

```html
          <span class="lang-pills" role="group" aria-label="Recognition language">
            <button type="button" class="lang-pill" data-lang="en-US">EN</button>
            <button type="button" class="lang-pill" data-lang="fr-FR">FR</button>
          </span>
```

- [ ] **Step 2: Remove the transcript panel**

In `extension/bar.html`, delete the transcript panel block (currently lines 123-131):

```html
      <!-- Transcript panel below the bar (only visible during recording) -->
      <div class="transcript-panel" id="transcriptPanel" hidden>
        <div class="bars-anim" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="transcript-text" id="transcriptText">
          <span class="placeholder">Listening…</span>
        </div>
      </div>
```

- [ ] **Step 3: Remove now-dead CSS rules**

In `extension/bar.css`, remove the rules that target the deleted elements. Search for and delete every rule whose selectors reference: `.lang-pills`, `.lang-pill`, `.transcript-panel`, `.transcript-text`, `.bars-anim`, `.ticker`, `.interim`, `.final`, `.placeholder` (the transcript placeholder), and any `@keyframes` used only by `.bars-anim`.

Run this first to locate them:
Run (PowerShell): `Select-String -Path extension/bar.css -Pattern 'lang-pill|transcript|bars-anim|ticker|\.interim|\.final|placeholder'`

Delete each matched rule block (the selector line through its closing `}`), plus any `@keyframes` block referenced only by `.bars-anim`. Leave all other rules untouched.

- [ ] **Step 4: Verify no dangling references remain**

Run (PowerShell): `Select-String -Path extension/bar.html -Pattern 'lang-pill|transcript'`
Expected: no matches.

Run (PowerShell): `Select-String -Path extension/bar.css -Pattern 'lang-pill|transcript-panel|transcript-text|bars-anim'`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add extension/bar.html extension/bar.css
git commit -m "feat(extension): remove language pills and live transcript UI"
```

---

## Task 7: End-to-end manual verification

**Files:** none (verification only)

The extension can only be exercised in Chrome. Do this once after Tasks 1-6.

- [ ] **Step 1: Confirm the backend env**

Ensure `web/.env.local` has `OPENAI_API_KEY` set (already required by the agent). Optionally set `TRANSCRIBE_MODEL` to override the default `gpt-4o-mini-transcribe`. Start the web app: `cd web; npm run dev`.

- [ ] **Step 2: Load the extension**

In Chrome → `chrome://extensions` → Developer mode → "Load unpacked" → select the `extension/` folder (or reload it if already loaded).

- [ ] **Step 3: Record a short brief**

On any page, start a Brief recording. Confirm:
- The bar shows a clean "Recording…" state with NO EN/FR pills and NO live transcript ticker.
- Speak a clear sentence or two, then click Stop. The bar shows "Building brief…" → success.

- [ ] **Step 4: Confirm the 2-minute cap**

Start another recording and leave it running past 2:00. Confirm it auto-stops at ~2:00, the bar shows "2 min limit reached — saving…", and the brief uploads normally.

- [ ] **Step 5: Confirm server-side transcription**

With a tracker connected, let a recorded brief file. In the `web` dev server logs, confirm no `[transcribe] failed` warning for a normal recording, and open the filed ticket — its description should reflect the spoken narration (now transcribed by OpenAI, not Web Speech). Force a failure path once (e.g. temporarily unset `OPENAI_API_KEY`) and confirm the brief STILL files (on keyframes/console), proving fail-soft.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

Only if Step 3-5 surfaced fixes. Otherwise nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** Audio-only track (Task 4) ✓; 2-min cap (Task 5) ✓; remove Web Speech (Tasks 4-6) ✓; remove EN/FR pills (Tasks 5-6) ✓; server transcription with `gpt-4o-mini-transcribe` + `TRANSCRIBE_MODEL` override + fail-soft (Tasks 1-2) ✓; auto-detect language i.e. no `language` param (Task 1 — `language` is never passed) ✓; soften agent label (Task 3) ✓; cleanup of `audio.webm` (Task 2) ✓; no new deps / no migration ✓.
- **Type consistency:** Helper is `transcribeAudio(input, deps)` everywhere; `TranscribeInput` = `{ bytes, filename, contentType }` used identically in test, helper, and run-processing; `collected.audioBlob` flows from `collectRecording` → STOP `...data` spread → `uploadAndFinish({ audioBlob })` → `files.push({ name: 'audio.webm' })`. brief.json `transcript: null` matches the server `if (transcript) json.transcript = transcript` override.
- **Deviation from spec wording:** The spec described arming the cap timer in offscreen on `mediaRecorder.start`. The plan puts the cap in the bar's `startTimer` instead, routing through the single existing stop→upload path (`stopAndSave`) with a `stopping` guard. This avoids a second upload code path in offscreen and the double-upload risk of two stop sources. Same user-visible behavior; bitrate comment update in offscreen is no longer needed since the cap lives in the bar (the existing 50 MB safety net comment stays accurate).
