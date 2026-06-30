# Filing agent: better video use + signal priority — design

**Date:** 2026-06-22
**Status:** Draft for review
**Author:** Razi (+ Claude)

## 1. Goal

Improve how the cloud filing agent turns a captured report into a ticket, by fixing the **order of authority** between the signals it gets and by **using the screen recording more intelligently**. Five concrete behaviours change:

1. **Use the video better.** Today the server samples 8 evenly-spaced keyframes and drops only exact-byte duplicates, so the model often sees near-identical stills and can miss the moment the UI actually changes. Select frames where the screen *actually changed* (perceptual de-dup) and present them as a *timestamped, ordered storyboard*.
2. **The reporter's typed description is the primary signal** — it defines what the ticket is about. Everything else corroborates it. Today the typed description is buried in the raw `brief.json` blob and never surfaced in the high-signal context block.
3. **Console / network errors are supporting context, not the driver.** They enrich the ticket body and are at most a secondary routing tiebreaker; they no longer define what the ticket is about or where it routes.
4. **Status defaults to the workspace's normal new-ticket status** unless the description or the user's standing preferences explicitly request a starting status.
5. **Actively choose the most relevant *existing* label(s)** for every ticket, and never invent a label for a report (only an explicit preference may introduce a new label name).

## 2. The signal hierarchy (the core change)

Everything else follows from one reordering of how the agent weighs evidence:

1. **Reporter's typed description** (`brief.json.description`) — *primary*. Defines intent, scope, and — when stated — routing / status / priority / labels.
2. **Video frames + annotated screenshot** — show what actually happened; ground truth for *what is on screen*; corroborate and add repro detail. They serve the description; they do not override the stated intent.
3. **Spoken narration** (`brief.json.transcript`) — rough draft of intent (speech-to-text, mediocre on jargon/accents).
4. **Console / network errors** (`brief.json.events[]`) — *supporting technical context only*. Extra detail for the body; a secondary routing tiebreaker at most.

When the typed description is empty, the agent falls back to today's visual-led behaviour (frames + narration carry the intent).

## 3. Non-goals

- **No model / provider change.** Stays on OpenAI `chat.completions` with the current direct Linear-GraphQL / Jira-REST clients. (The 2026-06-17 remote-MCP design was not adopted; the code is the direct-client `chat.completions` path and that is what this builds on.)
- **No new dependency.** Perceptual de-dup uses Node's built-in `zlib` to inflate PNG data; no image library is added.
- **No extension change.** Keyframe capture (every 2s, ≤1280px PNG, `extension/offscreen.js`) is untouched. All work is server-side.
- **No change to evidence *attachment* selection.** The agent still picks `attach[]` from the evidence pool; the "force the recording when the user toggled it on" guard stays. This spec changes which frames the model *sees* and how they are framed, not what gets attached.
- **No change to dashboard live-sync, auth, or upload paths.**
- **No hard label-drop guard by default** (see §4.6) — label discipline is prompt-led.

## 4. Detailed design

### 4.1 Perceptual frame de-dup — new `web/lib/agent/frame-hash.ts`

A pure, dependency-free, unit-tested module. Three exported functions plus a selector:

- `decodePngToGray(buf: Buffer): { width: number; height: number; gray: Uint8Array } | null`
  - Parse the PNG signature + chunks; read `IHDR` (width, height, bit depth, colour type, interlace); concatenate `IDAT`; `zlib.inflateSync` it.
  - Support the canvas-emitted format only: **bit depth 8, colour type 2 (RGB) or 6 (RGBA), interlace 0**. Anything else → return `null`.
  - Un-filter scanlines per the PNG spec (filter types 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) with `bytesPerPixel` = 3 or 4.
  - Convert to grayscale (`0.299R + 0.587G + 0.114B`, integer).
  - Wrapped so **any** failure returns `null` — never throws.
- `dHash(gray, width, height): bigint`
  - Downscale (box/nearest sampling) to a 9×8 grayscale grid; for each of the 8 rows compare each pixel to its right neighbour → 64 bits → `bigint`. Standard difference hash.
