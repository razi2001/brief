# One Brief at a Time — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the extension into a single-brief composer that holds multiple captioned screenshots and shows the recording's transcript inline (editable), and teach the server to consume both.

**Architecture:** Replace the multi-brief `inbox` array with one `draft` object in `chrome.storage.local`, owned by a shared `extension/draft.js` module (imported by popup/background/bar; offscreen stays storage-free and routes through background). The recording's audio is transcribed right after stop via the existing `/api/transcribe`, surfaced editable in the popup. At file time the popup sends the user's edited transcript + per-screenshot captions to the process route as **overrides** that win over capture-owned `brief.json`, so processing reads every screenshot and the corrected narration.

**Tech Stack:** Chrome MV3 (vanilla ES-module JS), Next 16 (App Router, TS) + Supabase + OpenAI, vitest.

> **Custom Next.js:** `web/AGENTS.md` warns this Next.js has breaking changes — consult `web/node_modules/next/dist/docs/` before touching anything Next-specific. The web tasks here only touch route bodies + pure libs, no Next API surface changes.

---

## File Map

**Web (backward-compatible foundation, ships first):**
- `web/lib/agent/evidence.ts` — add optional `caption` to `EvidenceItem`; render it in the manifest. + test.
- `web/lib/agent/context-block.ts` — add a SCREENSHOTS block from `json.screenshots[]`. + test.
- `web/lib/agent/overrides.ts` *(new)* — pure `mergeBriefOverrides(json, overrides)` + `captionForScreenshot(file, screenshots)`. + test.
- `web/app/api/briefs/[id]/process/route.ts` — parse `overrides` from the body, pass to `processBriefById`.
- `web/lib/agent/run-processing.ts` — accept `overrides`; skip re-transcription when a transcript is supplied; collect ALL `screenshots/*.png` (+ legacy `screenshot.png`) with captions; update cleanup + fallback sets.

**Extension:**
- `extension/draft.js` *(new)* — the single-draft storage model + migration + helpers.
- `extension/popup.html` — single-brief composer markup.
- `extension/popup.js` — rewrite around `draft`.
- `extension/popup.css` — screenshot cards, recording/transcript blocks, details toggle.
- `extension/background.js` — draft-based badge; `SHOT_SAVED` appends; new `TRANSCRIPT_RESULT`; `UPLOAD_RESULT`/`GET_UPLOAD_CONTEXT`/`START_SHOT` read the draft; run migration on startup.
- `extension/offscreen.js` — stop bundling a single screenshot; write `screenshots[]` metadata to brief.json; transcribe audio after upload → `TRANSCRIPT_RESULT`.
- `extension/bar.js` — `finishToInbox` writes the draft (recording/uploading/transcribing) via `draft.js`.
- `extension/content.js` — carry `pageUrl`/`pageTitle` through the screenshot overlay round-trip.
- `extension/cloud.js` — `processBrief(briefId, overrides)` signature.

---

# Part A — Web (TDD; ship + verify before touching the extension)

Run all web commands from `web/`. If `node_modules` is missing: `npm install` first.

## Task A1: Per-screenshot captions in the evidence manifest

**Files:** Modify `web/lib/agent/evidence.ts`; Test `web/lib/agent/evidence.test.ts`

- [ ] **Step 1: Add the failing test** — append to `evidence.test.ts` inside `describe("buildEvidenceManifest", …)`:

```ts
  it("appends a screenshot's caption to its manifest line", () => {
    const withCaption: EvidenceItem[] = [
      { name: "screenshots/a.png", kind: "screenshot", caption: "Total ignores the promo code" },
      { name: "screenshots/b.png", kind: "screenshot" },
    ];
    const text = buildEvidenceManifest(withCaption, false);
    expect(text).toContain('screenshots/a.png (annotated screenshot) — "Total ignores the promo code"');
    expect(text).toMatch(/^- screenshots\/b\.png \(annotated screenshot\)$/m);
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run lib/agent/evidence.test.ts` → fails (caption not in type / not rendered).

- [ ] **Step 3: Implement** — in `evidence.ts`, add `caption` to the interface and render it:

```ts
export interface EvidenceItem {
  name: string;
  kind: EvidenceKind;
  /** Position in the capture (keyframes), for correlating with the narration. */
  timestampMs?: number;
  /** User's note for a screenshot — their intent, surfaced to the agent. */
  caption?: string;
}
```

In `buildEvidenceManifest`, change the `lines` map to append the caption:

