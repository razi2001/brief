# Extension: one brief at a time — multi-screenshot + visible transcript

**Date:** 2026-06-22
**Status:** Approved (design shape validated via visual companion)
**Scope:** `extension/` (popup, background, offscreen, bar, content) + `web/` (process route, agent processing/evidence/context, brief source detection)

## Problem

The extension popup is a *list* manager: you name briefs, add them to an inbox, and file N tickets at once. It's more machinery than the job needs. Three changes make it sharper:

1. **One brief at a time.** Drop the multi-brief list. Opening the popup drops you straight into the single brief you're building.
2. **Multiple screenshots, each with its own description.** Today a brief holds exactly one screenshot and no per-shot caption.
3. **Transcript visible in the extension right after recording.** Today the voice track is transcribed server-side at filing time and never shown; the user can't see or correct it.

Plus a standing rule that fell out of design review: **no instructional / hand-holding copy** anywhere — controls and labels only.

## Non-goals

- No change to pairing, auth, tracker routing, or the agent's ticket-writing behavior beyond consuming the new per-screenshot captions + supplied transcript.
- No live (during-recording) transcription. Transcription stays server-side (OpenAI); we just surface it to the popup after stop.
- No multi-brief batching, folders, or history in the extension.

## Design

### Data model (extension storage)

Replace the `inbox: BriefEntry[]` array with a single `draft` object in `chrome.storage.local`:

```
draft = {
  id,                 // stable id; async results (upload, shot, transcript) must match this
  name,               // user title
  screenshots: [      // ordered; each its own caption
    { id, dataUrl, annotated, description, pageUrl, pageTitle, addedAt, uploaded }
  ],
  recording: null | { recordedAt, durationMs, includeVideo },
  transcript,         // string; editable. '' until transcription lands
  transcribing,       // true between stop and transcript arrival
  description,        // free text (Details)
  extra: [ { key, value } ],
  pageUrl, pageTitle, // brief-level fallback (active tab at first capture)
  cloudBriefId,       // set once the recording draft is uploaded
  uploading, uploadFailed, uploadError,
  createdAt
}
```

`null` / absent `draft` = empty composer.