- `hamming(a: bigint, b: bigint): number` — popcount of `a ^ b`.
- `selectDistinctFrames(frames, { threshold = 10, maxFrames = 12 })` — **pure** selector:
  - Input: ordered `frames: { name, filename, timestampMs?, bytes }[]` (sorted by name = capture order).
  - Fingerprint each frame: `dHash` when `decodePngToGray` succeeds, else fall back to the md5 hex of the bytes (exact-match only — preserves today's behaviour for undecodable frames).
  - Greedy keep: always keep the first frame; keep a subsequent frame when it differs from the **last kept** frame by more than `threshold` (Hamming for dHash pairs; exact-inequality for md5 fallbacks); always keep the last frame.
  - If more than `maxFrames` survive (a very dynamic recording), sample `maxFrames` evenly across the kept set, preserving order and the first/last.
  - Return the kept frames in capture order.
  - `threshold ≈ 10` on a 64-bit dHash separates "cursor moved / tiny delta" (small distance) from "real UI transition" (large distance); it is a named constant, documented and covered by tests, tunable.

Failure isolation: if decoding fails for every frame, the selector degrades to exact-byte de-dup over the same set — identical to today. Frame analysis can never break filing.

### 4.2 Wiring the selector — `web/lib/agent/run-processing.ts`

- Replace the current "sample 8 evenly-spaced names, then md5 exact-dedup" block (the `SAMPLE = 8` loop + `seenFrame` md5 set) with: download **all** keyframes, then call `selectDistinctFrames(...)` over the full set.
- Carry each kept frame's `timestampMs` (already available via `tsByFile`, built from `brief.json.keyframes[]`) onto the image entries handed to `processBrief`.
- The attachable evidence pool / fallback logic is unchanged: distinct kept frames still go into `files`/`items` as attachable evidence, and `fallback` still chooses a lean default. (The recording-toggle behaviour is untouched.)
- Update the existing `console.log` summary to report `kept` (distinct) vs total keyframes.

### 4.3 Timestamped storyboard in the vision payload — `web/lib/agent/process-brief.ts`

- Extend `BriefInput.images` entries with an optional `timestampMs?: number`.
- When assembling `withImages`, interleave a short **text label before each image part** instead of emitting bare `image_url` parts:
  - Keyframes: `Frame {i} of {N} — {M:SS} into the capture:` then the image.
  - Annotated screenshot: `Annotated screenshot (red marks = where the reporter is pointing):` then the image.
  - `{M:SS}` is `timestampMs` formatted as minutes:seconds.
- The model receives an explicitly ordered, timed sequence — a storyboard — rather than a pile of unordered stills. (OpenAI `chat.completions` user `content` arrays support interleaving `text` and `image_url` parts.)
- Keep the existing image-rejection fallback (`/image|vision|media/i` → retry text-only); the `textOnly` path omits the storyboard labels.
- The "CORRELATE EVERYTHING" tail text is reworded to lead with the reporter's description and to name console/network errors *last* as supporting context (consistent with §2).

### 4.4 Description as the primary signal — `web/lib/agent/context-block.ts` + `system-prompt.ts`

- `buildContextBlock`: prepend a **`REPORTER'S DESCRIPTION`** block built from `brief.json.description` (trimmed, length-capped like the transcript), worded as *"the primary signal — what the ticket is about; everything else corroborates it."* Reorder the block so it leads, then page context, then narration, then errors **last**.
- `system-prompt.ts` (GROUND TRUTH / CORRELATE sections): the typed description is the authoritative statement of intent; frames/screenshots are ground truth for what is on screen and corroborate the description; narration is the rough draft. When no description is present, fall back to visual-led intent. Keep the "silently correct mis-transcriptions, never quote narration" rule.

### 4.5 Demote console / network errors — `context-block.ts` + `system-prompt.ts`

- `buildContextBlock`: relabel the errors block from *"CONSOLE / RUNTIME ERRORS (verbatim — include the relevant ones in a code block)"* to **`SUPPORTING TECHNICAL CONTEXT`** — *"console/network errors captured during the session; use as extra detail to enrich the ticket (e.g. a context line or appendix). Do not let them define what the ticket is about or drive routing unless the reporter's description points at them."* Errors render last. Extraction/formatting logic (network-error → `METHOD url → status reason`, de-dup, 8-item cap) is unchanged.
- `system-prompt.ts`: soften "UNDERSTAND THE FAILURE BEFORE YOU ROUTE" so routing is driven by the *described problem* first; a console 500 / failing endpoint is a **secondary** signal that can sharpen routing, not the primary router. In the description-writing section, keep "include relevant console errors verbatim in a code block" but framed as supporting detail.

### 4.6 Status default + override — `system-prompt.ts` (and the inline preferences block in `process-brief.ts`)

Prompt-only; no tracker code change. The trackers already apply their normal new-issue status when `state` is unset (Linear uses the team default state; Jira leaves the workflow initial status), so the fix is to stop the agent from setting a non-default status on its own:

- Add an explicit rule: **leave the workflow state unset by default** so the issue lands in the workspace's normal status for new tickets. **Do not copy a status from existing issues found via `search_issues`** — those reflect each issue's current progress, not where new work starts.
- **Override:** when the reporter's description *or* the standing preferences explicitly request a starting status, apply it (resolve to a real state name from `get_target_details`) and verify/repair via `get_issue`/`update_issue` as today.
- This implements "like the other newly created tasks by default, or follow the status the description/preferences set."

### 4.7 Active label selection from existing labels — `system-prompt.ts`

Prompt-led; no change to the create-on-miss path (it stays for explicit preference labels like "label everything inbound").

- Instruct the agent to **always evaluate the target's existing labels** (from the seeded target list, `get_target_details`, and `search_issues` precedent) and apply the most relevant one(s) to every ticket — actively, not only "when called for."
- **For report-driven labels: choose only from existing labels; never invent.** Reserve label *creation* strictly for an explicit standing preference that names a new label.
- Rationale for keeping it prompt-led: `linear.ts:406-418` creates a missing label (intended for preferences) and Jira accepts free-form labels; a hard "drop unmatched report labels" guard would risk dropping a legitimate new preference label. The agent sees the full existing-label list, so a strong instruction to pick from it is the right lever. (A hard guard remains an option if prompt discipline proves insufficient.)

## 5. Code changes (summary)

- **`web/lib/agent/frame-hash.ts`** — NEW. PNG→gray decode (`zlib`), `dHash`, `hamming`, `selectDistinctFrames`. Pure, no deps.
- **`web/lib/agent/run-processing.ts`** — use `selectDistinctFrames` over all keyframes; carry `timestampMs` onto images; update the log line.
- **`web/lib/agent/process-brief.ts`** — `BriefInput.images[].timestampMs?`; interleave storyboard labels in `withImages`; reword the CORRELATE tail; tweak the inline preferences/status framing.
- **`web/lib/agent/context-block.ts`** — add the `REPORTER'S DESCRIPTION` block first; reorder; relabel errors as `SUPPORTING TECHNICAL CONTEXT` last.
- **`web/lib/agent/system-prompt.ts`** — signal hierarchy (description primary, errors supporting), softened error-driven routing, status-default rule, active existing-label selection.

Trackers (`linear.ts`, `jira.ts`), auth, routes, dashboard, and the extension are **unchanged**.

## 6. Testing

- **`web/lib/agent/frame-hash.test.ts`** — NEW.
  - Build small valid PNG fixtures in-test (deflate known scanlines with `zlib.deflateSync`; assemble `IHDR`/`IDAT`/`IEND` with correct CRC32) for colour types 2 and 6, exercising each filter type, and assert `decodePngToGray` returns the known pixels.
  - `dHash`: identical buffers → distance 0; a one-tile change → small distance; a clearly different image → large distance.
  - `selectDistinctFrames`: a run of near-identical frames collapses to ~1; injected transitions are kept; first/last always kept; the `maxFrames` cap samples evenly; undecodable bytes fall back to exact-match de-dup.
- **`web/lib/agent/context-block.test.ts`** — UPDATE: `REPORTER'S DESCRIPTION` present and ordered before narration/errors when `description` is set; absent when empty; errors block relabeled to `SUPPORTING TECHNICAL CONTEXT`; existing network-error/narration assertions still pass (adjust labels as needed).
- **Full suite green:** `tsc --noEmit`, `vitest run`, `next build`. (Extension not live-testable here; server logic only.)

## 7. Risks & mitigations

- **PNG un-filtering bug → garbage hashes / wrong de-dup.** *Mitigation:* implement against the spec with fixture-based unit tests; decode failures return `null` and fall back to exact-byte de-dup, so a bug degrades to today's behaviour rather than breaking filing.
- **dHash threshold mis-tuned** (drops real transitions or keeps dupes). *Mitigation:* named, documented, test-covered constant; first/last always kept; conservative default (~10).
- **Over-prioritising a terse/empty description.** *Mitigation:* explicit empty-description fallback to visual-led intent; description leads *intent*, but frames/console remain ground truth for on-screen facts and repro detail.
- **Agent still invents labels / sets a non-default status despite the prompt.** *Mitigation:* the existing-label list is in front of the model and the rules are explicit; the verify/repair loop already reads back fields. Hard guards (label-drop, state-strip) are available as a follow-up if needed.
- **Vision cost of more frames.** *Mitigation:* `maxFrames` cap (~12) bounds it; perceptual de-dup typically *reduces* the frame count for mostly-static recordings.

## 8. Open questions

- Final values for `threshold` and `maxFrames` — start at 10 / 12, confirm against a couple of real recordings during implementation.
- Whether to also include a brief `M:SS` range or duration in the storyboard preamble (e.g. "9 frames over 0:18") — minor; decide during implementation.
