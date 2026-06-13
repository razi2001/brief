# OpenAI server-side transcription

**Date:** 2026-06-13
**Status:** Approved (brainstorm) — ready for implementation plan

## Problem

Live transcription today runs Chrome's `webkitSpeechRecognition` (Web Speech API)
inside the recording bar ([extension/bar.js](../../../extension/bar.js)). It is the
"catastrophic" part of the recording experience: it truncates, drops words, breaks
on language switches, and silently fails entirely on sites whose Permissions-Policy
blocks speech recognition in iframes. Whatever rough text it produces is uploaded in
`brief.json` and fed to the ticket-writing agent, so transcript quality directly
degrades ticket quality.

OpenAI is already wired into the stack server-side
([web/lib/agent/process-brief.ts](../../../web/lib/agent/process-brief.ts) uses
`OPENAI_API_KEY` + `gpt-4o`), and the `openai` npm package is already a dependency.
The recorded audio already lands in Supabase Storage. So we can replace live STT with
a server-side OpenAI transcription pass on the uploaded audio — much better quality,
and almost all the plumbing already exists.

## Decisions

- **Drop live transcription entirely.** No words on screen while recording; the bar
  shows a simple "Recording…" state. The server transcript is the only transcript,
  and it's the one that actually matters for ticket quality.
- **Transcribe an audio-only track, not the video.** OpenAI's transcription API caps
  uploads at 25 MB; recordings can reach ~50 MB. A dedicated `audio/webm;codecs=opus`
  track is ~1–2 MB for a full recording, always fits, and gives the cleanest input.
  Avoids any server-side ffmpeg/audio tooling.
- **Cap recordings at 2 minutes.** Keeps audio tiny, keeps video (~18 MB at 1.2 Mbps)
  well under the 50 MB Supabase cap, and bounds transcription latency/cost.
- **Remove the EN/FR language pills from the UI.** OpenAI transcription auto-detects
  language, so the manual language hint is unnecessary.
- **Model: `gpt-4o-mini-transcribe`**, overridable via `TRANSCRIBE_MODEL`. Better
  word-error-rate than `whisper-1`, cheap, same 25 MB limit.

## Design

### 1. Extension — capture & cap ([extension/offscreen.js](../../../extension/offscreen.js), [extension/bar.js](../../../extension/bar.js))

**Audio-only track.** The offscreen document already builds a mixed-audio
`dest.stream` (tab + mic) for the video recorder ([offscreen.js:135](../../../extension/offscreen.js)).
Add a **second `MediaRecorder`** on `new MediaStream(dest.stream.getAudioTracks())`
with `audio/webm;codecs=opus`, collecting into its own chunk array. On stop it
produces `audio.webm`, pushed into the upload `files[]` alongside `recording.webm`
(`contentType: "audio/webm"`).

**2-minute hard cap.** Arm a `setTimeout(120_000)` when `mediaRecorder.start()` is
called; clear it on manual stop/cancel. On fire, trigger the normal stop+upload path
and surface a brief "2 min limit reached — wrapping up" note in the bar. Update the
bitrate comment at [offscreen.js:155](../../../extension/offscreen.js); at 2 min /
1.2 Mbps the video is ~18 MB, so the existing "exceeded max size" path becomes a rare
safety net.

**Remove Web Speech.** Delete the `webkitSpeechRecognition` machinery in
[bar.js](../../../extension/bar.js): `startSpeechRecognition`/`stopSpeechRecognition`,
`recognizer`, `recognitionShouldRun`, the transcript caches, and the live transcript
panel rendering during recording. The bar shows a clean "Recording…" state instead.
Also remove the **EN/FR language pills** UI and the `currentLang`/`lang` storage that
fed them.

**brief.json changes.** `transcript: null`, `transcriptChunks: []` (or dropped), and
`transcriptLang` removed. The `recording` block is unchanged; an `audio` block may be
added for symmetry but is not required (server keys off the fixed `audio.webm` name).

### 2. Server — transcription step ([web/lib/agent/run-processing.ts](../../../web/lib/agent/run-processing.ts))

Right after `brief.json` is loaded ([run-processing.ts:84](../../../web/lib/agent/run-processing.ts))
and before building the agent input:

- Download `${prefix}/audio.webm`. If absent, optionally fall back to
  `recording.webm` only when it's ≤25 MB; otherwise skip transcription.
- Transcribe via a new helper `web/lib/agent/transcribe.ts` using the existing
  `openai` client:
  ```ts
  openai.audio.transcriptions.create({
    file,                                              // the audio.webm File/Blob
    model: process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    response_format: "text",
    // language omitted — auto-detect
  })
  ```
- Set `json.transcript = text` so the existing `buildContextBlock` path
  ([context-block.ts:56](../../../web/lib/agent/context-block.ts)) picks it up
  unchanged.
- **Failure is non-fatal.** Wrap in try/catch: on any API error or missing audio,
  leave `transcript` null and log. The brief still files using keyframes + console/
  network evidence. Transcription must never fail a brief.
- Add `${prefix}/audio.webm` to the cleanup `remove()` list at
  [run-processing.ts:203](../../../web/lib/agent/run-processing.ts).

`maxDuration` is already 300 s; a ≤2-min audio transcribes in seconds.

### 3. Agent prompt tweak ([web/lib/agent/context-block.ts](../../../web/lib/agent/context-block.ts))

The transcript label at [context-block.ts:59](../../../web/lib/agent/context-block.ts)
currently warns *"rough draft — speech-to-text; trust the screenshots/console over it,
never quote it"* — calibrated for the flaky Web Speech output. Soften to reflect a
clean transcript, e.g. *"SPOKEN NARRATION (transcribed audio — the reporter's intent;
corroborate against screenshots/console, may quote when relevant)."* Screenshots and
console stay ground truth; the narration is now trustworthy enough to quote.

## Scope / non-goals

- **Files touched:** `extension/offscreen.js`, `extension/bar.js`,
  `web/lib/agent/run-processing.ts`, new `web/lib/agent/transcribe.ts`, one-line tweak
  to `web/lib/agent/context-block.ts`. Bar HTML/CSS lose the language-pill + transcript-panel markup.
- **No new dependencies** (`openai` already installed), **no ffmpeg**, **no DB
  migration**.
- **Not doing:** live/streaming transcription, multi-language UI, speaker diarization,
  transcript editing in the dashboard.

## Risks / edge cases

- **Audio track empty** (mic denied, silent tab): transcription returns empty/near-
  empty text → treated as no transcript, brief files on visual evidence. Acceptable.
- **audio.webm missing on older drafts** (pre-deploy briefs retried later): fall back
  to recording.webm if ≤25 MB, else skip. No crash.
- **2-min auto-stop racing a manual stop:** the timer is cleared on manual stop/cancel;
  the stop path must be idempotent (it already guards re-entry).
- **OpenAI transcription latency/cost:** bounded by the 2-min cap; `gpt-4o-mini-transcribe`
  is cheap.
