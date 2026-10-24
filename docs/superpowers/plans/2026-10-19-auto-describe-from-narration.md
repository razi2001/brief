# Auto-describe from narration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a recording has narration, the popup's "Describe the brief…" field fills itself with a short AI summary of what was said, and anything the reporter types always wins.

**Architecture:** `/api/transcribe?describe=1` transcribes, then runs one fast-model call (`describeNarration`) and returns `{ text, description }`. The offscreen document asks for it in parallel with the upload and forwards `description` in `TRANSCRIPT_RESULT`; the worker lands it on the draft through a pure `applyAutoDescription` that only fills an empty or still-AI description (`draft.descriptionAuto`). The popup shows a "Writing…" shimmer while it waits and copies the result into the field live unless the reporter is in it.

**Tech Stack:** Next.js 16 route + `openai` SDK chat completions (vitest), Chrome MV3 extension ES modules (node:test, Chrome for Testing e2e over CDP).

Spec: `docs/superpowers/specs/2026-10-19-auto-describe-from-narration-design.md`.

---

## File map

| File | Change |
|---|---|
| `web/lib/agent/describe-narration.ts` | NEW: `describeNarration`, `cleanDescription`, `DESCRIBE_SYSTEM` |
| `web/lib/agent/describe-narration.test.ts` | NEW: unit tests |
| `web/app/api/transcribe/route.ts` | `?describe=1` adds `description` |
| `web/app/api/transcribe/route.test.ts` | NEW: route tests |
| `extension/draft.js` | `descriptionAuto`, `applyAutoDescription`, `clearAutoDescription`, `landRecording` clears auto text |
| `extension/test/auto-description.test.mjs` | NEW: node tests for the draft helpers |
| `extension/cloud.js` | `transcribeRecording` (shares a helper with `transcribeNote`) |
| `extension/offscreen.js` | transcription starts with the upload; `description` in `TRANSCRIPT_RESULT` |
| `extension/background.js` | `TRANSCRIPT_RESULT` calls `applyAutoDescription` |
| `extension/popup.js` | edits clear `descriptionAuto`; writing state; live sync; recording removal clears auto text |
| `extension/popup.css` | `.ai-wrap.writing` shimmer |
| `extension/test/e2e/upload-race.suite.mjs` | mock matches `?describe=1`; asserts the description |
| `extension/test/e2e/auto-describe.suite.mjs` | NEW: popup writing state, live fill, user text wins |
| `extension/test/e2e/README.md` | list the new suite |

Commands (from the worktree root):
- web tests: `cd web && npx vitest run <file>`; typecheck `cd web && npx tsc --noEmit`
- extension unit: `node --test extension/test/*.test.mjs`
- extension syntax: copy to `.mjs` then `node --check` (plain `node --check x.js` misses ES module errors)
- e2e: `CHROME_PATH=<cft chrome.exe> node extension/test/e2e/run.mjs <suite>`

---

### Task 1: `describeNarration` (server)