**Migration (one-time, silent):** on load, if `draft` is absent but a legacy `inbox` array exists, adopt one entry → the newest, preferring any entry with `uploading: true` (don't strand an in-flight upload). Convert its single `screenshot` → `screenshots: [{…, description: ''}]`. Remove `inbox`. Other entries are dropped (one-brief world).

**Why a single object, not `inbox` capped at 1:** the readers in background/offscreen/bar look briefs up *by id* inside an array. A single object with an id check (`draft.id === msg.briefId`) is the honest shape, makes the popup logic collapse to "render the draft", and removes all list/accordion code.

### Popup UI (popup.html / popup.js / popup.css)

Single-brief composer, top to bottom:

- **Header** — unchanged ✦ brand + cloud button.
- **Name** — Instrument-Serif title input (placeholder "Name this brief…").
- **Capture** — two buttons: Record / Screenshot (dashed, equal width).
- **Screenshots** (only when ≥1) — section labeled "Screenshots N". Each shot = a card: thumbnail (left) + description textarea (right, placeholder "Add a note for this shot…") + remove ×. Below: "＋ Add screenshot".
- **Recording** (only when present) — card showing the recording with state (uploading ✦-spin / uploaded ✓ / failed). Inside: **Transcript** sub-block — "Transcribing…" shimmer until it lands, then the text rendered editable (click to edit, persists on blur). An **"Attach video to ticket"** checkbox lives here (was in the old details panel; off by default).
- **Details** — quiet "＋ Description & fields" toggle (visible even in the fresh state) revealing the description textarea (with the existing voice-dictation mic) + key/value extra fields.
- **Create ticket** — single primary button. Disabled+"Uploading…" while the recording upload is pending; otherwise enabled when the draft has any evidence. Never "Create N tickets".

Remove: the add-brief form, the brief list, the accordion/expand logic, the export/zip button + success-as-"copied", the rec-count badge. Keep: inline error bar, the green success overlay (repurposed to "Queued → opening your tickets").

`isReady(draft)` = has ≥1 screenshot OR a recording OR non-empty description.

After a successful file: clear `draft`, show the success overlay, open/reuse the tickets tab (existing `openTicketsTab`).

### Capture flows

**Screenshot (multiple).** `background.START_SHOT` already captures the visible tab + page url/title. Carry `{pageUrl,pageTitle}` through `INJECT_SHOT` → `content.injectShot` → back in `SHOT_SAVED`. `background.SHOT_SAVED` **appends** a new screenshot `{id, dataUrl, annotated, description:'', pageUrl, pageTitle, addedAt, uploaded:false}` to `draft.screenshots` (verifying `draft.id`), instead of overwriting `draft.screenshot`. Annotator (`shot.*`) stays draw-only — descriptions are typed in the popup.

**Recording + transcript.** `bar.finishToInbox` writes onto `draft` (by id): `recording`, `uploading:true`, `transcribing:true`. `offscreen.uploadAndFinish`:
1. Upload the draft (brief.json + recording.webm + audio.webm + keyframes + any already-captured screenshots) — unchanged, then report `UPLOAD_RESULT{cloudBriefId}` immediately (this gates filing, must not wait on transcription).
2. Then POST `audio.webm` to `/api/transcribe` (reusing the token from `GET_UPLOAD_CONTEXT`) and report `TRANSCRIPT_RESULT{briefId, transcript|error}`.

`background.UPLOAD_RESULT` sets `draft.cloudBriefId` / `uploading:false` (id-matched). New `background.TRANSCRIPT_RESULT` sets `draft.transcript` + `transcribing:false` (id-matched; ignored if the draft was cleared/replaced). Popup re-renders via the existing `storage.onChanged` listener.

brief.json (offscreen) gains `screenshots: [{file, description, annotated}]` and continues to set `transcript: null` (server still fills it when no client transcript is supplied).

### Filing (popup → cloud)

`bcCreateTicket` files the single draft:
1. Ensure a cloud draft exists. Recording briefs already have `cloudBriefId`. Screenshot/text-only briefs `uploadDraft(files, meta)` where `files` includes every screenshot as `screenshots/<shotId>.png` + brief.json.
2. For recording briefs, push any screenshots added *after* the recording upload via `uploadFilesToDraft` (idempotent upsert) — same pattern as today's late-screenshot fix, generalized to the list.
3. Call `processBrief(cloudBriefId, overrides)` with the **authoritative user-edited metadata** as overrides (see server contract). This is how edited transcripts and per-shot descriptions added/changed after the initial upload reach processing without rewriting capture-owned brief.json.

`uploadDraft`/`uploadFilesToDraft` are unchanged (already take an arbitrary file-name list). `meta.hasScreenshot` = `screenshots.length > 0`.

### Server contract (web/)

**`POST /api/briefs/[id]/process`** — extend the body from `{title, includeVideo}` to also accept optional overrides:
```
{ title, includeVideo,
  transcript?: string,
  description?: string,
  extra?: [{key,value}],
  screenshots?: [{ file, description, annotated }] }
```
Pass them through to `processBriefById(userId, briefId, opts)` as `opts.overrides`.

**`run-processing.ts`:**
- If `overrides.transcript` is a non-empty string, use it as `json.transcript` and **skip** the OpenAI re-transcription. Else behave as today (transcribe `audio.webm`, fallback to video).
- Merge `overrides.description`/`extra`/`title`/`includeVideo` over the brief.json values (user's latest edit wins).
- **Screenshots:** `list(${prefix}/screenshots)` → download every PNG → push as a model image + an attachable evidence file + an evidence item `{kind:'screenshot', caption}`. Caption resolves from `overrides.screenshots` (by `file`), else brief.json `screenshots[]`, else none. Keep reading the legacy single `screenshot.png` as one more screenshot for back-compat. Update the media-cleanup delete list + the default `fallback` attachment set to cover the `screenshots/` dir.

**`evidence.ts` / `context-block.ts`:** thread an optional `caption` on screenshot evidence items so the manifest the agent sees reads e.g. `screenshot shots/2.png — "Promo field shows applied but total unchanged"`. Captions are user intent and must reach the model. Update their unit tests.

**`brief.ts` `detectSourceKind`:** treat `meta.hasScreenshot` (already set from `screenshots.length`) as screenshot evidence; recording detection unchanged. Update its test.

## Components & boundaries

- **Popup** — renders + edits the `draft`; owns filing. No knowledge of recorder internals.
- **Background** — message broker + storage writer for async results (shot/upload/transcript), id-matched to the current draft. Owns the badge.
- **Offscreen** — records, uploads, transcribes; talks only via `chrome.runtime`.
- **Bar / content / shot** — capture surfaces; carry ids + page context, never read storage shape beyond the draft.
- **Process route** — thin: auth + accept overrides + delegate.
- **run-processing** — assembles evidence (now multi-screenshot + supplied transcript) for the agent.

## Testing

- **Web unit (vitest):** `detectSourceKind` (screenshot via hasScreenshot), `context-block` (screenshot captions render), `evidence` (caption plumbing), and a `run-processing` seam if one exists for screenshot collection / transcript-override precedence. Keep the existing 64+ green.
- **Type/build:** `tsc --noEmit` + `next build` clean.
- **Extension:** `node --check` all touched JS. Manual in-browser checklist (no headless extension here): fresh→record→see transcript→edit→add 2 screenshots w/ captions→file→ticket shows both shots' captions + corrected transcript; screenshot-only file; text-only file; upgrade migration from a legacy `inbox`.

## Risks

- **brief.json vs. edits race** — solved by sending edits as process-time overrides rather than rewriting capture-owned brief.json.
- **Transcript latency** — surfaced as a "Transcribing…" state; filing is never blocked on it (cloudBriefId lands first; transcript can also be supplied empty and the server falls back).
- **Stale async results after the draft is cleared/replaced** — every storage write from background is guarded by `draft.id === msg.briefId`.
- **50MB Supabase object cap** unchanged; multiple PNG screenshots are small. See [[brief-upload-pipeline]].