```ts
  const lines = attachable.map((i) => {
    const ts = i.timestampMs !== undefined ? ` at ${fmtTs(i.timestampMs)}` : "";
    const cap = i.caption && i.caption.trim() ? ` — "${i.caption.trim()}"` : "";
    return `- ${i.name} (${KIND_LABEL[i.kind]}${ts})${cap}`;
  });
```

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run lib/agent/evidence.test.ts`.

- [ ] **Step 5: Commit** — `git add web/lib/agent/evidence.ts web/lib/agent/evidence.test.ts && git commit -m "feat(agent): carry per-screenshot captions in the evidence manifest"`

## Task A2: SCREENSHOTS context block

**Files:** Modify `web/lib/agent/context-block.ts`; Test `web/lib/agent/context-block.test.ts`

- [ ] **Step 1: Add the failing test** — append to `context-block.test.ts`:

```ts
describe("buildContextBlock - screenshots", () => {
  it("surfaces screenshot captions as a labeled block", () => {
    const block = buildContextBlock({
      screenshots: [
        { file: "screenshots/a.png", description: "Total ignores the promo code" },
        { file: "screenshots/b.png", description: "" },
        { file: "screenshots/c.png", description: "Error toast on submit" },
      ],
    });
    expect(block).toContain("SCREENSHOTS");
    expect(block).toContain("Total ignores the promo code");
    expect(block).toContain("Error toast on submit");
  });

  it("omits the screenshots block when no caption has text", () => {
    const block = buildContextBlock({ screenshots: [{ file: "x.png", description: "" }] });
    expect(block).not.toContain("SCREENSHOTS");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run lib/agent/context-block.test.ts`.

- [ ] **Step 3: Implement** — in `context-block.ts`, before the `return block;`, add:

```ts
  // Per-screenshot notes the reporter typed in the popup — their intent for each
  // shot. Surface them so the agent reads them as ground-truth alongside the image.
  const shots: any[] = Array.isArray(j.screenshots) ? j.screenshots : [];
  const shotNotes = shots
    .map((s) => (typeof s?.description === "string" ? s.description.trim() : ""))
    .filter(Boolean);
  if (shotNotes.length) {
    block +=
      (block ? "\n\n" : "") +
      "SCREENSHOTS (the reporter's note on each flagged shot — treat as intent, corroborate against the image):\n" +
      [...new Set(shotNotes)].map((m) => `- ${m.slice(0, 500)}`).join("\n");
  }
```

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run lib/agent/context-block.test.ts`.

- [ ] **Step 5: Commit** — `git add web/lib/agent/context-block.ts web/lib/agent/context-block.test.ts && git commit -m "feat(agent): surface per-screenshot notes in the context block"`

## Task A3: Pure override-merge helpers

**Files:** Create `web/lib/agent/overrides.ts`; Test `web/lib/agent/overrides.test.ts`

- [ ] **Step 1: Write the failing test** — create `overrides.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeBriefOverrides, captionForScreenshot } from "./overrides";

describe("mergeBriefOverrides", () => {
  it("overlays a non-empty transcript, description, extra, and screenshots", () => {
    const json = { transcript: null, description: "old", events: [{ a: 1 }] };
    const merged = mergeBriefOverrides(json, {
      transcript: "corrected words",
      description: "new",
      extra: [{ key: "env", value: "prod" }],
      screenshots: [{ file: "screenshots/a.png", description: "note", annotated: true }],
    });
    expect(merged.transcript).toBe("corrected words");
    expect(merged.description).toBe("new");
    expect(merged.extra).toEqual([{ key: "env", value: "prod" }]);
    expect(merged.screenshots[0].description).toBe("note");
    expect((merged as any).events).toEqual([{ a: 1 }]); // untouched capture data
  });

  it("ignores absent/blank overrides and does not mutate the input", () => {
    const json = { transcript: "kept", description: "kept" };
    const merged = mergeBriefOverrides(json, { transcript: "   " });
    expect(merged.transcript).toBe("kept");
    expect(merged.description).toBe("kept");
    expect(json).toEqual({ transcript: "kept", description: "kept" });
  });

  it("treats null/garbage overrides as no-op", () => {
    expect(mergeBriefOverrides({ a: 1 }, undefined as any)).toEqual({ a: 1 });
    expect(mergeBriefOverrides({ a: 1 }, null as any)).toEqual({ a: 1 });
  });
});

describe("captionForScreenshot", () => {
  const shots = [
    { file: "screenshots/a.png", description: "first" },
    { file: "b.png", description: "second" },
  ];
  it("matches by basename in either direction", () => {
    expect(captionForScreenshot("screenshots/a.png", shots)).toBe("first");
    expect(captionForScreenshot("a.png", shots)).toBe("first");
    expect(captionForScreenshot("screenshots/b.png", shots)).toBe("second");
  });
  it("returns undefined when unmatched or no shots", () => {
    expect(captionForScreenshot("z.png", shots)).toBeUndefined();
    expect(captionForScreenshot("a.png", undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run lib/agent/overrides.test.ts` (module missing).

- [ ] **Step 3: Implement** — create `overrides.ts`:

```ts
// User-editable brief metadata supplied at FILE time (popup), authoritative over
// the capture-owned brief.json. Kept pure + unit-tested; run-processing applies it.

export interface ScreenshotMeta {
  file: string;
  description?: string;
  annotated?: boolean;
}
export interface BriefOverrides {
  title?: string;
  includeVideo?: boolean;
  transcript?: string;
  description?: string;
  extra?: Array<{ key: string; value: string }>;
  screenshots?: ScreenshotMeta[];
}

/** Overlay the user's latest edits onto parsed brief.json without mutating it.
 *  Only non-empty / present fields win; capture data (events, keyframes…) is kept. */
export function mergeBriefOverrides(json: unknown, overrides: BriefOverrides | null | undefined) {
  const base: Record<string, any> = json && typeof json === "object" ? { ...(json as object) } : {};
  if (!overrides || typeof overrides !== "object") return base;
  if (typeof overrides.transcript === "string" && overrides.transcript.trim()) base.transcript = overrides.transcript;
  if (typeof overrides.description === "string") base.description = overrides.description;
  if (Array.isArray(overrides.extra)) base.extra = overrides.extra;
  if (Array.isArray(overrides.screenshots)) base.screenshots = overrides.screenshots;
  return base;
}

const baseName = (p: string) => String(p ?? "").split("/").pop() || String(p ?? "");

/** Find a screenshot's caption by basename, tolerating dir prefixes on either side. */
export function captionForScreenshot(file: string, shots: ScreenshotMeta[] | undefined): string | undefined {
  if (!Array.isArray(shots)) return undefined;
  const want = baseName(file);
  const hit = shots.find((s) => baseName(s.file) === want);
  const d = hit?.description;
  return typeof d === "string" && d.trim() ? d.trim() : undefined;
}
```

- [ ] **Step 4: Run it, expect PASS** — `npx vitest run lib/agent/overrides.test.ts`.

- [ ] **Step 5: Commit** — `git add web/lib/agent/overrides.ts web/lib/agent/overrides.test.ts && git commit -m "feat(agent): pure brief-override merge + screenshot caption resolver"`

## Task A4: Process route accepts overrides

**Files:** Modify `web/app/api/briefs/[id]/process/route.ts`

- [ ] **Step 1: Parse overrides + pass through.** Replace the body-parsing block (the `const body = await req.json()…` line through `const includeVideo = …`) with:

```ts
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    includeVideo?: boolean;
    transcript?: string;
    description?: string;
    extra?: Array<{ key: string; value: string }>;
    screenshots?: Array<{ file: string; description?: string; annotated?: boolean }>;
  };
  const title = (body?.title ?? "").toString().trim();
  const includeVideo = body?.includeVideo === true;
  const overrides = {
    title: title || undefined,
    includeVideo,
    transcript: typeof body?.transcript === "string" ? body.transcript : undefined,
    description: typeof body?.description === "string" ? body.description : undefined,
    extra: Array.isArray(body?.extra) ? body.extra : undefined,
    screenshots: Array.isArray(body?.screenshots) ? body.screenshots : undefined,
  };
```

- [ ] **Step 2: Pass overrides to the run.** Change the `after(...)` body call from `{ includeVideo }` to `{ includeVideo, overrides }`:

```ts
  after(async () => {
    await processBriefById(userId, id, { includeVideo, overrides }).catch(() => {});
  });
```

- [ ] **Step 3: Verify it compiles** — `npx tsc --noEmit` (expect: no new errors here; `processBriefById`'s opts type is widened in Task A5 — if you run tsc before A5 it flags `overrides`; that's expected, fixed in A5).

- [ ] **Step 4: Commit (with A5)** — committed together with A5 since the types are coupled.

## Task A5: run-processing consumes overrides + multiple screenshots

**Files:** Modify `web/lib/agent/run-processing.ts`

- [ ] **Step 1: Imports + opts type.** Add the import near the top:

```ts
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides } from "./overrides";
```

Widen the function signature:

```ts
export async function processBriefById(
  userId: string,
  briefId: string,
  opts: { includeVideo?: boolean; overrides?: BriefOverrides } = {},
): Promise<ProcessResult> {
```

- [ ] **Step 2: Merge overrides + gate transcription.** Replace the transcript section (from `const briefJsonBuf = …` through `if (transcript) json.transcript = transcript;`) with:

```ts
    const briefJsonBuf = await dl(`${prefix}/brief.json`);
    const rawJson = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};
    // The popup's edits (corrected transcript, per-shot notes, description, extra)
    // are authoritative over the capture-owned brief.json.
    const json = mergeBriefOverrides(rawJson, opts.overrides);

    // Use the supplied (edited) transcript when present; only transcribe server-side
    // when the popup didn't give us one. Fail-soft as before.
    if (typeof json.transcript === "string" && json.transcript.trim()) {
      // already set by the merge — skip the OpenAI call
    } else {
      let audioInput: { bytes: Buffer; filename: string; contentType: string } | null = null;
      const audioBuf = await dl(`${prefix}/audio.webm`);
      if (audioBuf) {
        audioInput = { bytes: audioBuf, filename: "audio.webm", contentType: "audio/webm" };
      } else {
        const recBuf = await dl(`${prefix}/recording.webm`);
        if (recBuf && recBuf.length <= 25 * 1024 * 1024) {
          audioInput = { bytes: recBuf, filename: "recording.webm", contentType: "video/webm" };
        }
      }
      const transcript = await transcribeAudio(audioInput);
      if (transcript) json.transcript = transcript;
    }
```

- [ ] **Step 3: includeVideo respects the override.** The existing line `const includeVideo = opts.includeVideo ?? !!json.includeVideo;` stays — `opts.includeVideo` already flows from the route. No change.

- [ ] **Step 4: Collect ALL screenshots (multi + legacy).** Replace the single-screenshot block (the `const shot = await dl(\`${prefix}/screenshot.png\`); if (shot) { … }` block) with:

```ts
    // Screenshots: the popup uploads each as screenshots/<id>.png (multiple, each
    // with a user caption). Read them all; also accept a legacy top-level
    // screenshot.png. Each becomes a model image + attachable evidence with its
    // caption resolved from the (merged) brief.json screenshots[].
    const shotMeta = Array.isArray((json as any).screenshots) ? (json as any).screenshots : [];
    const shotPaths: string[] = [];
    const { data: shotList } = await admin.storage.from("briefs").list(`${prefix}/screenshots`, { limit: 200 });
    for (const o of shotList ?? []) shotPaths.push(`screenshots/${o.name}`);
    shotPaths.sort();
    if (await dl(`${prefix}/screenshot.png`)) shotPaths.push("screenshot.png"); // legacy single
    const shotFilenames: string[] = [];
    for (const rel of shotPaths) {
      const b = await dl(`${prefix}/${rel}`);
      if (!b) continue;
      const filename = rel.split("/").pop() || rel;
      const caption = captionForScreenshot(rel, shotMeta);
      images.push({ name: rel, dataUrl: `data:image/png;base64,${b.toString("base64")}` });
      files.push({ filename, contentType: "image/png", bytes: b });
      items.push({ name: filename, kind: "screenshot", caption });
      shotFilenames.push(filename);
    }
    const hasShot = shotFilenames.length > 0;
```

> Note: `images[].name` keeps the path (so keyframes vs screenshots stay distinguishable for the frame-count heuristic); `files[].filename`/`items[].name` use the basename to match the agent's `attach` selection and `pickEvidence`.

- [ ] **Step 5: Fallback + cleanup cover the new files.** Replace the `fallback` block's screenshot line and the `toDelete` array.

In the fallback block, change `if (shot) fallback.push("screenshot.png");` to:

```ts
    if (hasShot) fallback.push(shotFilenames[0]);
```

and change the `else if (!shot && frames.length)` condition to `else if (!hasShot && frames.length)`.

Update the log line's `screenshot=${!!shot}` to `screenshots=${shotFilenames.length}`.

Replace the `toDelete` line with one that also removes the screenshots dir:

```ts
    const toDelete: string[] = [
      `${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/audio.webm`, `${prefix}/screenshot.png`,
      ...shotPaths.map((p) => `${prefix}/${p}`),
      ...names.map((n) => `${prefix}/keyframes/${n}`),
    ];
```

- [ ] **Step 6: Compile + full web test run.**
Run: `npx tsc --noEmit` → expect clean.
Run: `npx vitest run` → expect all green (prior count + the new A1/A2/A3 cases).

- [ ] **Step 7: Build.** Run: `npx next build` → expect success.

- [ ] **Step 8: Commit** — `git add web/app/api/briefs/[id]/process/route.ts web/lib/agent/run-processing.ts && git commit -m "feat(agent): consume edited transcript + multiple captioned screenshots at file time"`

---

# Part B — Extension

No JS test harness exists here; the mechanical gate per task is `node --check <file>` and an end-of-part manual checklist. Keep edits ASCII-clean and dash-free per brand voice.

## Task B1: The single-draft model (`extension/draft.js`)

**Files:** Create `extension/draft.js`

- [ ] **Step 1: Write the module.**

```js
// Brief - the single current draft. One brief at a time: the popup composes it,
// the bar/offscreen finalize the recording onto it, and filing clears it.
//
// chrome.storage is available in popup/background/bar (extension pages) but NOT
// in the offscreen document - offscreen never imports this; it goes through
// background messaging instead.

const KEY = 'draft';

export function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyDraft() {
  return {
    id: genId(),
    name: '',
    screenshots: [],   // [{ id, dataUrl, annotated, description, pageUrl, pageTitle, addedAt }]
    recording: null,   // { recordedAt, durationMs } once a recording lands
    includeVideo: false,
    transcript: '',
    transcribing: false,
    transcriptFailed: false,
    description: '',
    extra: [],         // [{ key, value }]
    pageUrl: null,
    pageTitle: null,
    cloudBriefId: null,
    uploading: false,
    uploadFailed: false,
    uploadError: null,
    createdAt: Date.now(),
  };
}

export async function getDraft() {
  const { [KEY]: d } = await chrome.storage.local.get(KEY);
  return d && typeof d === 'object' ? d : null;
}
export async function setDraft(d) {
  await chrome.storage.local.set({ [KEY]: d });
  chrome.runtime.sendMessage({ type: 'DRAFT_CHANGED' }).catch(() => {});
}
export async function clearDraft() {
  await chrome.storage.local.remove(KEY);
  chrome.runtime.sendMessage({ type: 'DRAFT_CHANGED' }).catch(() => {});
}

// Read-modify-write guarded by id: async results (upload/transcript/shot) only
// apply when they still target the CURRENT draft (the user may have filed and
// started a fresh one while a background task was in flight). patch(d) mutates in
// place. Returns the saved draft, or null if the id no longer matches.
export async function updateDraft(briefId, patch) {
  const d = await getDraft();
  if (!d || (briefId && d.id !== briefId)) return null;
  patch(d);
  await setDraft(d);
  return d;
}

export function isReadyDraft(d) {
  if (!d) return false;
  return (Array.isArray(d.screenshots) && d.screenshots.length > 0) ||
    !!d.recording ||
    !!(d.description && d.description.trim());
}

// One-time migration off the legacy multi-brief `inbox` array. Adopt the single
// most-relevant entry (prefer one whose recording is still uploading), convert
// its single `screenshot` to the screenshots[] shape, drop the rest. Idempotent.
export async function migrateInboxToDraft() {
  const { inbox, [KEY]: existing } = await chrome.storage.local.get(['inbox', KEY]);
  if (existing) { if (inbox) await chrome.storage.local.remove('inbox'); return; }
  if (!Array.isArray(inbox) || inbox.length === 0) {
    if (inbox) await chrome.storage.local.remove('inbox');
    return;
  }
  const pick = inbox.find((b) => b && b.uploading) ||
    inbox.slice().sort((a, b) => (b?.recordedAt || b?.addedAt || 0) - (a?.recordedAt || a?.addedAt || 0))[0];
  const d = emptyDraft();
  if (pick) {
    d.id = pick.id || d.id;
    d.name = pick.name || '';
    d.description = pick.description || '';
    d.extra = Array.isArray(pick.extra) ? pick.extra : [];
    d.includeVideo = !!pick.includeVideo;
    d.pageUrl = pick.pageUrl || null;
    d.pageTitle = pick.pageTitle || null;
    d.cloudBriefId = pick.cloudBriefId || null;
    d.uploading = !!pick.uploading;
    d.uploadFailed = !!pick.uploadFailed;
    d.uploadError = pick.uploadError || null;
    if (pick.hasRecording || pick.recorded) d.recording = { recordedAt: pick.recordedAt || Date.now(), durationMs: 0 };
    if (pick.screenshot) {
      d.screenshots = [{
        id: genId(), dataUrl: pick.screenshot, annotated: !!pick.screenshotAnnotated,
        description: '', pageUrl: pick.pageUrl || null, pageTitle: pick.pageTitle || null, addedAt: Date.now(),
      }];
    }
  }
  await chrome.storage.local.set({ [KEY]: d });
  await chrome.storage.local.remove('inbox');
}
```

- [ ] **Step 2: Syntax check** — `node --check extension/draft.js` → no output = pass.

- [ ] **Step 3: Commit** — `git add extension/draft.js && git commit -m "feat(extension): single-draft storage model + inbox migration"`

## Task B2: Popup markup (`extension/popup.html`)

**Files:** Modify `extension/popup.html`

- [ ] **Step 1: Replace the `<main id="app">…</main>` block** with the single-brief composer. Keep the header brand + `briefCloudBtn` exactly as-is; replace everything from the `<form id="addForm">` through the `exportDone` overlay with:

```html
      <!-- The one brief -->
      <input id="briefName" class="brief-name" type="text" maxlength="80" placeholder="Name this brief…" spellcheck="false" />

      <!-- Capture -->
      <section class="cap">
        <div class="cap-label">Capture</div>
        <div class="cap-row">
          <button id="recordBtn" class="cap-action" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            <span>Record</span>
          </button>
          <button id="shotBtn" class="cap-action" type="button">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span>Screenshot</span>
          </button>
        </div>
      </section>

      <!-- Screenshots (rendered by popup.js) -->
      <section id="shotsSection" class="shots" hidden>
        <div class="sec-label">Screenshots <span id="shotsCount" class="sec-n">0</span></div>
        <div id="shotsList"></div>
        <button id="addShotBtn" class="add-shot" type="button">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add screenshot
        </button>
      </section>

      <!-- Recording + transcript (rendered by popup.js) -->
      <section id="recSection" class="rec" hidden></section>

      <!-- Details: description + custom fields -->
      <button id="detailsToggle" class="details-toggle" type="button">
        <span>Description &amp; fields</span>
        <svg class="chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <section id="detailsPanel" class="details" hidden></section>

      <!-- File it -->
      <button id="createTicket" class="export-btn">Create ticket</button>

      <!-- Success overlay (reused) -->
      <div id="exportDone" class="export-done" hidden>
        <div class="export-done-inner">
          <span class="export-done-check">✓</span>
          <p class="export-done-title">Queued</p>
          <p class="export-done-sub">Opening your tickets…</p>
        </div>
      </div>
```

- [ ] **Step 2: Sanity check** — open the file; confirm the `<header class="head">…</header>` and the `briefCloudBtn` are unchanged and the `<script type="module" src="popup.js">` tag remains.

- [ ] **Step 3: Commit** — `git add extension/popup.html && git commit -m "feat(extension): single-brief composer markup"`

## Task B3: Popup logic (`extension/popup.js`)

**Files:** Modify `extension/popup.js` (rewrite the inbox/list logic; keep the mic-probe bootstrap, `ensureContentScript`, inline-error helpers, `openTicketsTab`, `briefCloudBtn`, and `attachVoiceDictation` verbatim).

Implement these pieces (full code in the execution; key contracts below):

- [ ] **Step 1: Imports + draft state.** Import from `./draft.js`: `getDraft, setDraft, clearDraft, updateDraft, emptyDraft, isReadyDraft, migrateInboxToDraft, genId`. On boot: `await migrateInboxToDraft();` then `let draft = (await getDraft()) || emptyDraft();` and `await setDraft(draft)` if it was freshly created. Drop all `inbox`/`recBadge`/`exportBtn`/`addForm`/accordion code.

- [ ] **Step 2: `render()`** — the single source of truth, called on boot, after capture signals, and from `storage.onChanged`. It:
  - sets `briefName.value = draft.name`;
  - renders `#shotsList` from `draft.screenshots` (Step 3);
  - renders `#recSection` from `draft.recording`/`transcribing`/`transcript`/`uploading`/`uploadFailed` (Step 4);
  - renders `#detailsPanel` (description textarea + voice mic + key/value rows) lazily on first open;
  - toggles `#createTicket` enabled/label (Step 6).
  - Persist edits via small debounced writers (`name` on input, screenshot caption on input, description on input) that call `updateDraft(draft.id, …)` and refresh `draft`.

- [ ] **Step 3: Screenshot cards.** For each `s` in `draft.screenshots`, build a card: `<img>` thumbnail (`s.dataUrl`), a caption `<textarea class="shot-desc" placeholder="Add a note for this shot…">` bound to `s.description` (debounced persist), and a remove `×` that splices it out (`updateDraft` + re-render). Show `#shotsSection` only when `screenshots.length > 0`; set `#shotsCount`. `#addShotBtn` and the Capture `Screenshot` button both call `takeScreenshot()`.

- [ ] **Step 4: Recording + transcript block.** Show `#recSection` only when `draft.recording`. Inside:
  - a header row: ✦/dot + `recording` + a state chip — `Uploading…` (spinning ✦, when `draft.uploading`), `Upload failed` (red, click to re-record, when `draft.uploadFailed`), else `Uploaded ✓`.
  - an `Attach video to ticket` checkbox bound to `draft.includeVideo`.
  - a transcript sub-block: when `draft.transcribing` show a `Transcribing…` shimmer; when `draft.transcript` show it in an editable `<textarea class="tr-text">` (persist on input/blur via `updateDraft`); when `draft.transcriptFailed` and empty, show a muted `No speech detected`.

- [ ] **Step 5: `takeScreenshot()` and `recordBrief()`** — adapt the existing `screenshotForItem`/`recordForItem` bodies to use `draft.id` as the item id (they already message `START_SHOT {itemId}` / `INJECT_BAR {itemId}` and close the popup). Recording still requires a cloud token first (unchanged gating).

- [ ] **Step 6: `updateCreateButton()`** — enabled when `isReadyDraft(draft)` and not `draft.uploading`; label `Uploading…` (disabled) when `draft.uploading`; else `Create ticket`. No multi-count label ever.

- [ ] **Step 7: `createTicket` click → `fileBrief()`** — replaces `bcCreateTicket`. For the single draft:
  1. token check (open `/connect` if missing); tracker pre-flight (`bcTracker === null` → inline error), as today.
  2. Build `screenshots` files: `draft.screenshots.map((s) => ({ name: \`screenshots/${s.id}.png\`, blob: new Blob([dataUrlToBytes(s.dataUrl)], { type: 'image/png' }), contentType: 'image/png' }))`.
  3. If `!draft.cloudBriefId`: `uploadDraft([briefJsonFile, ...screenshotFiles], meta)` → set `draft.cloudBriefId` (persist). Else (recording draft): `if (screenshotFiles.length) await uploadFilesToDraft(draft.cloudBriefId, screenshotFiles)` (idempotent upsert).
  4. `await processBrief(draft.cloudBriefId, buildOverrides(draft))`.
  5. On success: `await clearDraft();` show the success overlay; `openTicketsTab()` after the existing ~1.6s delay. Keep the 404-self-heal (re-upload under current account) from the old loop, adapted to the single draft.
  - `meta` = `{ title: draft.name, description: draft.description, pageUrl: draft.pageUrl, pageTitle: draft.pageTitle, hasScreenshot: draft.screenshots.length > 0, keyframeCount: 0 }`.
  - `buildOverrides(draft)` = `{ title: draft.name, includeVideo: draft.includeVideo, transcript: draft.transcript, description: draft.description, extra: draft.extra.filter(p => p.key.trim() || p.value.trim()), screenshots: draft.screenshots.map(s => ({ file: \`screenshots/${s.id}.png\`, description: s.description, annotated: s.annotated })) }`.
  - The `brief.json` file built here mirrors today's `bcBuildFilesAndMeta` but with `screenshots: buildOverrides().screenshots` instead of a single `hasScreenshot`, and `transcript: draft.transcript || ''`.

- [ ] **Step 8: `storage.onChanged`** — replace the inbox-signature listener with: on `area==='local' && changes.draft`, re-read `draft` and `render()`, UNLESS a local guard (`filing`/`suppressUntil`) is set (keep the existing suppression pattern so the popup's own debounced writes don't fight the render — guard on a content signature of `uploading|uploadFailed|cloudBriefId|transcribing|transcript.length|screenshots.length`).

- [ ] **Step 9: `node --check extension/popup.js`** → pass.

- [ ] **Step 10: Commit** — `git add extension/popup.html extension/popup.js && git commit -m "feat(extension): rewrite popup as a single-brief composer with screenshot gallery + transcript"`

## Task B4: Popup styles (`extension/popup.css`)

**Files:** Modify `extension/popup.css`

- [ ] **Step 1: Add styles** for the new classes, reusing the existing tokens/vars already in the file (cream/ink/accent/hairline, JetBrains Mono, Instrument Serif). Add: `.brief-name` (Instrument Serif, ~25px, bottom hairline), `.cap`/`.cap-label`/`.cap-row`/`.cap-action` (two dashed equal buttons), `.shots`/`.sec-label`/`.sec-n`/`.shot-card`/`.shot-thumb`/`.shot-desc`/`.shot-x`/`.add-shot`, `.rec`/`.rec-head`/`.rec-dot`/`.rec-chip`(+`.up`/`.failed`)/`.rec-attach`/`.tr`/`.tr-head`/`.tr-text`/`.tr-shimmer`, `.details-toggle`(+`.open` rotates `.chev`)/`.details`. Keep `.export-btn`, `.export-done`, `.err-bar`, `.desc-mic*` rules intact. Match the mockup proportions in `.superpowers/brainstorm/826-1782140150/content/composer-design-v2.html`.

- [ ] **Step 2: Remove** dead rules for `.brief-list`, `.brief-item`, `.brief-row`, `.brief-actions`, accordion `.expanded`/`.animating`, `.rec-badge`, `.add-row` (safe to delete — no longer referenced).

- [ ] **Step 3: Commit** — `git add extension/popup.css && git commit -m "style(extension): single-brief composer styles"`

## Task B5: Background — draft-based broker (`extension/background.js`)

**Files:** Modify `extension/background.js`

- [ ] **Step 1: Import + migrate.** Add `import { getDraft, updateDraft, isReadyDraft, migrateInboxToDraft } from "./draft.js";`. Call `migrateInboxToDraft().catch(()=>{})` in `onInstalled` and once at top-level (worker startup).

- [ ] **Step 2: `refreshBadge()`** — read the draft, not inbox:

```js
async function refreshBadge() {
  try {
    const d = await getDraft();
    let text = '';
    if (d?.uploadFailed) text = '!';
    else if (d && (isReadyDraft(d) || d.uploading)) text = '•'; // dot
    chrome.action.setBadgeText({ text });
    if (text) {
      chrome.action.setBadgeBackgroundColor({ color: '#dd6936' });
      chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (err) { console.warn('[brief/background] badge refresh:', err); }
}
```

- [ ] **Step 3: `START_SHOT`** — capture as today, but pin page context to a local var and pass it into `INJECT_SHOT` (don't write the draft here):

```js
            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
            try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch {}
            await chrome.tabs.sendMessage(tab.id, {
              type: 'INJECT_SHOT', itemId: message.itemId, dataUrl,
              pageUrl: tab.url || null, pageTitle: tab.title || null,
            });
```

- [ ] **Step 4: `SHOT_SAVED`** — append to `draft.screenshots` (id-matched), set brief-level page context if absent:

```js
        case 'SHOT_SAVED': {
          try {
            await updateDraft(message.itemId, (d) => {
              d.screenshots.push({
                id: (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
                dataUrl: message.dataUrl, annotated: !!message.annotated,
                description: '', pageUrl: message.pageUrl || null, pageTitle: message.pageTitle || null,
                addedAt: Date.now(),
              });
              if (!d.pageUrl) { d.pageUrl = message.pageUrl || null; d.pageTitle = message.pageTitle || null; }
            });
            await refreshBadge();
            sendResponse({ ok: true });
            tryOpenPopup(message.itemId);
          } catch (err) { sendResponse({ ok: false, error: String(err?.message || err) }); }
          break;
        }
```

- [ ] **Step 5: `UPLOAD_RESULT`** — write the draft (id-matched):

```js
        case 'UPLOAD_RESULT': {
          try {
            await updateDraft(message.briefId, (d) => {
              d.uploading = false;
              if (message.cloudBriefId) { d.cloudBriefId = message.cloudBriefId; d.uploadFailed = false; d.uploadError = null; }
              else { d.uploadFailed = true; d.uploadError = message.error || 'upload failed'; }
            });
            await refreshBadge();
            sendResponse({ ok: true });
          } catch (err) { sendResponse({ ok: false, error: String(err?.message || err) }); }
          break;
        }
```

- [ ] **Step 6: `TRANSCRIPT_RESULT` (new case)**:

```js
        case 'TRANSCRIPT_RESULT': {
          try {
            await updateDraft(message.briefId, (d) => {
              d.transcribing = false;
              if (typeof message.transcript === 'string' && message.transcript.trim()) {
                d.transcript = message.transcript.trim(); d.transcriptFailed = false;
              } else if (message.error) {
                d.transcriptFailed = true;
              } // empty + no error = genuinely no speech; leave transcript ''
            });
            sendResponse({ ok: true });
          } catch (err) { sendResponse({ ok: false, error: String(err?.message || err) }); }
          break;
        }
```

- [ ] **Step 7: `GET_UPLOAD_CONTEXT`** — return the draft as `entry`:

```js
            const { briefCloudToken } = await chrome.storage.local.get('briefCloudToken');
            const draft = await getDraft();
            const entry = draft && draft.id === message.briefId ? draft : null;
            sendResponse({ token: briefCloudToken || null, entry, meta: { events: STATE.events.slice(), pageUrl: STATE.activeTabAtStart?.url || null, pageTitle: STATE.activeTabAtStart?.title || null } });
```

- [ ] **Step 8: `INBOX_CHANGED`/`DRAFT_CHANGED`** — accept both (alias) so older bar messages still refresh the badge: in the `INBOX_CHANGED` case label add `case 'DRAFT_CHANGED':` and keep `await refreshBadge();`.

- [ ] **Step 9: `node --check extension/background.js`** → pass.

- [ ] **Step 10: Commit** — `git add extension/background.js && git commit -m "feat(extension): background brokers the single draft (shots append, transcript, badge)"`

## Task B6: Offscreen — drop single-shot, add transcription (`extension/offscreen.js`)

**Files:** Modify `extension/offscreen.js`

- [ ] **Step 1: Import transcribe.** Change the import to `import { uploadDraft, transcribeNote } from './cloud.js';`.

- [ ] **Step 2: brief.json screenshots metadata; drop the single screenshot upload.** In `uploadAndFinish`, set `transcript: null` as today and add `screenshots:` from the draft entry (metadata only — the popup uploads the actual images at file time):

```js
    screenshots: Array.isArray(entry?.screenshots)
      ? entry.screenshots.map((s) => ({ file: `screenshots/${s.id}.png`, description: s.description || '', annotated: !!s.annotated }))
      : [],
```

Delete the `if (entry?.screenshot) { … files.push('screenshot.png' …) }` block (the popup now owns screenshot upload; this avoids divergence). Leave keyframes/recording/audio uploads unchanged. `cloudMeta.hasScreenshot` → `(entry?.screenshots?.length || 0) > 0`.

- [ ] **Step 3: Transcribe after upload, before OFFSCREEN_DONE.** After the successful `UPLOAD_RESULT` send (inside the `try`, after `chrome.runtime.sendMessage({ type:'UPLOAD_RESULT', … })`), add:

```js
    // Transcribe the audio-only track now so the popup can show + let the user
    // correct the narration immediately. Independent of the upload result; the
    // server still transcribes at file time if we send nothing.
    try {
      if (audioBlob && audioBlob.size && token) {
        const text = await transcribeNote(audioBlob, token);
        await chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId, transcript: text || '' }).catch(() => {});
      } else {
        await chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId, transcript: '' }).catch(() => {});
      }
    } catch (err) {
      await chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId, error: String(err?.message || err) }).catch(() => {});
    }
```

(Keep the existing `catch`/`finally` that sends `OFFSCREEN_DONE` — it now fires after transcription, so background keeps the doc alive through it. The `UPLOAD_RESULT` for the failure path stays in the `catch`.)

- [ ] **Step 4: `node --check extension/offscreen.js`** → pass.

- [ ] **Step 5: Commit** — `git add extension/offscreen.js && git commit -m "feat(extension): transcribe audio after recording upload; drop single-screenshot bundling"`

## Task B7: Bar finalize + content passthrough + cloud signature

**Files:** Modify `extension/bar.js`, `extension/content.js`, `extension/cloud.js`

- [ ] **Step 1: `bar.js` — write the draft on stop.** Add `import { updateDraft, getDraft, setDraft, emptyDraft } from './draft.js';` at the top. Replace `finishToInbox`'s storage write with a draft write (recording landed, upload + transcription pending):

```js
async function finishToInbox(id, intent, cloudBriefId, opts = {}) {
  try {
    let d = await getDraft();
    if (!d) { d = emptyDraft(); d.id = id; }
    if (d.id === id) {
      d.recording = { recordedAt: Date.now(), durationMs: 0 };
      if (cloudBriefId) d.cloudBriefId = cloudBriefId;
      if (opts.uploading) { d.uploading = true; d.uploadFailed = false; d.uploadError = null; d.transcribing = true; }
      await setDraft(d);
    }
    chrome.runtime.sendMessage({ type: 'REOPEN_POPUP', briefId: id }).catch(() => {});
  } catch (err) { console.warn('[brief/bar] draft write failed:', err); }
  closeParent();
}
```

- [ ] **Step 2: `content.js` — carry page context through the overlay.** In `injectShot(itemId, dataUrl)` add `pageUrl`/`pageTitle` params stored on closure vars; in the `INJECT_SHOT` handler pass `message.pageUrl, message.pageTitle`; in `onShotMessage`'s `save` branch include them in the `SHOT_SAVED` message:

```js
      chrome.runtime.sendMessage({
        type: 'SHOT_SAVED', itemId: m.itemId, dataUrl: m.dataUrl, annotated: !!m.annotated,
        pageUrl: shotPageUrl, pageTitle: shotPageTitle,
      }).catch(() => {});
```

(Declare `let shotPageUrl = '', shotPageTitle = '';` alongside `shotImg`; set them in `injectShot`.)

- [ ] **Step 3: `cloud.js` — overrides signature.** Replace `processBrief(briefId, title, includeVideo)` with:

```js
export async function processBrief(briefId, overrides = {}) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetch(`${APP_URL}/api/briefs/${briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(overrides || {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.message || body?.error || `process failed: ${res.status}`);
    err.code = body?.error === "no_tracker" || res.status === 409 ? "no_tracker" : "process_failed";
    err.status = res.status;
    throw err;
  }
}
```

- [ ] **Step 4: Syntax check** — `node --check extension/bar.js && node --check extension/content.js && node --check extension/cloud.js` → pass.

- [ ] **Step 5: Commit** — `git add extension/bar.js extension/content.js extension/cloud.js && git commit -m "feat(extension): bar finalizes the draft; screenshots carry page context; processBrief takes overrides"`

## Task B8: Full-extension syntax sweep + manifest sanity

- [ ] **Step 1:** `node --check` every touched JS: `for f in draft popup background offscreen bar content cloud; do node --check extension/$f.js || echo "FAIL $f"; done` → no FAIL lines.
- [ ] **Step 2:** Confirm `extension/manifest.json` still parses (`node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8'))"`) and that `draft.js` needs no manifest entry (it's imported, not a content script / not web-accessible).
- [ ] **Step 3:** No commit (verification only).

---

## Manual verification checklist (load unpacked in Chrome; no automated harness)

- [ ] **Migration:** with an old `inbox` present, open the popup → exactly one brief shown; `inbox` key gone, `draft` present.
- [ ] **Fresh → text-only:** open, name it, type a Description, Create ticket → ticket filed; popup resets to empty.
- [ ] **Screenshots:** add 2 screenshots, give each a different note → both thumbnails + notes persist across popup close/reopen; file → the ticket reflects both notes (check the filed Linear/Jira issue).
- [ ] **Recording + transcript:** record ~15s of speech → popup reopens showing the recording uploaded and "Transcribing…", then the transcript appears; edit it; file → the edited wording informs the ticket (server did NOT re-transcribe — check logs show the supplied transcript path).
- [ ] **Record + screenshots together:** record, then add a screenshot after stop, file → ticket has the recording's keyframes + the screenshot with its note.
- [ ] **Upload-failure path:** (simulate offline at stop) → record button/chip shows failed; re-record works.
- [ ] **Gating:** Create ticket is disabled with "Uploading…" until the recording's cloud id lands.

---

## Self-Review

**Spec coverage:** (1) one brief at a time → B1–B5 (draft model, composer, badge); (2) multiple captioned screenshots → A1/A2/A5 (server) + B2/B3/B4 (UI) + B5 (append) + B6 (metadata); (3) transcript visible+editable → B6 (transcribe), B5 (`TRANSCRIPT_RESULT`), B3 (render/edit), A4/A5 (override consumed). No-filler-copy rule honored in B2 markup. Migration → B1. Server back-compat (legacy `screenshot.png`, no overrides) → A5.

**Placeholders:** none — every step has concrete code or an exact command. (popup.js Step 3 specifies contracts + the non-obvious code; the render/persist boilerplate is conventional DOM from the existing file.)

**Type/name consistency:** `draft` shape identical across draft.js/popup/background/bar; message types `SHOT_SAVED`(+pageUrl/pageTitle), `UPLOAD_RESULT`, `TRANSCRIPT_RESULT`, `GET_UPLOAD_CONTEXT`, `DRAFT_CHANGED` consistent; screenshot storage path `screenshots/<id>.png` consistent across popup upload (B3), offscreen metadata (B6), and run-processing collection (A5); `processBrief(briefId, overrides)` matches cloud.js (B7) ↔ route (A4) ↔ overrides type (A3).