**Files:**
- Create: `web/lib/agent/describe-narration.ts`
- Test: `web/lib/agent/describe-narration.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { describeNarration, cleanDescription } from "./describe-narration";

const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe("cleanDescription", () => {
  it("strips wrapping quotes and markdown markers", () => {
    expect(cleanDescription('"**Pay** does nothing on checkout."')).toBe("Pay does nothing on checkout.");
    expect(cleanDescription("- The export button is greyed out.")).toBe("The export button is greyed out.");
    expect(cleanDescription("# Login fails")).toBe("Login fails");
  });

  it("turns em and en dashes into commas", () => {
    expect(cleanDescription("Pay spins forever — it never opens the confirmation page.")).toBe(
      "Pay spins forever, it never opens the confirmation page.",
    );
    expect(cleanDescription("Pay spins–forever")).toBe("Pay spins, forever");
  });

  it("collapses whitespace and newlines", () => {
    expect(cleanDescription("  Pay spins.\n\nIt should   finish.  ")).toBe("Pay spins. It should finish.");
  });

  it("caps long answers on a word boundary", () => {
    const out = cleanDescription("word ".repeat(400));
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith("word")).toBe(true);
  });

  it("maps NONE and empty answers to an empty string", () => {
    expect(cleanDescription("NONE")).toBe("");
    expect(cleanDescription(" none. ")).toBe("");
    expect(cleanDescription("   ")).toBe("");
  });
});

describe("describeNarration", () => {
  it("returns null without calling the model for an empty transcript", async () => {
    const create = vi.fn();
    expect(await describeNarration("   ", { create })).toBe(null);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the transcript and returns the cleaned description", async () => {
    const create = vi.fn().mockResolvedValue(reply('"Clicking Pay on checkout spins forever."'));
    const out = await describeNarration("ok so um I click pay and it spins forever", { create, model: "gpt-4o-mini" });
    expect(out).toBe("Clicking Pay on checkout spins forever.");
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("gpt-4o-mini");
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[1].content).toContain("I click pay and it spins forever");
  });

  it("caps a very long transcript before sending it", async () => {
    const create = vi.fn().mockResolvedValue(reply("Something broke."));
    await describeNarration("a".repeat(20000), { create });
    expect(create.mock.calls[0][0].messages[1].content.length).toBeLessThan(8200);
  });

  it("returns null when the model answers NONE", async () => {
    const create = vi.fn().mockResolvedValue(reply("NONE"));
    expect(await describeNarration("testing testing one two", { create })).toBe(null);
  });

  it("returns null (never throws) when the model errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await describeNarration("the page is blank", { create })).toBe(null);
  });

  it("sends reasoning_effort none to gpt-5.6 models", async () => {
    const create = vi.fn().mockResolvedValue(reply("Blank page."));
    await describeNarration("the page is blank", { create, model: "gpt-5.6-luna" });
    expect(create.mock.calls[0][0]).toMatchObject({ reasoning_effort: "none" });
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd web && npx vitest run lib/agent/describe-narration.test.ts`
Expected: FAIL, cannot resolve `./describe-narration`.

- [ ] **Step 3: Implement**

```ts
import OpenAI from "openai";
import { chatParams, fastModel } from "./model";

/**
 * The reporter talked over their recording; this turns what they said into the
 * text they would have typed in the popup's description field, so they only
 * have to check it. The filing agent still gets the full transcript.
 */
export const DESCRIBE_SYSTEM = `You write the description field of a bug report from the reporter's spoken narration.

The narration is a speech-to-text transcript of someone talking while they screen-record a problem or a request. Write what they would have typed:
- 1 to 3 short sentences of plain text.
- First what is wrong (or what they want) and where. Then what they expected, only if they said it.
- Use the language they spoke. Keep names, button labels, values and URLs exactly as said.
- Drop filler, false starts and repetition. Add nothing they did not say: no guesses, no causes, no severity.
- No markdown, no quotes, no headings, no dashes. Do not start with "The user".
If the narration says nothing about a problem or a request (silence, filler, a mic test), answer exactly: NONE`;

const TRANSCRIPT_MAX = 8000;
const DESCRIPTION_MAX = 600;

/** Tidy the model's answer into field text. "" when there is nothing to use. */
export function cleanDescription(raw: string): string {
  let s = String(raw ?? "").trim();
  if (/^none\.?$/i.test(s)) return "";
  s = s
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  if (s.length > DESCRIPTION_MAX) s = s.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, "");
  return s;
}

export interface DescribeDeps {
  /** Injectable for tests; defaults to a real chat completion. */
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  /** Override the model; defaults to fastModel(). */
  model?: string;
}

/**
 * Fail-soft by contract: the description, or null for an empty transcript, a
 * NONE answer, or ANY error. A missing description must never fail the call
 * that carries the transcript.
 */
export async function describeNarration(transcript: string, deps: DescribeDeps = {}): Promise<string | null> {
  const said = String(transcript ?? "").trim().slice(0, TRANSCRIPT_MAX);
  if (!said) return null;
  const model = deps.model || fastModel();
  const client = deps.create ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const create: (args: Record<string, unknown>) => Promise<unknown> =
    deps.create ||
    ((args) => {
      const c = client!;
      return c.chat.completions.create(args as unknown as Parameters<typeof c.chat.completions.create>[0]);
    });
  try {
    const res = (await create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: DESCRIBE_SYSTEM },
        { role: "user", content: `Narration:\n"""\n${said}\n"""` },
      ],
      ...chatParams(model),
    })) as { choices?: Array<{ message?: { content?: string | null } }> };
    return cleanDescription(res?.choices?.[0]?.message?.content ?? "") || null;
  } catch (err) {
    console.warn("[describe-narration] failed:", (err as { message?: string })?.message ?? err);
    return null;
  }
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd web && npx vitest run lib/agent/describe-narration.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/describe-narration.ts web/lib/agent/describe-narration.test.ts
git commit -m "Describe a brief from its narration (server helper)"
```

