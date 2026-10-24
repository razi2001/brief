# Auto-describe a brief from its narration

Date: 2026-10-19. Status: design approved by Razi. **Removed from the extension on
2026-10-24, before any release, at Razi's call:** the summary in "Additional data" read like
the transcript in the wrong place, and the ticket writer took it for the reporter's own
typed words. The description field stays empty unless the reporter types; the narration
stays the transcript, in the recording's sheet. The server side (`POST /api/describe`,
`lib/agent/describe-narration.ts`) is still deployed, unused.

**Shipped differently (2026-10-24), after #100 made the transcript go out at Stop:**
`/api/transcribe` stays transcript-only, and the description is its own call,
`POST /api/describe` with `{ text }` → `{ description }`. The offscreen document reports
the transcript (`TRANSCRIPT_RESULT`, with `describing: true` when there is one) the
moment it is back, then the description (`DESCRIPTION_RESULT`), so the transcript never
waits for the summary. `draft.describing` keeps the field on "Writing…" in between. The
`?describe=1` design below is what was first built.

## Goal

A user asked for this: "If you talk over the recording, would be awesome to have AI auto
populate this field, you can then verify if all good and submit."

When a recording has narration, the popup's "Describe the brief…" field fills itself
with a short AI summary of what was said. The reporter reads it, fixes it if needed,
and files.

## Today

- The offscreen document uploads the recording, then sends the audio-only track to
  `POST /api/transcribe`. The result lands on `draft.transcript` through
  `TRANSCRIPT_RESULT`. The popup shows it as an editable "Transcript" field inside the
  recording sheet.
- The description field (`#descField`, `draft.description`) is only ever typed or
  dictated. Nothing fills it from the recording.
- At filing time the agent reads the description as its primary signal and the
  transcript as a rough draft.

## Behaviour

1. Stopping a narrated recording (or adding a video file with narration) puts the
   description field in a "writing" state while it is empty: a shimmer over the field
   and the placeholder "Writing…". The field stays editable.
2. When the summary arrives, the empty field fills with it.
3. The summary is 1 to 3 plain sentences: what is wrong, where, and what was expected
   when the speaker said so. Same language as the speech. Names, labels, values and
   URLs spoken are kept as said. Nothing the speaker did not say is added. No dashes,
   no markdown, no quotes around it, no "The user says".
4. **What the reporter wrote always wins.** The AI fills only an empty field, or a
   field that still holds the AI's own untouched text. Any typing or dictation into
   the field makes it the reporter's and nothing replaces it.
5. A new recording replaces an untouched AI description (the old one described the
   previous video) and the field goes back to the writing state. Removing the
   recording clears an untouched AI description.
6. No speech, filler only, or any failure: the field stays empty, no error shown. The
   transcript keeps working as today.

Out of scope: using the video frames, a "regenerate" button, page context in the
prompt, changing what the filing agent does with the description.

## Design

### Server

`web/lib/agent/describe-narration.ts`

- `describeNarration(transcript: string, deps?): Promise<string | null>`.
- One chat completion with `fastModel()` and `chatParams(model)`, temperature 0.2,
  following the dependency-injection pattern of `transcribe.ts` (`deps.create`,
  `deps.model`) so tests never call OpenAI.
- The transcript is capped at 8000 characters before sending.
- The model answers `NONE` when the narration has nothing to report (filler, silence
  words, a test count). That and empty output return `null`.
- `cleanDescription(raw)` (exported, pure) tidies the answer: strips wrapping quotes
  and markdown markers (`**`, leading `- ` / `* ` / `#`), turns em and en dashes into
  commas, collapses whitespace, caps at 600 characters on a word boundary.
- Fail-soft by contract: any error returns `null`.

`web/app/api/transcribe/route.ts`

- `POST /api/transcribe?describe=1`: after transcription, when the text is non-empty,
  runs `describeNarration` and returns `{ text, description }` (`description` is `""`
  when there is none).
- Without `describe=1` the response is unchanged (`{ text }`): popup voice dictation
  keeps its exact behaviour.
- `maxDuration` stays 60 s: transcription plus one short fast-model call fits.

### Extension

`extension/cloud.js`

- `transcribeRecording(blob, token)` posts to `/api/transcribe?describe=1` and returns
  `{ transcript, description }`. It shares the request code with `transcribeNote`,
  which keeps returning a string.

`extension/offscreen.js` (`uploadAndFinish`)

- Starts transcription at the same time as the upload instead of after it, so the
  description does not wait for a large video upload. The audio track is small.
- Sends `TRANSCRIPT_RESULT` with `{ transcript, description }` (or `{ error }`) once
  the transcription settles, whatever the upload outcome, while the upload is still
  the brief's newest (`current()`).

`extension/draft.js`

- New draft field `descriptionAuto: false`: true while `description` is the AI's
  untouched text.
- `applyAutoDescription(d, text)` (pure, mutates `d`): sets `d.description = text` and
  `d.descriptionAuto = true` when `text` is non-empty and the description is empty or
  still auto. Otherwise leaves `d` alone. Returns whether it applied.
- `clearAutoDescription(d)` (pure): empties the description when it is auto.
- `landRecording` calls `clearAutoDescription` when a new upload starts.

`extension/background.js` (`TRANSCRIPT_RESULT`)

- Calls `applyAutoDescription(d, message.description)` next to the transcript update.

`extension/popup.js`

- Any user edit of the description (typing, dictation) persists
  `descriptionAuto = false` with the text.
- Removing the recording calls `clearAutoDescription`.
- The live storage listener copies a background-changed description into the field
  when the field is not focused and its value is empty or still the previous auto
  text. A focused field is never overwritten.
- `#descWrap` gets the class `writing` while `draft.transcribing` and the description
  is empty: placeholder "Writing…" and the shimmer already used by the recording
  sheet's "Transcribing" state.

## Errors

| Case | Result |
|---|---|
| Transcription fails | `TRANSCRIPT_RESULT { error }`, `transcriptFailed` as today, field leaves the writing state empty |
| Summary call fails or returns NONE | `{ text, description: "" }`, transcript lands, field empty |
| Reporter typed while it was writing | Their text stays, the summary is dropped |
| Upload fails | The transcript and description still land (transcription no longer waits on the upload) |
| A newer recording started | The older result is dropped (`current()` and the draft id guard) |

## Testing

- Vitest `describe-narration.test.ts`: prompt carries the transcript, NONE and empty
  give null, errors give null, `cleanDescription` strips quotes, markdown and dashes and
  caps length, the model choice flows through.
- Vitest `app/api/transcribe/route.test.ts`: 401 without a token; no `describe` returns
  `{ text }` only; `describe=1` returns `{ text, description }`; no summary call when the
  transcript is empty.
- Node test `extension/test/auto-description.test.mjs`: `applyAutoDescription` fills
  empty, replaces auto, never replaces user text, ignores empty input;
  `clearAutoDescription` and `landRecording` clear only auto text.
- Live: run `describeNarration` against the real model on English and French narration
  samples, and `/api/transcribe?describe=1` on the dev server with a real audio clip.
- Headless extension: popup renders the writing state and the filled field from a
  seeded draft (existing CfT harness).