---

### Task 2: `/api/transcribe?describe=1`

**Files:**
- Modify: `web/app/api/transcribe/route.ts`
- Test: `web/app/api/transcribe/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/extauth", () => ({
  bearerFromHeader: (h: string | null) => (h?.startsWith("Bearer ") ? h.slice(7) : null),
  userIdForToken: async (token: string) => (token === "good" ? "user_1" : null),
}));
const heard = vi.hoisted(() => ({ current: "the pay button spins forever" as string | null }));
vi.mock("@/lib/agent/transcribe", () => ({ transcribeAudio: async () => heard.current }));
const describeNarration = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent/describe-narration", () => ({ describeNarration }));

import { POST } from "./route";

const post = (query = "", token = "good") =>
  POST(
    new NextRequest(`http://localhost/api/transcribe${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "audio/webm" },
      body: new Uint8Array([1, 2, 3]),
    }),
  );

beforeEach(() => {
  heard.current = "the pay button spins forever";
  describeNarration.mockReset().mockResolvedValue("Pay spins forever.");
});

describe("POST /api/transcribe", () => {
  it("401s without a known token", async () => {
    expect((await post("", "bad")).status).toBe(401);
  });

  it("returns only the text without describe (voice notes)", async () => {
    const body = await (await post()).json();
    expect(body).toEqual({ text: "the pay button spins forever" });
    expect(describeNarration).not.toHaveBeenCalled();
  });

  it("adds the description with describe=1", async () => {
    const body = await (await post("?describe=1")).json();
    expect(body).toEqual({ text: "the pay button spins forever", description: "Pay spins forever." });
    expect(describeNarration).toHaveBeenCalledWith("the pay button spins forever");
  });

  it("gives an empty description when there is none", async () => {
    describeNarration.mockResolvedValue(null);
    expect(await (await post("?describe=1")).json()).toEqual({ text: "the pay button spins forever", description: "" });
  });

  it("skips the summary when nothing was heard", async () => {
    heard.current = null;
    expect(await (await post("?describe=1")).json()).toEqual({ text: "", description: "" });
    expect(describeNarration).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd web && npx vitest run app/api/transcribe/route.test.ts`
Expected: "adds the description" and "empty description" FAIL (no `description` key).

- [ ] **Step 3: Implement** — in `route.ts`, import `describeNarration` and replace the tail:

```ts
import { describeNarration } from "@/lib/agent/describe-narration";
```

```ts
  const text = await transcribeAudio({ bytes: buf, filename: `note.${ext}`, contentType });
  // A recording's narration (describe=1) also gets the description the popup
  // pre-fills; voice notes typed straight into a field don't need one.
  if (req.nextUrl.searchParams.get("describe") !== "1") return jsonCors({ text: text || "" });
  const description = text ? await describeNarration(text) : null;
  return jsonCors({ text: text || "", description: description || "" });
```

Update the file's top comment to say recordings ask for a description too.

- [ ] **Step 4: Run it, expect pass**

Run: `cd web && npx vitest run app/api/transcribe/route.test.ts lib/agent/describe-narration.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/transcribe/route.ts web/app/api/transcribe/route.test.ts
git commit -m "Transcribe returns a description for recordings"
```

---

### Task 3: Draft helpers

**Files:**
- Modify: `extension/draft.js` (emptyDraft, landRecording, new exports)
- Test: `extension/test/auto-description.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run it, expect failure**

Run: `node --test extension/test/auto-description.test.mjs`
Expected: FAIL, `applyAutoDescription` is not exported.

- [ ] **Step 3: Implement** — in `extension/draft.js`:

In `emptyDraft()` after `description: '',` add:

```js
    // true while `description` is the AI's summary of the narration, untouched
    // by the reporter: only then may a newer summary replace it.
    descriptionAuto: false,
```

In `landRecording`, inside `if (uploading) { ... }` after `d.transcriptFailed = false;` add:

```js
    // An AI description summed up the old recording's narration.
    clearAutoDescription(d);
```

Add after `landRecording`:

```js
// The AI's description (from the narration) lands only in an empty field or
// over its own untouched text: what the reporter wrote always wins.
export function applyAutoDescription(d, text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return false;
  if ((d.description || '').trim() && !d.descriptionAuto) return false;
  d.description = t;
  d.descriptionAuto = true;
  return true;
}
export function clearAutoDescription(d) {
  if (!d.descriptionAuto) return;
  d.description = '';
  d.descriptionAuto = false;
}
```

- [ ] **Step 4: Run it, expect pass**

Run: `node --test extension/test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add extension/draft.js extension/test/auto-description.test.mjs
git commit -m "Draft knows when its description is the AI's"
```

---

### Task 4: Transcribe with a description, alongside the upload

**Files:**
- Modify: `extension/cloud.js:85-105`
- Modify: `extension/offscreen.js` (`uploadAndFinish`, ~lines 586-617)
- Modify: `extension/background.js` (`TRANSCRIPT_RESULT`, ~line 861; import line 7)

- [ ] **Step 1: cloud.js** — replace `transcribeNote` with a shared helper plus two exports:

```js
// Send audio to the cloud for transcription. `describe` also asks for the
// description the popup pre-fills (a recording's narration, summed up).
async function postTranscribe(blob, tokenOverride, describe) {
  const token = tokenOverride || (await getCloudToken());
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetchOrThrow(
    `${APP_URL}/api/transcribe${describe ? "?describe=1" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "audio/webm" },
      body: blob,
    },
    "transcribe",
  );
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}${await errorDetail(res)}`);
  return res.json().catch(() => ({}));
}

// Transcribe a short voice note (recorded in the popup) via the cloud - reuses
// the same model the brief-filing agent uses. Sends the audio as the raw body.
// Returns the recognized text (possibly empty); throws a labelled error on a
// network/auth/server failure so the caller can show a friendly hint.
export async function transcribeNote(blob, tokenOverride) {
  const body = await postTranscribe(blob, tokenOverride, false);
  return (body?.text || "").trim();
}

// A recording's narration: the transcript plus a short description written
// from it ("" when there was nothing to sum up). Throws like transcribeNote.
export async function transcribeRecording(blob, tokenOverride) {
  const body = await postTranscribe(blob, tokenOverride, true);
  return { transcript: (body?.text || "").trim(), description: (body?.description || "").trim() };
}
```

- [ ] **Step 2: offscreen.js** — import `transcribeRecording` instead of `transcribeNote`
(`import { uploadDraft, transcribeRecording } from './cloud.js';`). In `uploadAndFinish`, right after the `if (!token) throw new Error('Not connected to Brief Cloud');` line, start the transcription:

```js
    // Transcribe the audio now, alongside the upload, so the transcript and the
    // description the popup pre-fills don't wait for a big video to go up.
    // Independent of the upload result; the server still transcribes at file
    // time if we send nothing.
    const tBlob = transcribeBlob !== undefined ? transcribeBlob : audioBlob;
    const narration = (tBlob && tBlob.size
      ? transcribeRecording(tBlob, token)
      : Promise.resolve({ transcript: '', description: '' })
    ).then(
      (said) => said,
      (err) => { log('transcription failed:', err?.message || err); return { error: String(err?.message || err) }; },
    );
    const reportNarration = () => narration.then((said) => {
      if (current()) return chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId, ...said }).catch(() => {});
    });
```

Replace the old block that starts with the comment `// Transcribe the audio-only track now so the popup can show + let the user` and ends with the `TRANSCRIPT_RESULT` send with:

```js
    await reportNarration();
```

In the `catch (err)` of the same `try` (the upload failure path), after the `UPLOAD_RESULT` error send, add the narration too (it does not depend on the upload). The `narration` const lives inside the `try`, so declare `let reportNarration = null;` before the `try`, assign it inside (`reportNarration = () => ...`), and in the catch:

```js
    if (reportNarration) await reportNarration();
```

Note the `if (!current()) return;` at the top of that catch stays: a superseded upload reports nothing.

- [ ] **Step 3: background.js** — import `applyAutoDescription` from `./draft.js` (add to the existing import on line 7). In `TRANSCRIPT_RESULT`, inside the `updateDraft` callback after the transcript branches add:

```js
              // The narration summed up for the description field, unless the
              // reporter already wrote there.
              applyAutoDescription(d, message.description);
```

Update the case's comment: "Land it (and the description written from it) on the draft".

- [ ] **Step 4: Syntax check**

Run (bash): `for f in cloud offscreen background draft; do cp extension/$f.js "$TMP/$f.mjs"; node --check "$TMP/$f.mjs" || echo "FAIL $f"; done` with `TMP` the session scratchpad.
Expected: no FAIL lines.

- [ ] **Step 5: Commit**

```bash
git add extension/cloud.js extension/offscreen.js extension/background.js
git commit -m "Recording narration comes back with a description"
```

---

### Task 5: Popup

**Files:**
- Modify: `extension/popup.js` (import line 9, `sig`, `render`, additional-data section ~239-266, gallery removal ~1239, storage listener ~1337)
- Modify: `extension/popup.css` (after `.ai-field::-webkit-scrollbar-thumb:hover`, ~line 248)

- [ ] **Step 1: Import** `clearAutoDescription` from `./draft.js` on line 9.

- [ ] **Step 2: `sig()`** — add after the transcript entries:

```js
    d.descriptionAuto ? (d.description || '') : '',
```

(Only the AI's text: a reporter's own typing must not rebuild the popup on every save.)

- [ ] **Step 3: Additional data** — replace `syncAdditionalData` and `initAdditionalData` with:

```js
// What the field last showed from storage: a background change (the AI's
// description) only replaces it while the reporter has nothing unsaved in it.
let shownDesc = '';
function syncAdditionalData() {
  descField.value = draft.description || '';
  shownDesc = descField.value;
  renderKvRows();
  renderDescState();
}
// The AI's description arrived (or was cleared) in the background: show it,
// unless the reporter is in the field or has typed something unsaved.
function syncDescriptionFromDraft() {
  const stored = draft.description || '';
  if (stored === shownDesc || document.activeElement === descField || descField.value !== shownDesc) return;
  descField.value = stored;
  shownDesc = stored;
  renderDescState();
}
// While a narrated recording is being transcribed, the empty field says the
// description is on its way. It stays editable: typing takes over.
function renderDescState() {
  const writing = !!draft.transcribing && !!draft.recording && !descField.value.trim() && !(draft.description || '').trim();
  descWrap.classList.toggle('writing', writing);
  descField.placeholder = writing ? 'Writing…' : 'Describe the brief…';
}
function initAdditionalData() {
  const persistDesc = () => {
    const value = descField.value;
    shownDesc = value;
    // Any change of the reporter's own makes the text theirs: no AI summary
    // replaces it after this.
    return persist((d) => { if (d.description !== value) d.descriptionAuto = false; d.description = value; }).then(updateCreate);
  };
  let dt = null;
  descField.addEventListener('input', () => { renderDescState(); clearTimeout(dt); dt = setTimeout(persistDesc, 250); });
  descField.addEventListener('blur', () => { clearTimeout(dt); persistDesc(); });
  attachVoiceDictation(descField, descWrap, persistDesc);
  kvList.addEventListener('input', persistKv);
  kvList.addEventListener('click', (e) => { const fx = e.target.closest('.fx'); if (fx) { fx.closest('.sheet-field').remove(); persistKv(); } });
  syncAdditionalData();
}
```

- [ ] **Step 4: `render()`** — add `renderDescState();` after `updateCreate();`.

- [ ] **Step 5: Recording removal** (gallery click, `id === 'rec'`): prefix the patch with `clearAutoDescription(d);`:

```js
      await persist((d) => { clearAutoDescription(d); d.recording = null; d.cloudBriefId = null; d.transcript = ''; d.transcribing = false; d.transcriptFailed = false; d.includeVideo = false; });
```

and after the branch chain, where it calls `renderGallery(); updateCreate(); lastSig = sig(draft);`, add `syncDescriptionFromDraft(); renderDescState();` before `lastSig`.

- [ ] **Step 6: Storage listener** — replace `if (fresh) syncAdditionalData();` with:

```js
    if (fresh) syncAdditionalData();
    else syncDescriptionFromDraft();
```

- [ ] **Step 7: CSS** — add to `popup.css` after the scrollbar rules:

```css
/* writing: the description is being written from the narration - a shimmer over the (still editable) field */
.ai-wrap.writing::after { content:''; position:absolute; inset:0; border-radius:16px; pointer-events:none;
  background:linear-gradient(100deg, transparent 30%, rgba(221,105,54,.10) 50%, transparent 70%) no-repeat;
  background-size:200% 100%; animation:desc-shimmer 1.5s ease-in-out infinite; }
.ai-wrap.writing:focus-within::after { display:none; }
@keyframes desc-shimmer { from { background-position:150% 0; } to { background-position:-50% 0; } }
```

- [ ] **Step 8: Syntax check** popup.js as `.mjs` (same loop as Task 4 step 4 with `popup`).

- [ ] **Step 9: Commit**

```bash
git add extension/popup.js extension/popup.css
git commit -m "Popup fills the description from the narration"
```

---

### Task 6: End-to-end checks

**Files:**
- Modify: `extension/test/e2e/upload-race.suite.mjs`
- Create: `extension/test/e2e/auto-describe.suite.mjs`
- Modify: `extension/test/e2e/README.md`

- [ ] **Step 1: upload-race** — transcription now starts with each upload, so the mock can no longer tell the takes apart by what is held. Answer by order (first transcribe call = original, second = trimmed) and match the query string:

```js
  let transcribes = 0;
```

next to `let briefs = 0;`, and replace the transcribe line in `answer` with:

```js
    // what each upload's narration says: transcription starts with the upload,
    // so the first call is the original take and the second the trimmed one
    if (/\/api\/transcribe(\?|$)/.test(url)) {
      const first = transcribes++ === 0;
      return reply(sid, p.requestId, first
        ? { text: 'the whole original take', description: 'About the whole original take.' }
        : { text: 'the trimmed take', description: 'About the trimmed take.' });
    }
```

Change the wait `calls.filter((c) => c.url.endsWith('/api/transcribe'))` to `calls.filter((c) => /\/api\/transcribe(\?|$)/.test(c.url))`, and after the "nor its narration" check add:

```js
  check('and the description is written from the trimmed take', d.description === 'About the trimmed take.' && d.descriptionAuto === true, JSON.stringify({ description: d.description }));
```

Reset `transcribes = 0;` where the second scenario resets `briefs = 0;`.

- [ ] **Step 2: auto-describe suite** — popup states over a seeded draft (the offscreen path is covered by upload-race). Follow `popup-status.suite.mjs` for the harness pieces (`W`, `open`, `evalIn`, `check`, `sleep`, `SCRATCH`, Fetch interception answering `/api/me`):

```js
  // ---- the description written from a recording's narration ----
  const APP = 'https://cloud.get-brief.app';
  const shot = async (sid, name) => fs.writeFileSync(`${SCRATCH}/${name}`, Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sid)).data, 'base64'));
  const answer = (sid, p) => b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(p.request.url.endsWith('/api/me') ? { ok: true, tracker: 'linear', trackerName: 'Linear' } : { ok: true })).toString('base64') }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }] }, sid).catch(() => {}).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const seed = (extra = {}) => W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test', bcTrackerCache: { tracker: 'linear' }, micGrantedAt: Date.now(),
    draft: ${JSON.stringify({ id: 'd-desc', createdAt: 0, screenshots: [], description: '', descriptionAuto: false, includeVideo: true,
      recording: { recordedAt: 0, durationMs: 12000, poster: null, source: 'capture' }, uploading: false, transcribing: true, cloudBriefId: 'b-1', transcript: '' })}
  }).then(() => chrome.storage.local.get('draft')).then(({ draft }) => chrome.storage.local.set({ draft: { ...draft, ...${JSON.stringify(extra)} } }))`);
  const field = (sid) => evalIn(sid, `(() => { const f = document.querySelector('#descField'); return { value: f.value, placeholder: f.placeholder, writing: document.querySelector('#descWrap').classList.contains('writing') }; })()`);
  // what the worker does with the narration (offscreen sends this after transcribing)
  const narrate = (sid, description) => evalIn(sid, `chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', briefId: 'd-desc', transcript: 'ok so the pay button spins forever', description: ${JSON.stringify(description)} })`);

  await seed();
  const P = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  const f1 = await field(P.sid);
  check('while the narration is transcribed, the empty field says it is writing', f1.writing && f1.placeholder === 'Writing…' && f1.value === '', JSON.stringify(f1));
  await shot(P.sid, 'desc-writing.png');
  await narrate(P.sid, 'Clicking Pay on checkout spins forever.'); await sleep(800);
  const f2 = await field(P.sid);
  check('the description fills itself from the narration', f2.value === 'Clicking Pay on checkout spins forever.' && !f2.writing && f2.placeholder === 'Describe the brief…', JSON.stringify(f2));
  await shot(P.sid, 'desc-filled.png');
  const d2 = await W(`chrome.storage.local.get('draft').then((r) => r.draft)`);
  check('and is marked as the AI\'s', d2.descriptionAuto === true, JSON.stringify(d2.descriptionAuto));

  // the reporter edits it: it is theirs now, a later summary leaves it alone
  await evalIn(P.sid, `(() => { const f = document.querySelector('#descField'); f.focus(); f.value = 'Pay spins forever on checkout, card 4242.'; f.dispatchEvent(new Event('input')); f.blur(); })()`);
  await sleep(600);
  await narrate(P.sid, 'A newer summary.'); await sleep(800);
  const f3 = await field(P.sid);
  const d3 = await W(`chrome.storage.local.get('draft').then((r) => r.draft)`);
  check('what the reporter wrote is never replaced', f3.value === 'Pay spins forever on checkout, card 4242.' && d3.description === f3.value && d3.descriptionAuto === false, JSON.stringify({ f3, d: d3.description }));

  // text typed while it was writing wins too
  await b.send('Target.closeTarget', { targetId: P.targetId }).catch(() => {});
  await seed();
  const Q = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await evalIn(Q.sid, `(() => { const f = document.querySelector('#descField'); f.focus(); f.value = 'typed first'; f.dispatchEvent(new Event('input')); })()`);
  const f4 = await field(Q.sid);
  check('typing while it writes drops the writing state', !f4.writing, JSON.stringify(f4));
  await narrate(Q.sid, 'The AI summary.'); await sleep(800);
  const f5 = await field(Q.sid);
  check('a summary arriving while the reporter types leaves their text', f5.value === 'typed first', JSON.stringify(f5));
  await b.send('Target.closeTarget', { targetId: Q.targetId }).catch(() => {});

  // removing the recording takes the AI's description with it
  await seed({ transcribing: false, description: 'About that video.', descriptionAuto: true });
  const R = await open(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  await evalIn(R.sid, `document.querySelector('[data-rm="rec"]').click()`); await sleep(900);
  const f6 = await field(R.sid);
  check('removing the recording clears the description written from it', f6.value === '', JSON.stringify(f6));
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
```

(Check the harness's real helper names in `_harness.mjs` before running and adapt: the suite is appended to it, so it uses whatever `W`, `open`, `evalIn`, `check`, `sleep`, `SCRATCH`, `extId`, `b`, `chrome`, `server`, `results` are there.)

- [ ] **Step 3: README** — add a row: `| `auto-describe` | a narrated recording fills the description: "Writing…" while it transcribes, the summary lands in the empty field, anything the reporter wrote (before or after) is never replaced, removing the recording clears the AI's text |`; and in the `upload-race` row add "and its description".

- [ ] **Step 4: Run**

Run: `CHROME_PATH=<cft> node extension/test/e2e/run.mjs auto-describe upload-race popup-status`
Expected: all checks pass. Look at `desc-writing.png` and `desc-filled.png`.

- [ ] **Step 5: Commit**

```bash
git add extension/test/e2e
git commit -m "E2E: description written from the narration"
```

---

### Task 7: Live checks and full suites

- [ ] **Step 1: Real model quality** — a scratchpad script (tsx, `--env-file=web/.env.local`) runs `describeNarration` on 6 narrations: English bug, French bug, feature request, rambling with repeats, filler only ("testing one two"), and one with a URL and a button label. Check: 1 to 3 sentences, same language, labels kept, nothing invented, no dashes, filler gives null. Adjust `DESCRIBE_SYSTEM` if not.
- [ ] **Step 2: Real transcription round trip** — make a short spoken clip with OpenAI TTS (English and French), run `transcribeAudio` then `describeNarration` on it, print both.
- [ ] **Step 3: Full suites** — `cd web && npx vitest run && npx tsc --noEmit`; `node --test extension/test/*.test.mjs`; e2e `editor filing-restart` too (they mock `/api/transcribe` with `{ ok: true }`, which must still read as "no description").
- [ ] **Step 4: Commit** any prompt changes.
