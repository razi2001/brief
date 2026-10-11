# Ticket quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure ticket quality with a scored test set, then turn reasoning on (Responses API), clean the agent's input, and make tickets plainer (product-language summary, one technical Cause line).

**Architecture:** `loadBriefInput` moves to its own module and reads through a `BriefStore` (Supabase in prod, a folder in the eval). A new `responses.ts` holds the only `/v1/responses` calls (tool loop, JSON answer, text stream); the filing agent, the draft composer and the live stream use it. The eval (`web/scripts/ticket-eval/`) writes drafts for recorded planted-bug cases and scores them with code checks plus a judge call.

**Tech Stack:** Next.js 16 (TypeScript), openai SDK 6.42 (`client.responses`), vitest 4, tsx, Chrome for Testing + raw CDP (extension e2e harness).

Spec: `docs/superpowers/specs/2026-10-11-ticket-quality-design.md`.

Facts this plan relies on (checked 2026-10-11):
- Live probe: gpt-5.6-luna on `/v1/responses` accepts `reasoning.effort: "low"` + a function tool + an image + `store: false` + `include: ["reasoning.encrypted_content"]`; passing the turn's `output` items back plus a `function_call_output` works; structured output (`text.format` json_schema) and streaming (`response.output_text.delta`) work. A turn can return reasoning + message + function_call together.
- `web/lib/agent/run-processing.ts` imports `@/lib/settings` (Clerk); the eval must not import it, hence the move.
- The page capture keeps response bodies only for failed calls; a call that never answers leaves no trace.
- Local `web/.env.local` sets `AGENT_MODEL=gpt-5.4`; the eval pins `gpt-5.6-luna` (the prod default).
- Baseline before this work: 54 test files, 499 tests pass.

Commands run from `web/` unless stated. Worktrees have no `.env.local`; the main checkout's is `C:/Users/razif/src_perso/brief-cloud/web/.env.local`.

---

## File map

| File | Responsibility |
|---|---|
| `web/lib/agent/brief-store.ts` (new) | `BriefStore` interface + `supabaseStore(admin)` |
| `web/lib/agent/load-brief-input.ts` (new, moved) | `loadBriefInput`, `nearestFrame`, `urlAt` (from run-processing) |
| `web/lib/agent/run-processing.ts` | re-exports the moved functions; callers pass `supabaseStore(admin)` |
| `web/lib/agent/model.ts` | + `reasoningEffort()`, `responsesParams()` |
| `web/lib/agent/responses.ts` (new) | `runToolLoop`, `respondJson`, `streamText`, `text()`, `image()` |
| `web/lib/agent/process-brief.ts` | filing agent on `runToolLoop` |
| `web/lib/agent/compose-draft.ts` | draft on `respondJson`; stream messages as `Part[]` |
| `web/app/api/briefs/[id]/stream/route.ts` | live draft on `streamText` |
| `web/lib/agent/context-block.ts` | RECORDING STEPS, REPORTER'S TITLE, Cause wording |
| `web/lib/agent/system-prompt.ts` | QA-lead persona, FIND THE BUG FIRST, Summary/Cause format |
| `web/scripts/ticket-eval/{score,folder-store,judge,run}.ts` (new) | the eval |
| `web/scripts/ticket-eval/cases/<case>/` (new, recorded) | captures + `expect.json` + `overrides.json` |
| `extension/test/e2e/{cases.mjs,_record-case.mjs,record-cases.mjs}` (new) | planted-bug pages and the recorder |

---

### Task 1: BriefStore and loadBriefInput in its own module

**Files:**
- Create: `web/lib/agent/brief-store.ts`, `web/lib/agent/load-brief-input.ts`, `web/lib/agent/load-brief-input.test.ts`
- Modify: `web/lib/agent/run-processing.ts`, `web/app/api/briefs/[id]/stream/route.ts:55`

- [ ] **Step 1: Write the failing test** `web/lib/agent/load-brief-input.test.ts`

```ts
import { expect, test } from "vitest";
import { loadBriefInput } from "./load-brief-input";
import type { BriefStore } from "./brief-store";

/** A store over an in-memory map of storage paths. */
function memoryStore(files: Record<string, Buffer>): BriefStore {
  return {
    async download(p) {
      return files[p] ?? null;
    },
    async list(dir) {
      const names = new Set<string>();
      for (const k of Object.keys(files)) if (k.startsWith(dir + "/")) names.add(k.slice(dir.length + 1).split("/")[0]);
      return [...names];
    },
  };
}
const json = (v: unknown) => Buffer.from(JSON.stringify(v));

test("reads a brief from any store: the json with the reporter's edits, each screenshot with its note", async () => {
  const store = memoryStore({
    "u/b/brief.json": json({ description: "old", pageUrl: "https://app.x/cases", screenshots: [{ file: "screenshots/s1.png", description: "the save button" }] }),
    "u/b/screenshots/s1.png": Buffer.from("png"),
  });
  const { input } = await loadBriefInput(store, "u/b", { overrides: { description: "Save does nothing" } });
  expect(input.json).toMatchObject({ description: "Save does nothing", pageUrl: "https://app.x/cases" });
  expect(input.images.map((i) => [i.name, i.caption])).toEqual([["screenshots/s1.png", "the save button"]]);
  expect(input.evidence.items).toEqual([{ name: "s1.png", kind: "screenshot", caption: "the save button" }]);
});

test("a replay's stills come from the store's replay-frames folder, with their notes", async () => {
  const store = memoryStore({
    "u/b/brief.json": json({}),
    "u/b/replay.json": json({ v: 2, events: [], frames: [{ file: "frame-01.jpg", t: 1000, url: "https://app.x/", note: "Brief noticed: POST /api/pay failed (500)" }], marks: [] }),
    "u/b/replay-frames/frame-01.jpg": Buffer.from("jpg"),
  });
  const { input } = await loadBriefInput(store, "u/b", {});
  expect(input.images.map((i) => i.name)).toEqual(["replay-frame-frame-01.jpg"]);
  expect(input.images[0].caption).toBe("Brief noticed: POST /api/pay failed (500)");
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module './load-brief-input'`)

Run: `npx vitest run lib/agent/load-brief-input.test.ts`

- [ ] **Step 3: Create `web/lib/agent/brief-store.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a brief's files are read from: the `briefs` bucket in production, a
 * folder for the ticket eval (scripts/ticket-eval). Paths are storage paths,
 * e.g. "<prefix>/brief.json" or "<prefix>/screenshots".
 */
export interface BriefStore {
  /** The file's bytes, or null when it isn't there. */
  download(path: string): Promise<Buffer | null>;
  /** Names of what sits directly in `dir` (no recursion). */
  list(dir: string): Promise<string[]>;
}

export function supabaseStore(admin: SupabaseClient): BriefStore {
  const bucket = () => admin.storage.from("briefs");
  return {
    async download(path) {
      const { data } = await bucket().download(path);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    },
    async list(dir) {
      const { data } = await bucket().list(dir, { limit: 200 });
      return (data ?? []).map((o) => o.name);
    },
  };
}
```

- [ ] **Step 4: Move the code.** Create `web/lib/agent/load-brief-input.ts` holding, unchanged except as noted, `nearestFrame` and `urlAt` (run-processing.ts lines 18-39) and `loadBriefInput` (lines 72-379), with the imports they use:

```ts
import { cleanUrl } from "@/lib/clean-url";
import { selectDistinctFrames } from "@/lib/agent/frame-hash";
import type { BriefInput } from "@/lib/agent/process-brief";
import { transcribeAudio, transcriptionHint } from "@/lib/agent/transcribe";
import { mergeBriefOverrides, captionForScreenshot, type BriefOverrides, type ReplayFrame } from "@/lib/agent/overrides";
import { techFromReplay, techFromRecording, isEmpty as isTechEmpty, type VideoLogs } from "@/lib/agent/tech-details";
import { summarizeReplay, type ReplaySummary } from "@/lib/agent/replay-steps";
import { findRecordingName, isRecordingName, isTranscribableRecording, recordingContentType, type RecordingName } from "@/lib/brief";
import type { BriefStore } from "./brief-store";
```

Edits inside the moved `loadBriefInput`:
- Signature: `export async function loadBriefInput(store: BriefStore, prefix: string, opts: { ... same ... })`.
- `const dl = async (p: string) => { const { data } = await admin.storage...` becomes `const dl = (p: string) => store.download(p);`
- Recording fallback: `const { data: rootList } = await admin.storage.from("briefs").list(prefix, { limit: 100 }); recName = findRecordingName((rootList ?? []).map((o) => o.name));` becomes `recName = findRecordingName(await store.list(prefix));`
- Keyframes: `const { data: kf } = ...; const names = (kf ?? []).map((o) => o.name).sort();` becomes `const names = (await store.list(`${prefix}/keyframes`)).sort();`
- Replay stills for the model: `const files = (await admin.storage.from("briefs").list(`${prefix}/replay-frames`, { limit: 50 })).data ?? [];` and `for (const o of files.map((x) => x.name).sort().slice(0, 12))` become `const files = await store.list(`${prefix}/replay-frames`);` and `for (const o of [...files].sort().slice(0, 12))`.
- Screenshots: `const { data: shotList } = ...; for (const o of shotList ?? []) shotPaths.push(`screenshots/${o.name}`);` becomes `for (const name of await store.list(`${prefix}/screenshots`)) shotPaths.push(`screenshots/${name}`);`
- Replay stills for the ticket: `const { data: rfList } = ...; const stills = (rfList ?? []).map((o) => o.name).sort().slice(0, 12);` becomes `const stills = (await store.list(`${prefix}/replay-frames`)).sort().slice(0, 12);`

- [ ] **Step 5: Point run-processing at the new module.** In `run-processing.ts`: delete the moved code and the imports only it used (`selectDistinctFrames`, `transcribeAudio`/`transcriptionHint`, `captionForScreenshot`, `techFromReplay`/`techFromRecording`/`isTechEmpty`/`VideoLogs`, `summarizeReplay`/`ReplaySummary`, `ReplayFrame`, `cleanUrl`, `findRecordingName`/`isRecordingName`/`isTranscribableRecording`/`recordingContentType`; keep `RecordingName` only if still referenced). Add:

```ts
import { loadBriefInput } from "@/lib/agent/load-brief-input";
import { supabaseStore } from "@/lib/agent/brief-store";
// moved to load-brief-input.ts; re-exported for existing importers
export { loadBriefInput, nearestFrame, urlAt } from "@/lib/agent/load-brief-input";
```

Callers: `await loadBriefInput(admin, prefix, {` becomes `await loadBriefInput(supabaseStore(admin), prefix, {` (two places: `processBriefById`, `draftBriefById`). In `web/app/api/briefs/[id]/stream/route.ts:55`, `loadBriefInput(admin, ...)` becomes `loadBriefInput(supabaseStore(admin), ...)` with `import { supabaseStore } from "@/lib/agent/brief-store";`.

- [ ] **Step 6: Run the new test and the whole suite, expect PASS**

Run: `npx vitest run lib/agent/load-brief-input.test.ts` then `npx vitest run` (expect 501 passed) and `npx tsc --noEmit` (no output).

- [ ] **Step 7: Commit**

```bash
git add web/lib/agent/brief-store.ts web/lib/agent/load-brief-input.ts web/lib/agent/load-brief-input.test.ts web/lib/agent/run-processing.ts "web/app/api/briefs/[id]/stream/route.ts"
git commit -m "refactor(web): loadBriefInput reads through a BriefStore, in its own module"
```

---

### Task 2: The eval's code checks

**Files:**
- Create: `web/scripts/ticket-eval/score.ts`, `web/scripts/ticket-eval/score.test.ts`

- [ ] **Step 1: Write the failing test** `web/scripts/ticket-eval/score.test.ts`

```ts
import { expect, test } from "vitest";
import { codeChecks, summaryOf } from "./score";

const good = {
  title: "Saving a test case does nothing",
  body: [
    "Clicking Save on a test case leaves the form as it was and the case is not saved, so the edit is lost.",
    "",
    "**Steps to reproduce**",
    "1. Open a test case",
    "2. Click Save",
    "",
    "**Expected**",
    "The case is saved.",
    "",
    "**Actual**",
    "Nothing happens.",
    "",
    "**Cause:** The save call (PUT /api/cases/42) returns 500.",
    "",
    "**Context:** [Edit test case - Acme QA](https://app.x/cases/42)",
  ].join("\n"),
};

test("a ticket that follows every rule passes every check (the Cause line may be technical)", () => {
  expect(codeChecks(good, "failure")).toEqual({
    sections: true, contextLink: true, noBannedWords: true, noDashes: true, plainSummary: true, cause: true,
  });
});

test("a summary or title that opens on a log line is not plain", () => {
  expect(codeChecks({ ...good, body: "GET /api/test-cases took 7.9 s, so the list is slow.\n\n" + good.body }, "failure").plainSummary).toBe(false);
  expect(codeChecks({ ...good, title: "Save returns 500" }, "failure").plainSummary).toBe(false);
  expect(codeChecks({ ...good, title: "TypeError on save" }, "failure").plainSummary).toBe(false);
});

test("a Summary label is read as the summary, inline or on its own line", () => {
  expect(summaryOf("**Summary**\nThe list never loads.\n\n**Steps to reproduce**\n1. x")).toBe("The list never loads.");
  expect(summaryOf("**Summary:** The list never loads.\n\n**Expected**\nIt loads.")).toBe("The list never loads.");
});

test("nothing wrong: no sections required, and a Cause line is a fail", () => {
  const clean = { title: "Adding a to-do works", body: "Adding an item works; no error showed up.\n\n**Context:** [Todos](https://app.x/todos)" };
  expect(codeChecks(clean, "none")).toMatchObject({ sections: null, cause: true });
  expect(codeChecks({ ...clean, body: clean.body + "\n\n**Cause:** none" }, "none").cause).toBe(false);
});

test("a UI-only bug doesn't grade the Cause line", () => {
  expect(codeChecks(good, "ui").cause).toBeNull();
});

test("missing sections, a bare URL, banned words and dashes are caught", () => {
  const bad = { title: "Save fails \u2014 see recording", body: "It breaks.\n\nhttps://app.x/cases/42" };
  expect(codeChecks(bad, "failure")).toMatchObject({ sections: false, contextLink: false, noBannedWords: false, noDashes: false, cause: false });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `npx vitest run scripts/ticket-eval/score.test.ts`

- [ ] **Step 3: Write `web/scripts/ticket-eval/score.ts`**

```ts
// The ticket eval's code checks: rules a written ticket must follow, checked
// without a model. Pure; unit-tested in score.test.ts.

export type Kind = "failure" | "ui" | "none";
export interface Ticket { title: string; body: string }
export interface Checks {
  /** Steps, Expected and Actual are all there (null: not required when nothing is wrong). */
  sections: boolean | null;
  /** The page is a Markdown link. */
  contextLink: boolean;
  noBannedWords: boolean;
  noDashes: boolean;
  /** The title and summary carry no HTTP method, API path, status code or exception name. */
  plainSummary: boolean;
  /** A Cause line when something failed, none when nothing is wrong (null: either is fine). */
  cause: boolean | null;
}

const LABEL_LINE = /^\s*\*\*[^*\n]{2,40}\*\*/;
const BANNED = /\b(?:briefs?|recording|recorded|captured?|transcript|narrated|keyframes?)\b|the (?:user|reporter) said/i;
const TECHNICAL = /\b(?:GET|POST|PUT|PATCH|DELETE)\b|\/api\/|\b[45]\d\d\b|\b\w*(?:Error|Exception)\b|status code|stack trace/;

/** The opening paragraph(s): everything before the first section label, minus a leading Summary label. */
export function summaryOf(body: string): string {
  const lines = (body ?? "").replace(/\r\n/g, "\n").trim().split("\n");
  const out: string[] = [];
  for (const [i, line] of lines.entries()) {
    const lead = /^\s*\*\*summary:?\*\*:?\s*/i;
    if (i === 0 && lead.test(line)) {
      out.push(line.replace(lead, ""));
      continue;
    }
    if (LABEL_LINE.test(line) || /^#{1,6}\s/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function codeChecks(t: Ticket, kind: Kind): Checks {
  const body = t.body ?? "";
  const all = `${t.title ?? ""}\n${body}`;
  const has = (label: string) => new RegExp(`\\*\\*${label}[^*]*\\*\\*`, "i").test(body);
  return {
    sections: kind === "none" ? null : has("steps") && has("expected") && has("actual"),
    contextLink: /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(body),
    noBannedWords: !BANNED.test(all),
    noDashes: !/[\u2013\u2014]/.test(all),
    plainSummary: !TECHNICAL.test(`${t.title ?? ""}\n${summaryOf(body)}`),
    cause: kind === "failure" ? has("cause") : kind === "none" ? !has("cause") : null,
  };
}
```

- [ ] **Step 4: Run, expect PASS.** `npx vitest run scripts/ticket-eval/score.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/scripts/ticket-eval/score.ts web/scripts/ticket-eval/score.test.ts
git commit -m "test(web): ticket eval code checks"
```

---

### Task 3: The eval runner (folder store, judge, run)

**Files:**
- Create: `web/scripts/ticket-eval/folder-store.ts`, `web/scripts/ticket-eval/judge.ts`, `web/scripts/ticket-eval/run.ts`, `web/scripts/ticket-eval/README.md`
- Modify: `web/lib/agent/compose-draft.ts` (DraftResult.usage), `web/package.json` (script), `.gitignore`

- [ ] **Step 1: Token usage on the draft result.** In `compose-draft.ts`:

```ts
export interface DraftResult {
  title: string;
  descriptionMarkdown: string;
  /** Tokens the write took (the eval reports them). */
  usage?: { input: number; output: number; reasoning: number };
}
```

and in `composeDraftTicket`'s `run`, return
`{ title: title || "Untitled", descriptionMarkdown: description, usage: resp.usage ? { input: resp.usage.prompt_tokens, output: resp.usage.completion_tokens, reasoning: resp.usage.completion_tokens_details?.reasoning_tokens ?? 0 } : undefined }`.

Update `compose-draft.test.ts`'s first test to `toMatchObject({ title: "Pay button 500s", descriptionMarkdown: "It 500s." })` (the mocked response has no usage, so `usage` is undefined; `toEqual` would still pass, keep `toEqual` if it does).

- [ ] **Step 2: `web/scripts/ticket-eval/folder-store.ts`**

```ts
import { readFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { BriefStore } from "../../lib/agent/brief-store";

/** A BriefStore over a folder: "<root>/<prefix>/brief.json". A "<file>.gz" stands in for "<file>". */
export function folderStore(root: string): BriefStore {
  return {
    async download(p) {
      const file = path.join(root, p);
      try {
        return await readFile(file);
      } catch {
        /* try the gzipped copy */
      }
      try {
        return gunzipSync(await readFile(file + ".gz"));
      } catch {
        return null;
      }
    },
    async list(dir) {
      try {
        return (await readdir(path.join(root, dir))).map((n) => n.replace(/\.gz$/, ""));
      } catch {
        return [];
      }
    },
  };
}
```

- [ ] **Step 3: `web/scripts/ticket-eval/judge.ts`**

```ts
import type OpenAI from "openai";
import type { Kind, Ticket } from "./score";

export interface Verdict {
  namedBug: "yes" | "partly" | "no";
  inventedBug: boolean;
  plainSummary: boolean;
  why: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    namedBug: { type: "string", enum: ["yes", "partly", "no"] },
    inventedBug: { type: "boolean" },
    plainSummary: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["namedBug", "inventedBug", "plainSummary", "why"],
  additionalProperties: false,
};

const RULES = `You grade one bug ticket an AI wrote from a browser capture. You are told the bug planted in the page (the ground truth) and its kind: "failure" (something in the page's network or console explains it), "ui" (visible only), or "none" (nothing was wrong).
- namedBug: "yes" when the ticket's title and summary are about the planted bug (the same user-visible problem; wording may differ). "partly" when the planted bug is in the ticket but not what it leads with, or only half of it is there. "no" when the ticket is about something else or misses it. For kind "none", answer "no".
- inventedBug: true when the ticket claims a failure, error message or cause that the planted bug does not include. For kind "none", any claimed failure counts. A correct extra detail about the planted bug is not invented.
- plainSummary: true when a PM or QA who never saw the code would understand the title and opening summary on their own: product language, no HTTP methods, API paths, status codes or exception names there. Technical detail in a separate Cause line is fine.
- why: one sentence.`;

export async function judge(client: OpenAI, model: string, expect: { bug: string; kind: Kind }, t: Ticket): Promise<Verdict> {
  const resp = await client.responses.create({
    model,
    instructions: RULES,
    input: `PLANTED BUG (${expect.kind}): ${expect.bug}\n\nTICKET\n# ${t.title}\n\n${t.body}`,
    text: { format: { type: "json_schema", name: "verdict", schema: SCHEMA, strict: true } },
    reasoning: { effort: "medium" },
    store: false,
  });
  return JSON.parse(resp.output_text) as Verdict;
}
```

- [ ] **Step 4: `web/scripts/ticket-eval/run.ts`**

```ts
// The ticket eval: writes a draft for every recorded case (and variant),
// several times, and scores each one. It costs OpenAI calls - run by hand:
//
//   cd web && npx tsx scripts/ticket-eval/run.ts [--case save-500] [--runs 3]
//     [--effort low|medium] [--label baseline] [--model gpt-5.6-luna] [--env <file>]
//
// OPENAI_API_KEY comes from the environment, else from --env (default web/.env.local).
import { readFileSync } from "node:fs";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { loadBriefInput } from "../../lib/agent/load-brief-input";
import { composeDraftTicket } from "../../lib/agent/compose-draft";
import type { BriefOverrides } from "../../lib/agent/overrides";
import { folderStore } from "./folder-store";
import { codeChecks, type Checks, type Kind, type Ticket } from "./score";
import { judge, type Verdict } from "./judge";

const here = path.dirname(fileURLToPath(import.meta.url));
const JUDGE_MODEL = "gpt-5.6-luna";

type Variant = { name: string; description?: string };
type Expect = { bug: string; kind: Kind; variants?: Variant[] };
type Job = { name: string; root: string; prefix: string; expect: Expect; variant: Variant; run: number };
type Row = {
  case: string; variant: string; run: number; ms?: number;
  usage?: { input: number; output: number; reasoning: number };
  checks?: Checks; verdict?: Verdict; ticket?: Ticket; error?: string;
};

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function loadEnv(file: string) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** Case folders: cases/<name>/expect.json, and cases/local/<name>/expect.json (gitignored). */
async function findCases(dir: string): Promise<Array<{ name: string; root: string; prefix: string }>> {
  const out: Array<{ name: string; root: string; prefix: string }> = [];
  for (const root of [dir, path.join(dir, "local")]) {
    let names: string[] = [];
    try { names = await readdir(root); } catch { continue; }
    for (const n of names.sort()) {
      try { await readFile(path.join(root, n, "expect.json")); } catch { continue; }
      out.push({ name: root === dir ? n : `local/${n}`, root, prefix: n });
    }
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const rate = (xs: Array<boolean | null | undefined>) => {
  const k = xs.filter((x): x is boolean => typeof x === "boolean");
  return k.length ? `${Math.round((100 * k.filter(Boolean).length) / k.length)}%` : "-";
};
const named = (v?: Verdict) => (v ? (v.namedBug === "yes" ? 1 : v.namedBug === "partly" ? 0.5 : 0) : 0);

async function main() {
  if (!process.env.OPENAI_API_KEY) loadEnv(arg("env", path.join(here, "..", "..", ".env.local"))!);
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (pass --env <file>)");
  process.env.AGENT_MODEL = arg("model", "gpt-5.6-luna");
  const effort = arg("effort");
  if (effort) process.env.AGENT_REASONING = effort;
  const runs = Number(arg("runs", "3"));
  const only = arg("case");
  const label = arg("label", "run")!;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const cases = (await findCases(path.join(here, "cases"))).filter((c) => !only || c.name === only);
  if (!cases.length) throw new Error("no cases (record them: extension/test/e2e/record-cases.mjs)");
  const jobs: Job[] = [];
  for (const c of cases) {
    const expect = JSON.parse(await readFile(path.join(c.root, c.prefix, "expect.json"), "utf8")) as Expect;
    for (const variant of expect.variants?.length ? expect.variants : [{ name: "one-click" }]) {
      for (let run = 1; run <= runs; run++) jobs.push({ ...c, expect, variant, run });
    }
  }
  console.log(`${jobs.length} drafts (${cases.length} cases, ${runs} runs) on ${process.env.AGENT_MODEL}, reasoning ${process.env.AGENT_REASONING || "default"}`);

  const rows = await pool(jobs, Number(arg("concurrency", "6")), async (j): Promise<Row> => {
    const row: Row = { case: j.name, variant: j.variant.name, run: j.run };
    try {
      const saved = JSON.parse(await readFile(path.join(j.root, j.prefix, "overrides.json"), "utf8").catch(() => "{}")) as BriefOverrides;
      const overrides: BriefOverrides = { ...saved, ...(j.variant.description !== undefined ? { description: j.variant.description } : {}) };
      const { input } = await loadBriefInput(folderStore(j.root), j.prefix, { overrides });
      const t0 = Date.now();
      const draft = await composeDraftTicket(input, "");
      row.ms = Date.now() - t0;
      row.usage = draft.usage;
      row.ticket = { title: draft.title, body: draft.descriptionMarkdown };
      row.checks = codeChecks(row.ticket, j.expect.kind);
      row.verdict = await judge(client, JUDGE_MODEL, j.expect, row.ticket);
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
    process.stdout.write(row.error ? "x" : ".");
    return row;
  });
  console.log("");

  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(`${r.case} / ${r.variant}`, [...(groups.get(`${r.case} / ${r.variant}`) ?? []), r]);
  const table = [...groups].map(([key, rs]) => {
    const ok = rs.filter((r) => !r.error);
    return {
      case: key,
      named: ok.length ? (ok.reduce((s, r) => s + named(r.verdict), 0) / ok.length).toFixed(2) : "-",
      invented: ok.filter((r) => r.verdict?.inventedBug).length,
      plain: rate(ok.map((r) => r.verdict?.plainSummary)),
      plainCode: rate(ok.map((r) => r.checks?.plainSummary)),
      sections: rate(ok.map((r) => r.checks?.sections)),
      cause: rate(ok.map((r) => r.checks?.cause)),
      rules: rate(ok.map((r) => !!r.checks && r.checks.contextLink && r.checks.noBannedWords && r.checks.noDashes)),
      s: (median(ok.map((r) => r.ms ?? 0)) / 1000).toFixed(1),
      tokens: ok.length ? Math.round(ok.reduce((s, r) => s + (r.usage ? r.usage.input + r.usage.output : 0), 0) / ok.length) : 0,
      errors: rs.length - ok.length,
    };
  });
  console.table(table);
  const ok = rows.filter((r) => !r.error);
  const cleanRows = ok.filter((r) => jobs.find((j) => j.name === r.case)?.expect.kind === "none");
  console.log(
    `TOTAL named ${(ok.reduce((s, r) => s + named(r.verdict), 0) / Math.max(1, ok.filter((r) => jobs.find((j) => j.name === r.case)?.expect.kind !== "none").length)).toFixed(2)}` +
      ` | invented on clean ${cleanRows.filter((r) => r.verdict?.inventedBug).length}/${cleanRows.length}` +
      ` | invented anywhere ${ok.filter((r) => r.verdict?.inventedBug).length}/${ok.length}` +
      ` | plain (judge) ${rate(ok.map((r) => r.verdict?.plainSummary))} (code) ${rate(ok.map((r) => r.checks?.plainSummary))}` +
      ` | median ${(median(ok.map((r) => r.ms ?? 0)) / 1000).toFixed(1)} s | errors ${rows.length - ok.length}`,
  );
  const outDir = path.join(here, "results");
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`);
  await writeFile(file, JSON.stringify({ label, model: process.env.AGENT_MODEL, effort: process.env.AGENT_REASONING ?? null, table, rows }, null, 2));
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Note: the TOTAL `named` divides by the non-clean rows only (clean cases always score 0 there by design); `named(r.verdict)` is 0 for clean rows so the sum is unaffected.

- [ ] **Step 5: Script, ignore rules, README.**

`web/package.json` scripts: add `"eval:tickets": "tsx scripts/ticket-eval/run.ts"`.

`.gitignore` (repo root) append:

```
# Ticket eval: run results, and cases made from your own drafts
web/scripts/ticket-eval/results/
web/scripts/ticket-eval/cases/local/
```

`web/scripts/ticket-eval/README.md`:

```markdown
# Ticket eval

Scores the tickets the draft writer produces for recorded reports with a known, planted bug.

- `cases/<case>/`: one capture, laid out like storage (`brief.json`, `replay.json`, `replay-frames/`, a `.gz` stands in for a big file), the popup's `overrides.json`, and `expect.json` (the planted bug, its kind `failure | ui | none`, and variants that change the typed description).
- Record or re-record them: `CHROME_PATH=<chrome for testing> node extension/test/e2e/record-cases.mjs [case ...]` (pages in `extension/test/e2e/cases.mjs`).
- Your own drafts can go in `cases/local/<name>/` (gitignored) with an `expect.json` you write.

Run (costs OpenAI calls; about 50 drafts plus 50 judge calls at 3 runs):

    cd web && npm run eval:tickets -- --label baseline
    npm run eval:tickets -- --case save-500 --runs 1 --effort medium

Per case and variant: `named` (judge: did it name the planted bug, 1 / 0.5 / 0), `invented` (claimed a failure that wasn't planted), `plain` (judge) and `plainCode` (no method, path, status or error name in the title and summary), `sections` (Steps, Expected, Actual), `cause` (a Cause line when something failed, none when nothing did), `rules` (page link, no banned words, no dashes), median seconds, tokens. Every ticket is saved in `results/` (gitignored).
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit` (no output), `npx eslint scripts/ticket-eval lib/agent` (no errors).

- [ ] **Step 7: Commit**

```bash
git add web/scripts/ticket-eval web/lib/agent/compose-draft.ts web/lib/agent/compose-draft.test.ts web/package.json .gitignore
git commit -m "test(web): ticket eval runner - drafts scored by code checks and a judge"
```

---

### Task 4: Planted-bug pages and the recorder

**Files:**
- Create: `extension/test/e2e/cases.mjs`, `extension/test/e2e/_record-case.mjs`, `extension/test/e2e/record-cases.mjs`
- Modify: `extension/test/e2e/README.md`

- [ ] **Step 1: `extension/test/e2e/cases.mjs`**

```js
// Pages with one planted bug each, for the ticket eval (web/scripts/ticket-eval).
// record-cases.mjs serves each at http://cases.brief.localhost:3997/<case>, does
// what a user would, and takes the last minute as a one-click report. Each case:
// the page, how its API answers, the user's steps, and what the eval should find.

const shell = (title, body, script = '') => `<!doctype html><html><head><title>${title} - Acme QA</title>
<style>
body{font:15px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1d2330}
header{background:#1d2330;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}
header b{font-size:16px} header a{color:#c9d1e0;text-decoration:none}
main{padding:28px 32px;max-width:880px}
h1{font-size:22px;margin:0 0 18px}
label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text],input:not([type]){font:inherit;padding:8px 10px;border:1px solid #c5ccd8;border-radius:6px;width:320px}
button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid #2f5bd3;background:#2f5bd3;color:#fff;cursor:pointer;margin-top:14px}
.err{color:#c62828;margin-top:8px} .ok{color:#1b7f3b;margin-top:8px}
table{border-collapse:collapse;background:#fff;width:100%;table-layout:fixed} td,th{border-bottom:1px solid #e3e7ee;padding:10px;text-align:left}
.spinner{width:28px;height:28px;border:3px solid #c5ccd8;border-top-color:#2f5bd3;border-radius:50%;animation:spin 1s linear infinite;margin:24px 0}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><header><b>Acme QA</b><a href="#">Projects</a><a href="#">Test cases</a><a href="#">Reports</a></header><main>${body}</main><script>${script}</script></body></html>`;

const reply = (res, status, body, delay = 0) => setTimeout(() => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}, delay);

export const CASES = {
  'save-500': {
    expect: {
      kind: 'failure',
      bug: 'Saving a test case fails: the save request returns a 500 server error and the page shows no message, so the user does not know the edit was not saved.',
      variants: [{ name: 'one-click' }, { name: 'described', description: "can't save my test case" }],
    },
    html: shell('Edit test case', `<h1>Edit test case</h1>
<label for="title">Title</label><input id="title" value="Login with SSO"/>
<label for="steps">Steps</label><input id="steps" value="Open login, click SSO"/>
<div><button id="save">Save</button></div>`,
    `save.onclick=async()=>{save.disabled=true;save.textContent='Saving...';try{await fetch('/api/cases/42',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:title.value})});}catch(e){}save.disabled=false;save.textContent='Save';};`),
    api: { 'PUT /api/cases/42': (req, res) => reply(res, 500, { error: 'database timeout' }, 600) },
    flow: [{ type: ['#title', ' (edited)'] }, { wait: 800 }, { click: '#save' }, { wait: 2500 }, { click: '#save' }, { wait: 2500 }],
  },

  'save-200-error': {
    expect: {
      kind: 'ui',
      bug: 'Notification settings do not save: clicking Save shows nothing, and after a reload the option is off again.',
      variants: [{ name: 'one-click' }, { name: 'described', description: 'my notification setting keeps turning itself off' }],
    },
    html: shell('Notification settings', `<h1>Notification settings</h1>
<label><input type="checkbox" id="failed"/> Email me when a run fails</label>
<div><button id="save">Save</button></div>`,
    `save.onclick=()=>{fetch('/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({emailOnFail:failed.checked})}).then(r=>r.json()).then(()=>{}).catch(()=>{});};`),
    api: { 'POST /api/settings': (req, res) => reply(res, 200, { ok: false, error: 'Workspace is read-only' }, 300) },
    flow: [{ click: '#failed' }, { wait: 600 }, { click: '#save' }, { wait: 2000 }, { reload: true }, { wait: 2000 }],
  },

  'validation': {
    expect: {
      kind: 'ui',
      bug: "Inviting a teammate is blocked: the form says 'Please enter a valid email address' for a valid address (it has a dot before the @).",
      variants: [{ name: 'one-click' }, { name: 'described', description: 'it says the email is invalid but it is correct' }],
    },
    html: shell('Invite teammate', `<h1>Invite a teammate</h1>
<label for="email">Email</label><input id="email" placeholder="name@company.com"/>
<div><button id="send">Send invite</button></div><p id="msg"></p>`,
    `send.onclick=()=>{const ok=/^[a-z]+@[a-z]+\\.[a-z]{2,3}$/.test(email.value);msg.className=ok?'ok':'err';msg.textContent=ok?'Invite sent':'Please enter a valid email address';};`),
    api: {},
    flow: [{ type: ['#email', 'ana.lopez@acme.io'] }, { wait: 600 }, { click: '#send' }, { wait: 1500 }, { click: '#send' }, { wait: 1500 }],
  },

  'stuck-spinner': {
    expect: {
      kind: 'failure',
      bug: 'The projects list never loads: the request for the list fails (504 Gateway Timeout) and the page keeps showing a spinner with no message.',
      variants: [{ name: 'one-click' }, { name: 'described', description: 'projects page stuck loading' }],
    },
    html: shell('Projects', `<h1>Projects</h1><div id="list"><div class="spinner"></div></div><button id="reload">Refresh</button>`,
    `const load=()=>{list.innerHTML='<div class="spinner"></div>';fetch('/api/projects').then(r=>r.json()).then(d=>{if(d.projects)list.innerHTML=d.projects.map(p=>'<p>'+p+'</p>').join('');}).catch(()=>{});};load();reload.onclick=load;`),
    api: { 'GET /api/projects': (req, res) => reply(res, 504, { error: 'upstream timed out' }, 3000) },
    flow: [{ wait: 4500 }, { click: '#reload' }, { wait: 4500 }],
  },

  'dead-button': {
    expect: {
      kind: 'ui',
      bug: 'The Export CSV button on the Reports page does nothing when clicked: no download, no message.',
      variants: [{ name: 'one-click' }, { name: 'described', description: 'export does not work' }],
    },
    html: shell('Reports', `<h1>Reports</h1>
<table><tr><th>Run</th><th>Passed</th><th>Failed</th></tr><tr><td>Nightly #212</td><td>184</td><td>3</td></tr><tr><td>Nightly #211</td><td>186</td><td>1</td></tr></table>
<button id="export">Export CSV</button>`, ''),
    api: {},
    flow: [{ wait: 1000 }, { click: '#export' }, { wait: 1500 }, { click: '#export' }, { click: '#export' }, { click: '#export' }, { wait: 2000 }],
  },

  'layout': {
    expect: {
      kind: 'ui',
      bug: "On the Test runs table, a long test name runs over the Status column, so that row's status can't be read.",
      variants: [{ name: 'one-click' }, { name: 'described', description: 'the runs table looks broken' }],
    },
    html: shell('Test runs', `<h1>Test runs</h1>
<table><tr><th style="width:220px">Test</th><th>Status</th><th>Duration</th></tr>
<tr><td>Login with SSO</td><td>Passed</td><td>12 s</td></tr>
<tr id="long"><td style="white-space:nowrap;overflow:visible">Checkout applies the loyalty discount after the coupon is removed</td><td>Failed</td><td>48 s</td></tr>
<tr><td>Search by tag</td><td>Passed</td><td>9 s</td></tr></table><p id="sel"></p>`,
    `document.querySelectorAll('tr').forEach(r=>r.onclick=()=>{document.querySelectorAll('tr').forEach(x=>x.style.background='');r.style.background='#eef3ff';});`),
    api: {},
    flow: [{ wait: 1500 }, { click: '#long' }, { wait: 2500 }],
  },

  'slow-search': {
    expect: {
      kind: 'failure',
      bug: 'Searching test cases takes about 9 seconds to show results; the search request itself takes about 9 seconds.',
      variants: [{ name: 'one-click' }, { name: 'described', description: 'search is really slow' }],
    },
    html: shell('Search', `<h1>Search test cases</h1><input id="q" placeholder="Search"/> <button id="go">Search</button><div id="out"></div>`,
    `go.onclick=()=>{out.innerHTML='<p>Searching...</p>';fetch('/api/search?q='+encodeURIComponent(q.value)).then(r=>r.json()).then(d=>{out.innerHTML=d.results.map(x=>'<p>'+x+'</p>').join('');});};`),
    api: { 'GET /api/search': (req, res) => reply(res, 200, { results: ['Invoice totals round correctly', 'Invoice PDF download', 'Invoice email reminder'] }, 9000) },
    flow: [{ type: ['#q', 'invoice'] }, { wait: 500 }, { click: '#go' }, { wait: 10500 }],
  },

  'clean': {
    expect: {
      kind: 'none',
      bug: 'Nothing is wrong: adding a to-do and checking it off both work.',
      variants: [{ name: 'one-click' }, { name: 'described', description: 'something felt off when adding a todo' }],
    },
    html: shell('To-do', `<h1>To-do</h1><input id="item" placeholder="New item"/> <button id="add">Add</button><ul id="list"></ul>`,
    `add.onclick=()=>{fetch('/api/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:item.value})}).then(r=>r.json()).then(()=>{const li=document.createElement('li');li.innerHTML='<label><input type=checkbox> '+item.value.replace(/</g,'&lt;')+'</label>';list.appendChild(li);item.value='';});};`),
    api: { 'POST /api/todos': (req, res) => reply(res, 201, { id: 7 }, 150) },
    flow: [{ type: ['#item', 'Review release notes'] }, { click: '#add' }, { wait: 1200 }, { click: '#list input' }, { wait: 1500 }],
  },
};
```

- [ ] **Step 2: `extension/test/e2e/_record-case.mjs`** (the rest of the harness's `main()`, like a suite)

```js
  // ---- record one ticket-eval case: a page with a planted bug, then a one-click report ----
  const zlib = await import('node:zlib');
  const { CASES } = await import(process.env.CASES_URL);
  const name = process.env.CASE;
  const C = CASES[name];
  if (!C) throw new Error(`no case "${name}"`);
  const CPORT = 3997;
  http.createServer((req, res) => {
    const api = C.api?.[`${req.method} ${req.url.split('?')[0]}`];
    if (api) return api(req, res);
    if (req.url.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(C.html);
  }).listen(CPORT);

  // Answer Brief Cloud here (nothing leaves the machine) and keep what was sent.
  const uploads = new Map();
  let overrides = null;
  const APP = 'https://cloud.get-brief.app';
  const bodyOf = async (sid, p) => {
    if (p.request.postDataEntries?.length) return Buffer.concat(p.request.postDataEntries.map((e) => Buffer.from(e.bytes || '', 'base64')));
    if (p.request.postData) return Buffer.from(p.request.postData, 'utf8');
    if (!p.request.hasPostData) return Buffer.alloc(0);
    const r = await b.send('Fetch.getRequestPostData', { requestId: p.requestId }, sid).catch(() => null);
    return r ? Buffer.from(r.postData, r.base64Encoded ? 'base64' : 'utf8') : Buffer.alloc(0);
  };
  const answer = async (sid, p) => {
    const url = p.request.url;
    const body = await bodyOf(sid, p);
    let res = { ok: true, shareId: 's-case' };
    if (url.startsWith('https://up.test/')) uploads.set(decodeURIComponent(url.slice('https://up.test/'.length)), body);
    else if (url.endsWith('/api/briefs') || /\/api\/briefs\/b-case\/files$/.test(url)) {
      const files = JSON.parse(body.toString('utf8') || '{}').files || [];
      res = { briefId: 'b-case', uploads: Object.fromEntries(files.map((f) => [f, { signedUrl: 'https://up.test/' + encodeURIComponent(f) }])) };
    } else if (/\/api\/briefs\/b-case\/draft$/.test(url)) overrides = JSON.parse(body.toString('utf8') || '{}');
    await b.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(res)).toString('base64') }, sid).catch(() => {});
  };
  const watchWorker = async (sid) => b.send('Fetch.enable', { patterns: [{ urlPattern: APP + '/*' }, { urlPattern: 'https://up.test/*' }] }, sid).catch(() => {});
  b.on((m) => {
    if (m.method === 'Fetch.requestPaused') answer(m.sessionId, m.params);
    if (m.method === 'Target.attachedToTarget') {
      const sid = m.params.sessionId;
      const ours = m.params.targetInfo.url.includes(extId);
      (ours ? watchWorker(sid) : Promise.resolve()).then(() => b.send('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {}));
    }
  });
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  for (const t of (await b.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.includes(extId))) {
    await watchWorker(await attach(t.targetId));
  }
  await W(`chrome.storage.local.set({ briefCloudToken: 'bxt_test' })`);

  // What a user does on the page.
  const P = await open(`http://cases.brief.localhost:${CPORT}/${name}`); await sleep(2500); await focus(P);
  const tabId = await W(`chrome.tabs.query({ url: 'http://cases.brief.localhost:${CPORT}/*' }).then(t => t[0].id)`);
  for (const s of C.flow) {
    if (s.wait) await sleep(s.wait);
    if (s.click) await click(P.sid, s.click);
    if (s.type) {
      await evalIn(P.sid, `(()=>{const el=document.querySelector(${JSON.stringify(s.type[0])});el.focus();const n=el.value.length;el.setSelectionRange(n,n);})()`);
      await b.send('Input.insertText', { text: s.type[1] }, P.sid); await sleep(300);
    }
    if (s.reload) { await b.send('Page.reload', {}, P.sid); await sleep(2500); }
  }

  // The one-click report (the shortcut, as a message).
  await W(`chrome.runtime.sendMessage({ type: 'REPORT_NOW', tabId: ${tabId} })`);
  for (let i = 0; i < 150 && !overrides; i++) await sleep(1000);
  check('the report reached the draft call', !!overrides);
  const names = [...uploads.keys()];
  check('brief.json, replay.json and the stills were uploaded', uploads.has('brief.json') && uploads.has('replay.json') && names.some((f) => f.startsWith('replay-frames/')), JSON.stringify(names));

  // The case folder, as the eval reads it (the videos are left out: the writer never reads them).
  const outDir = path.join(process.env.CASES_OUT, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [file, bytes] of uploads) {
    if (/\.webm$/.test(file)) continue;
    const dest = path.join(outDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (/\.json$/.test(file) && bytes.length > 256 * 1024) fs.writeFileSync(dest + '.gz', zlib.gzipSync(bytes));
    else fs.writeFileSync(dest, bytes);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'overrides.json'), JSON.stringify(overrides ?? {}, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'expect.json'), JSON.stringify(C.expect, null, 2) + '\n');
  console.log(`wrote ${outDir}`);
}

main().catch((e) => { console.error(e); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  chrome.kill(); server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
```

- [ ] **Step 3: `extension/test/e2e/record-cases.mjs`** (the driver)

```js
// Records the ticket eval's cases (web/scripts/ticket-eval/cases): each page in
// cases.mjs, in its own fresh browser (the replay keeps the last minute of every
// watched tab, so cases must not share one), through the real extension's
// one-click report.
//
//   CHROME_PATH=/path/to/chrome-for-testing node extension/test/e2e/record-cases.mjs [case ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const casesUrl = pathToFileURL(path.join(here, 'cases.mjs')).href;
const { CASES } = await import(casesUrl);
const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(CASES);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-cases-'));
const script = path.join(work, 'record-case.mjs');
fs.writeFileSync(script, `${fs.readFileSync(path.join(here, '_harness.mjs'), 'utf8')}\n${fs.readFileSync(path.join(here, '_record-case.mjs'), 'utf8')}`);
const out = path.resolve(here, '..', '..', '..', 'web', 'scripts', 'ticket-eval', 'cases');
let failed = 0;
for (const name of names) {
  if (!CASES[name]) { console.error(`no case "${name}" (have: ${Object.keys(CASES).join(', ')})`); process.exit(2); }
  console.log(`\n=== ${name}`);
  const r = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, BRIEF_EXTENSION_DIR: path.resolve(here, '..', '..'), CASE: name, CASES_URL: casesUrl, CASES_OUT: out },
    timeout: 5 * 60 * 1000,
  });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: README.** Append to `extension/test/e2e/README.md`:

```markdown
## Ticket eval cases

`record-cases.mjs` records the cases the ticket eval scores (`web/scripts/ticket-eval/`):
each page in `cases.mjs` has one planted bug; the script does what a user would on it
and takes the last minute as a one-click report, in a fresh browser per case, and writes
what the extension uploaded to `web/scripts/ticket-eval/cases/<case>/`.

    CHROME_PATH=<chrome for testing> node extension/test/e2e/record-cases.mjs [case ...]
```

- [ ] **Step 5: Record all cases.** From the repo root (CfT at the session scratchpad `cft/`):

Run: `CHROME_PATH=<scratchpad>/cft/chrome/win64-155.0.8059.39/chrome-win64/chrome.exe node extension/test/e2e/record-cases.mjs`
Expected: `2/2 passed` for each of the 8 cases; `web/scripts/ticket-eval/cases/<case>/` holds `brief.json`, `replay.json` (or `.gz`), `replay-frames/frame-*.jpg`, `overrides.json` (with `"autoReport": true`), `expect.json`.

Then check the captures are right before trusting them:
- `node -e` read each `replay.json` and confirm its `marks` (Brief noticed …) match the planted bug where one exists: save-500 notes a `PUT /api/cases/42 failed (500`, stuck-spinner a `GET /api/projects failed (504`, slow-search a `GET /api/search… took 9.`s, dead-button a rage click.
- Open two stills (Read tool) to confirm the page is drawn.
- `du -sh web/scripts/ticket-eval/cases` stays under ~10 MB.

If a case lacks stills or marks, fix the flow timing in `cases.mjs` and re-record that case only.

- [ ] **Step 6: Commit**

```bash
git add extension/test/e2e/cases.mjs extension/test/e2e/_record-case.mjs extension/test/e2e/record-cases.mjs extension/test/e2e/README.md web/scripts/ticket-eval/cases
git commit -m "test: planted-bug pages recorded as ticket eval cases"
```

---

### Task 5: Baseline

- [ ] **Step 1: Run the eval on today's writer**

Run (from `web/`): `npx tsx scripts/ticket-eval/run.ts --label baseline --env C:/Users/razif/src_perso/brief-cloud/web/.env.local`
Expected: a table of 16 rows (8 cases x 2 variants) and a TOTAL line; `results/<time>-baseline.json` saved. Copy the table and TOTAL line into the scratchpad file `eval-log.md` (for the PR description).

- [ ] **Step 2: Read the worst tickets.** Open the results JSON, read every ticket with `named` 0 or `inventedBug` true, and note in `eval-log.md` what went wrong (one line each). No commit.

---

### Task 6: Reasoning params for the Responses API

**Files:**
- Modify: `web/lib/agent/model.ts`, `web/lib/agent/model.test.ts`

- [ ] **Step 1: Failing tests.** Append to `model.test.ts` (and import `responsesParams`, `reasoningEffort`; add `delete process.env.AGENT_REASONING;` to the existing `afterEach`):

```ts
describe("responsesParams", () => {
  test("gpt-5.6 reasons at low by default, its reasoning carried back encrypted", () => {
    expect(responsesParams("gpt-5.6-luna")).toEqual({ reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] });
  });

  test("AGENT_REASONING sets the effort; anything else falls back to low", () => {
    process.env.AGENT_REASONING = "medium";
    expect(reasoningEffort()).toBe("medium");
    expect(responsesParams("gpt-5.6-luna").reasoning).toEqual({ effort: "medium" });
    process.env.AGENT_REASONING = "turbo";
    expect(reasoningEffort()).toBe("low");
  });

  test("gpt-4o has no reasoning: it gets nothing", () => {
    expect(responsesParams("gpt-4o")).toEqual({});
    expect(responsesParams("gpt-4o-mini")).toEqual({});
  });

  test("gpt-5.0 has no 'none': it gets 'minimal'", () => {
    expect(responsesParams("gpt-5", "none").reasoning).toEqual({ effort: "minimal" });
    expect(responsesParams("gpt-5.4", "none").reasoning).toEqual({ effort: "none" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`responsesParams is not a function`). `npx vitest run lib/agent/model.test.ts`

- [ ] **Step 3: Implement** (append to `model.ts`):

```ts
export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** How hard the ticket writers think: AGENT_REASONING, low unless set. */
export function reasoningEffort(): ReasoningEffort {
  const v = (process.env.AGENT_REASONING || "").trim().toLowerCase();
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : "low";
}

/**
 * Extra params for /v1/responses, where gpt-5.6 takes function tools AND
 * reasoning. A model that reasons gets the effort, and its reasoning back
 * encrypted so a tool loop with store:false keeps its thinking turn to turn.
 * gpt-4o has no reasoning and gets nothing; gpt-5.0's lowest is 'minimal'.
 */
export function responsesParams(
  model: string,
  effort: ReasoningEffort = reasoningEffort(),
): { reasoning?: { effort: ReasoningEffort | "minimal" }; include?: Array<"reasoning.encrypted_content"> } {
  if (!/^(?:gpt-(?:5|[6-9])|o\d)/.test(model)) return {};
  const e = effort === "none" && /^gpt-5(?:-|$)/.test(model) ? "minimal" : effort;
  return { reasoning: { effort: e }, include: ["reasoning.encrypted_content"] };
}
```

Update the file's header comment line "Which OpenAI chat model each path uses" to "Which OpenAI model each path uses, and the request params it needs, in one place." and the `chatParams` comment's first line to "Extra params for /v1/chat/completions (the in-page assistant).".

- [ ] **Step 4: Run, expect PASS.** `npx vitest run lib/agent/model.test.ts`

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/model.ts web/lib/agent/model.test.ts
git commit -m "feat(web): reasoning params for the Responses API (AGENT_REASONING, low by default)"
```

---

### Task 7: The Responses API helpers

**Files:**
- Create: `web/lib/agent/responses.ts`, `web/lib/agent/responses.test.ts`

- [ ] **Step 1: Failing tests** `web/lib/agent/responses.test.ts`

```ts
import { expect, test, vi } from "vitest";
import { respondJson, runToolLoop, streamText, text } from "./responses";

const clientWith = (create: ReturnType<typeof vi.fn>) => ({ responses: { create } }) as never;
const call = (name: string, args: object, id = "c1") => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const tools = [{ name: "lookup", description: "Look it up", parameters: { type: "object", properties: {} } }];

test("each tool result goes back with the turn's own items (reasoning included), until the model answers in text", async () => {
  const reasoning = { type: "reasoning", id: "r1", summary: [], encrypted_content: "enc" };
  const create = vi.fn()
    .mockResolvedValueOnce({ output: [reasoning, call("lookup", { q: "x" })], output_text: "" })
    .mockResolvedValueOnce({ output: [{ type: "message" }], output_text: "done" });
  const onCall = vi.fn(async () => ({ hits: 1 }));
  const out = await runToolLoop({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("hi")], tools, maxTurns: 5, onCall });
  expect(out).toBe("done");
  expect(onCall).toHaveBeenCalledWith("lookup", { q: "x" });
  const first = create.mock.calls[0][0];
  expect(first).toMatchObject({
    model: "gpt-5.6-luna", instructions: "sys", store: false,
    reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"],
    tools: [{ type: "function", name: "lookup", description: "Look it up", strict: false }],
  });
  expect(first.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
  expect(create.mock.calls[1][0].input.slice(1)).toEqual([
    reasoning, call("lookup", { q: "x" }), { type: "function_call_output", call_id: "c1", output: JSON.stringify({ hits: 1 }) },
  ]);
});

test("a tool that throws answers the model with its error instead of ending the run", async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({ output: [call("lookup", {})], output_text: "" })
    .mockResolvedValueOnce({ output: [], output_text: "ok" });
  await runToolLoop({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "", content: [], tools, maxTurns: 5, onCall: async () => { throw new Error("no such team"); } });
  expect(create.mock.calls[1][0].input.at(-1)).toEqual({ type: "function_call_output", call_id: "c1", output: JSON.stringify({ error: "no such team" }) });
});

test("a failed turn stops quietly when onTurnError says so, and throws otherwise", async () => {
  const boom = vi.fn().mockRejectedValue(new Error("502"));
  await expect(runToolLoop({ client: clientWith(boom), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null, onTurnError: () => true })).resolves.toBe("");
  await expect(runToolLoop({ client: clientWith(boom), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null })).rejects.toThrow("502");
});

test("the loop gives up after maxTurns", async () => {
  const create = vi.fn().mockResolvedValue({ output: [call("lookup", {})], output_text: "" });
  await runToolLoop({ client: clientWith(create), model: "m", instructions: "", content: [], tools, maxTurns: 3, onCall: async () => null });
  expect(create).toHaveBeenCalledTimes(3);
});

test("respondJson asks for a strict JSON schema and returns the parsed answer with its usage", async () => {
  const create = vi.fn().mockResolvedValue({ output_text: '{"title":"T","description":"D"}', usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } } });
  const schema = { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"], additionalProperties: false };
  const r = await respondJson<{ title: string; description: string }>({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("x")], name: "ticket", schema });
  expect(r).toEqual({ value: { title: "T", description: "D" }, usage: { input: 10, output: 5, reasoning: 2 } });
  expect(create.mock.calls[0][0]).toMatchObject({ store: false, reasoning: { effort: "low" }, text: { format: { type: "json_schema", name: "ticket", strict: true, schema } } });
});

test("streamText yields only the text as it arrives", async () => {
  async function* events() {
    yield { type: "response.created" };
    yield { type: "response.output_text.delta", delta: "He" };
    yield { type: "response.output_text.delta", delta: "llo" };
    yield { type: "response.completed" };
  }
  const create = vi.fn().mockResolvedValue(events());
  const parts: string[] = [];
  for await (const d of streamText({ client: clientWith(create), model: "gpt-5.6-luna", instructions: "sys", content: [text("x")] })) parts.push(d);
  expect(parts).toEqual(["He", "llo"]);
  expect(create.mock.calls[0][0]).toMatchObject({ stream: true, store: false, reasoning: { effort: "low" } });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found). `npx vitest run lib/agent/responses.test.ts`

- [ ] **Step 3: Implement `web/lib/agent/responses.ts`**

```ts
import type OpenAI from "openai";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { errorMessage } from "@/lib/errors";
import { responsesParams } from "./model";

// The ticket writers talk to OpenAI through /v1/responses: gpt-5.6 takes
// function tools there WITH reasoning (chat completions refuses the two
// together). Nothing is stored at OpenAI (store:false), so a tool loop carries
// the model's encrypted reasoning from turn to turn itself.

/** One part of the user's message: text, or an image as a data URL. */
export type Part = ResponseInputContent;
export const text = (t: string): Part => ({ type: "input_text", text: t });
export const image = (url: string): Part => ({ type: "input_image", image_url: url, detail: "auto" });

/** A function the model may call: JSON-schema parameters, as in chat completions. */
export type FunctionDef = { name: string; description?: string; parameters: Record<string, unknown> };
export type Usage = { input: number; output: number; reasoning: number };

const toTools = (defs: FunctionDef[]): FunctionTool[] =>
  defs.map((d) => ({ type: "function", name: d.name, description: d.description ?? null, parameters: d.parameters, strict: false }));

const usageOf = (u?: ResponseUsage | null): Usage | undefined =>
  u ? { input: u.input_tokens, output: u.output_tokens, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 } : undefined;

/**
 * Runs the model with tools until it answers without calling one (or maxTurns).
 * Every turn's output (reasoning, text, calls) goes back as input with each
 * call's result; a tool that throws answers the model with { error }. A turn
 * whose request fails throws, unless onTurnError returns true (stop quietly).
 * Returns the model's last text.
 */
export async function runToolLoop(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  tools: FunctionDef[];
  maxTurns: number;
  onCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onTurnError?: (e: unknown) => boolean;
}): Promise<string> {
  const input: ResponseInputItem[] = [{ role: "user", content: opts.content }];
  const tools = toTools(opts.tools);
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    let resp;
    try {
      resp = await opts.client.responses.create({
        model: opts.model,
        instructions: opts.instructions,
        input: [...input],
        tools,
        store: false,
        ...responsesParams(opts.model),
      });
    } catch (e) {
      if (opts.onTurnError?.(e)) return "";
      throw e;
    }
    input.push(...(resp.output as ResponseInputItem[]));
    const calls = resp.output.filter((o): o is ResponseFunctionToolCall => o.type === "function_call");
    if (!calls.length) return resp.output_text ?? "";
    for (const c of calls) {
      let result: unknown;
      try {
        result = await opts.onCall(c.name, c.arguments ? JSON.parse(c.arguments) : {});
      } catch (e) {
        result = { error: errorMessage(e) };
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output: JSON.stringify(result ?? null) });
    }
  }
  return "";
}

/** One answer as JSON matching `schema` (strict structured output). */
export async function respondJson<T>(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  name: string;
  schema: Record<string, unknown>;
}): Promise<{ value: T; usage?: Usage }> {
  const resp = await opts.client.responses.create({
    model: opts.model,
    instructions: opts.instructions,
    input: [{ role: "user", content: opts.content }],
    text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    store: false,
    ...responsesParams(opts.model),
  });
  return { value: JSON.parse(resp.output_text) as T, usage: usageOf(resp.usage) };
}

/** The answer's text as it is written. */
export async function* streamText(opts: {
  client: OpenAI;
  model: string;
  instructions: string;
  content: Part[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const stream = await opts.client.responses.create(
    {
      model: opts.model,
      instructions: opts.instructions,
      input: [{ role: "user", content: opts.content }],
      stream: true,
      store: false,
      ...responsesParams(opts.model),
    },
    { signal: opts.signal },
  );
  for await (const ev of stream as AsyncIterable<ResponseStreamEvent>) {
    if (ev.type === "response.output_text.delta") yield ev.delta;
  }
}
```

- [ ] **Step 4: Run, expect PASS; type-check.** `npx vitest run lib/agent/responses.test.ts` and `npx tsc --noEmit`. If the SDK's types disagree on a field name (e.g. `include` element type), fix the type in `model.ts`'s `responsesParams` return type to the SDK's `ResponseIncludable`, not with a cast in the call.

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/responses.ts web/lib/agent/responses.test.ts
git commit -m "feat(web): Responses API helpers - tool loop, JSON answer, text stream"
```

---

### Task 8: The filing agent on the Responses API

**Files:**
- Modify: `web/lib/agent/process-brief.ts`, `web/lib/agent/process-brief.test.ts`

- [ ] **Step 1: Update the tests first.** In `process-brief.test.ts`:
  - The mock becomes `default: class { responses = { create }; }`.
  - Helpers at the top:

```ts
const callTurn = (args: object) => ({ output: [{ type: "function_call", call_id: "call_1", name: "create_issue", arguments: JSON.stringify(args) }], output_text: "" });
const doneTurn = { output: [{ type: "message" }], output_text: "Filed." };
```

  - `beforeEach`: `create.mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Pay button 500s", description: "It 500s." })).mockResolvedValue(doneTurn);`
  - The first test becomes:

```ts
test("every turn of the filing agent asks gpt-5.6-luna on the Responses API, reasoning on, nothing stored", async () => {
  const result = await processBrief(brief as never, tracker);
  expect(result.ticketIdentifier).toBe("ENG-1");
  expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const [params] of create.mock.calls) {
    expect(params).toMatchObject({ model: "gpt-5.6-luna", store: false, reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] });
  }
});

test("a turn that fails after the issue exists keeps the issue (a retry would file it twice)", async () => {
  create.mockReset();
  create.mockResolvedValueOnce(callTurn({ targetId: "t1", title: "Pay button 500s", description: "It 500s." })).mockRejectedValue(new Error("502"));
  expect((await processBrief(brief as never, tracker)).ticketIdentifier).toBe("ENG-1");
});
```

  - In the two replay tests, `create.mockResolvedValueOnce({ choices: [...] })` becomes `create.mockResolvedValueOnce(callTurn({ ...the same arguments object... }))` and `.mockResolvedValue({ choices: [{ message: ... }] })` becomes `.mockResolvedValue(doneTurn)`.

- [ ] **Step 2: Run, expect FAIL** (`create` never called: the code still calls `chat.completions`). `npx vitest run lib/agent/process-brief.test.ts`

- [ ] **Step 3: Migrate `process-brief.ts`.**
  - Imports: remove `import type { ChatCompletionContentPart, ChatCompletionMessageParam } from "openai/resources/chat/completions";`; `import { agentModel, chatParams } from "./model";` becomes `import { agentModel } from "./model";`; add `import { runToolLoop, text, image, type FunctionDef, type Part } from "./responses";`.
  - `const openai = new OpenAI(...)` becomes `const client = new OpenAI(...)`.
  - `const tools = [ { type: "function" as const, function: { name, description, parameters } }, ... ]` becomes `const tools: FunctionDef[] = [ { name, description, parameters }, ... ]`: each of the 6 entries loses its `type: "function" as const, function: {` wrapper and one closing brace; the objects inside are unchanged.
  - `const briefText = { type: "text" as const, text: "brief.json:\n" + ... }` becomes `const briefText = text("brief.json:\n" + JSON.stringify(brief.json, null, 2));` (removed in Task 11).
  - `const tail: ChatCompletionContentPart[] = []` becomes `const tail: Part[] = []`, and every `tail.push({ type: "text", text: X })` becomes `tail.push(text(X))`.
  - `const storyboard: ChatCompletionContentPart[] = []` becomes `const storyboard: Part[] = []`; `storyboard.push({ type: "text", text: label }, { type: "image_url", image_url: { url: img.dataUrl } })` becomes `storyboard.push(text(label), image(img.dataUrl))`.
  - Replace the whole `runLoop` (from `const runLoop = async (userContent: ChatCompletionContentPart[])` through its closing `};`) with:

```ts
  const runLoop = async (content: Part[]): Promise<IssueResult> => {
    // Held in an object: the tool calls set it from inside the loop.
    const state: { created: IssueResult | null } = { created: null };
    // The loop runs past creation so the agent can verify (get_issue) and
    // repair (update_issue) until the preferences actually landed. It ends
    // when the model answers without tool calls, or at the turn cap.
    await runToolLoop({
      client,
      model,
      instructions: sys,
      content,
      tools,
      maxTurns: 14,
      // The issue already exists - a failed VERIFICATION turn must not lose
      // it (marking the brief failed would file a duplicate on retry).
      onTurnError: (e) => {
        if (!state.created) return false;
        console.warn("[agent] verification turn failed after creation - keeping the issue:", e);
        return true;
      },
      onCall: async (name, args) => {
        switch (name) {
          // ... the existing cases, moved here unchanged except:
          //  - `result = X; break;` becomes `return X;`
          //  - `created` becomes `state.created`
          //  - the default case: `return { error: "unknown tool" };`
        }
      },
    });
    if (!state.created) throw new Error("agent did not create an issue");
    return state.created;
  };
```

  The `onCall` body is the old `switch (tc.function.name)` with those three mechanical changes; the old per-call `try { ... } catch (e) { result = { error: errorMessage(e) }; }` is dropped (runToolLoop does it). In `create_issue`: `if (created) { result = { error: ... }; break; }` becomes `if (state.created) return { error: `issue ${state.created.identifier} already exists - use update_issue to change it` };`, `created = await tracker.fileIssue({...})` becomes `state.created = await tracker.fileIssue({...})`, and the case ends with `return state.created;`. In `get_issue` / `update_issue`, `created?.identifier` becomes `state.created?.identifier`.
  - The image fallback stays: `created = await runLoop(brief.images.length ? withImages : textOnly)` etc., unchanged (they are `Part[]` now).
  - `errorMessage` is still imported (used by the image fallback).

- [ ] **Step 4: Run, expect PASS; type-check.** `npx vitest run lib/agent/process-brief.test.ts` and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add web/lib/agent/process-brief.ts web/lib/agent/process-brief.test.ts
git commit -m "feat(web): the filing agent runs on the Responses API with reasoning on"
```

---

### Task 9: The draft writer and the live stream on the Responses API

**Files:**
- Modify: `web/lib/agent/compose-draft.ts`, `web/lib/agent/compose-draft.test.ts`, `web/app/api/briefs/[id]/stream/route.ts`, `web/app/api/briefs/[id]/stream/route.test.ts`

- [ ] **Step 1: Update the tests first.**

`compose-draft.test.ts`: mock `default: class { responses = { create }; }`; `beforeEach`: `create.mockResolvedValue({ output_text: JSON.stringify({ title: "Pay button 500s", description: "It 500s." }), usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8 } } });`. Tests:

```ts
test("the draft writer asks gpt-5.6-luna on the Responses API, reasoning on, for a JSON ticket", async () => {
  expect(await composeDraftTicket(brief as never)).toEqual({
    title: "Pay button 500s", descriptionMarkdown: "It 500s.", usage: { input: 100, output: 20, reasoning: 8 },
  });
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "gpt-5.6-luna", store: false, reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "ticket", strict: true } },
  });
});

test("an older model set through AGENT_MODEL gets no reasoning", async () => {
  process.env.AGENT_MODEL = "gpt-4o";
  await composeDraftTicket(brief as never);
  expect(create.mock.calls[0][0].model).toBe("gpt-4o");
  expect(create.mock.calls[0][0]).not.toHaveProperty("reasoning");
});
```

`route.test.ts`: mock `default: class { responses = { create }; }`;

```ts
async function* events(...parts: string[]) {
  yield { type: "response.created" };
  for (const delta of parts) yield { type: "response.output_text.delta", delta };
  yield { type: "response.completed" };
}
beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async () => events("# Pay button 500s\n", "It 500s."));
});
test("the live draft streams from gpt-5.6-luna on the Responses API, reasoning on", async () => {
  const req = new NextRequest("http://localhost/api/briefs/b1/stream", { method: "POST" });
  const res = await POST(req, { params: Promise.resolve({ id: "b1" }) });
  expect(await res.text()).toBe("# Pay button 500s\nIt 500s.");
  expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-luna", stream: true, store: false, reasoning: { effort: "low" } });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run lib/agent/compose-draft.test.ts "app/api/briefs/[id]/stream/route.test.ts"`

- [ ] **Step 3: Migrate `compose-draft.ts`.**
  - Imports: drop `ChatCompletionContentPart` and `chatParams`; add `import { respondJson, text, image, type Part, type Usage } from "./responses";`. `DraftResult.usage?: Usage`.
  - `buildStreamMessages` returns `{ system: string; user: Part[] }`; inside it `briefText` becomes `text(...)`, `tail: Part[]`, pushes become `tail.push(text(...))`, and the image map becomes `...brief.images.map((img) => image(img.dataUrl))`.
  - `composeDraftTicket`: drop the `tools` array. The TOOLING sentence `Call compose_ticket(title, description) exactly once with the finished ticket, then stop.` becomes `Return the finished ticket as JSON: { "title": ..., "description": ... }.`; the last tail text `Write the ticket now and call compose_ticket exactly once.` becomes `Write the ticket now.`. Content building as in `buildStreamMessages` (`text()`/`image()`). Add:

```ts
const TICKET_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Concise, specific issue title - the problem, not a summary." },
    description: { type: "string", description: "The Markdown body, following the writing rules." },
  },
  required: ["title", "description"],
  additionalProperties: false,
};
```

  and `run` becomes:

```ts
  const run = async (content: Part[]): Promise<DraftResult> => {
    const { value, usage } = await respondJson<{ title?: unknown; description?: unknown }>({
      client, model, instructions: sys, content, name: "ticket", schema: TICKET_SCHEMA,
    });
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const description = typeof value.description === "string" ? value.description : "";
    if (!title && !description) throw new Error("draft agent returned an empty ticket");
    return { title: title || "Untitled", descriptionMarkdown: description, usage };
  };
```

  with `const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });` replacing `openai`. Update the doc comment ("The model returns the ticket through a single forced compose_ticket call" becomes "The model returns the ticket as structured JSON").

- [ ] **Step 4: Migrate the stream route.** In `route.ts`: `import { agentModel, chatParams } from "@/lib/agent/model";` becomes `import { agentModel } from "@/lib/agent/model";`, add `import { streamText } from "@/lib/agent/responses";`, `const openai = new OpenAI(...)` becomes `const client = new OpenAI(...)`, and the body of the `try` in `start` becomes:

```ts
        for await (const delta of streamText({ client, model, instructions: system, content: user, signal: req.signal })) {
          full += delta;
          controller.enqueue(encoder.encode(delta));
        }
        await persist(full); // completed cleanly → persist the streamed result
```

- [ ] **Step 5: Run, expect PASS; full suite; type-check.** `npx vitest run` (all pass), `npx tsc --noEmit`, `npx eslint lib/agent app/api/briefs scripts/ticket-eval`.

- [ ] **Step 6: Commit**

```bash
git add web/lib/agent/compose-draft.ts web/lib/agent/compose-draft.test.ts "web/app/api/briefs/[id]/stream"
git commit -m "feat(web): drafts and the live draft stream run on the Responses API with reasoning on"
```

---

### Task 10: Eval with reasoning on (same prompt)

- [ ] **Step 1:** `npx tsx scripts/ticket-eval/run.ts --label reasoning-low --effort low --env C:/Users/razif/src_perso/brief-cloud/web/.env.local`
Expected: the table; compare to the baseline in `eval-log.md` (named, invented, seconds). Note the comparison there. No commit.

---

### Task 11: Cleaner input

**Files:**
- Modify: `web/lib/agent/context-block.ts`, `web/lib/agent/context-block.test.ts`, `web/lib/agent/process-brief.ts`, `web/lib/agent/compose-draft.ts`, their tests

- [ ] **Step 1: Failing tests.** Append to `context-block.test.ts`:

```ts
describe("buildContextBlock - what only the raw json had", () => {
  it("lists a screen recording's steps, each click with the page it was on", () => {
    const block = buildContextBlock({
      events: [
        { type: "nav", load: true, tMs: 0, url: "https://app.x/cases/42" },
        { type: "click", tMs: 3200, url: "https://app.x/cases/42", element: { text: "Save" } },
        { type: "key", tMs: 4100, url: "https://app.x/cases/42", key: "Enter" },
      ],
    });
    expect(block).toContain("RECORDING STEPS");
    expect(block).toContain("- 0:00 Opened app.x/cases/42");
    expect(block).toContain('- 0:03 Clicked "Save" (on https://app.x/cases/42)');
    expect(block).toContain("- 0:04 Pressed Enter (on https://app.x/cases/42)");
  });

  it("shows the reporter's own title", () => {
    expect(buildContextBlock({ name: "Checkout broken" })).toContain("REPORTER'S TITLE (their working title for the report):\nCheckout broken");
  });

  it("a one-click report puts the explaining suspect in Cause, and says plainly when nothing showed up", () => {
    const block = buildContextBlock({ autoReport: true });
    expect(block).toContain("Cause line");
    expect(block).toContain("no error showed up");
    expect(block).not.toMatch(/captured\b/);
  });
});
```

and to `process-brief.test.ts` and `compose-draft.test.ts` one test each:

```ts
test("the model reads the distilled sections, not the raw brief.json", async () => {
  await processBrief(brief as never, tracker);   // compose-draft: await composeDraftTicket(brief as never);
  const sent = JSON.stringify(create.mock.calls[0][0].input);
  expect(sent).not.toContain("brief.json:");
  expect(sent).toContain("The pay button returns a 500");
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run lib/agent/context-block.test.ts lib/agent/process-brief.test.ts lib/agent/compose-draft.test.ts`

- [ ] **Step 3: Implement in `context-block.ts`.**
  - Import: `import { techFromRecording, videoLogsForAgent } from "./tech-details";`.
  - Move `clockOf` out of `buildContextBlock` to module scope (same body).
  - Add at module scope:

```ts
const VERB: Record<string, string> = { open: "Opened", reload: "Reloaded", "go to": "Went to", click: "Clicked", key: "Pressed" };

/** A screen recording's clicks and page changes as steps, each click with the page it was on. */
function recordingStepLines(json: unknown): string[] {
  const td = techFromRecording(json);
  const pageAt = (t: number) => {
    let url = "";
    for (const p of td.pages) if (p.t <= t) url = p.url;
    return url;
  };
  return td.actions.slice(0, 40).map((a) => {
    const page = a.kind === "click" || a.kind === "key" ? pageAt(a.t) : "";
    return `- ${clockOf(a.t)} ${VERB[a.kind] ?? a.kind} ${a.what}${page ? ` (on ${page})` : ""}`;
  });
}
```

  - After the REPORTER'S DESCRIPTION section:

```ts
  if (typeof j.name === "string" && j.name.trim()) {
    sections.push("REPORTER'S TITLE (their working title for the report):\n" + j.name.trim().slice(0, 200));
  }
```

  - After the REPLAY section:

```ts
  const recSteps = recordingStepLines(j);
  if (recSteps.length) {
    sections.push(
      "RECORDING STEPS (what the reporter did during the screen recording, from its event log - use it for accurate steps to reproduce; typed values are not known):\n" +
        recSteps.join("\n"),
    );
  }
```

  - The ONE-CLICK REPORT text becomes:

```ts
      "ONE-CLICK REPORT (the reporter pressed one key the moment something went wrong and typed nothing): work out what went wrong from the SUSPECTS, the replay stills and the technical capture. " +
        "Write the ticket about the most likely failure: the title and summary say what the user saw go wrong, in product terms, and the suspect that explains it goes in the Cause line. " +
        "If nothing clearly failed, do NOT invent a bug: title it after what the reporter was doing (e.g. \"Checkout: unexpected behaviour after applying a coupon\"), describe the steps and what is visible, say plainly that no error showed up, and leave out the Cause line.",
```

  - The TECHNICAL CAPTURE header becomes `"TECHNICAL CAPTURE (exact, times are into the capture - if a call or error explains the bug, name it in the Cause line; the full list is appended to the ticket automatically, never write it yourself):\n"`.
  - The SUPPORTING TECHNICAL CONTEXT header becomes `"SUPPORTING TECHNICAL CONTEXT (console / network errors captured during the session - if one explains the bug, name it in the Cause line; do NOT let them define what the ticket is about or drive routing unless the reporter's description points at them):\n"`.

  Then in `process-brief.ts`: delete `const briefText = ...`; `const withImages = [briefText, ...storyboard, ...tail]` becomes `[...storyboard, ...tail]`; `const textOnly = [briefText, ...tail]` becomes `[...tail]`. In `compose-draft.ts`, the same in both `buildStreamMessages` (`const user = brief.images.length ? [...brief.images.map((img) => image(img.dataUrl)), ...tail] : tail;`) and `composeDraftTicket`. In both files' CORRELATE text, "the page events" stays (the steps sections carry them now).

- [ ] **Step 4: Check nothing else lived only in the raw json.** brief.json fields the extension writes (filing.js `buildBriefJsonAndMeta`, offscreen for recordings): `id, name, createdAt, source, description, transcript, pageUrl, pageTitle, userAgent, hasRecording, screenshots, includeVideo, extra, events, keyframes, recording`; processing adds `replay, techLogs, autoReport, recordingMarks, replayNote, includeReplay`. Each is either in the block now, given to the model another way (keyframes/screenshots/stills as images, includeVideo/recording via the evidence manifest), or bookkeeping (`id, createdAt, source, hasRecording`). Run `grep -n "j\.\w*" web/lib/agent/context-block.ts` and confirm `name`, `description`, `pageUrl`, `pageTitle`, `userAgent`, `replay`, `techLogs`, `recordingMarks`, `transcript`, `screenshots`, `extra`, `events`, `autoReport`, `replayNote` all appear.

- [ ] **Step 5: Run, expect PASS; full suite.** `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add web/lib/agent/context-block.ts web/lib/agent/context-block.test.ts web/lib/agent/process-brief.ts web/lib/agent/process-brief.test.ts web/lib/agent/compose-draft.ts web/lib/agent/compose-draft.test.ts
git commit -m "feat(web): the agent reads the distilled report, not the raw json; recording steps and the reporter's title added"
```

---

### Task 12: Plainer tickets (the prompt)

**Files:**
- Modify: `web/lib/agent/system-prompt.ts`, `web/lib/agent/process-brief.ts` (`SECTION_LABEL`), `web/lib/agent/process-brief.test.ts`

- [ ] **Step 1: Failing test** (append to `process-brief.test.ts`; import `normalizeSectionLabels`):

```ts
test("Summary and Cause written as plain lines become labels like the other sections", () => {
  expect(normalizeSectionLabels("Summary\nIt breaks.\n\nCause:\nThe save call returns 500.")).toBe("**Summary**\nIt breaks.\n\n**Cause**\nThe save call returns 500.");
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run lib/agent/process-brief.test.ts`

- [ ] **Step 3: `SECTION_LABEL`** in `process-brief.ts`: the alternation `(steps to reproduce|steps|expected...|errors?|console errors|network errors)` gains `|summary|cause|root cause` at the end.

- [ ] **Step 4: Rewrite parts of `SYSTEM_PROMPT`** in `system-prompt.ts`. The file comment's first line becomes `// System prompt for the ticket writers (filing, drafts, the live draft stream).` The prompt keeps every section not listed below verbatim. Changes:

  1. The opening paragraph becomes:

```
You are a QA lead turning a captured bug or feature report into exactly one tracker ticket, filed in the RIGHT place with the RIGHT fields, then stopping. Two people read the ticket: a PM or QA who triages it, and a developer who fixes it. Write so the first understands it without help and the second can act on it. The tracker varies (Linear, Jira, GitHub Issues, Azure DevOps, ClickUp, Trello, Notion); which one you are filing into, what a destination is called there, and how its body renders are stated under THIS TRACKER below. You decide every judgement call autonomously - NEVER ask the user anything.
```

  2. WHAT YOU'RE GIVEN becomes:

```
WHAT YOU'RE GIVEN
- Labelled sections describing the report; any of them may be missing: the reporter's typed description and title, the page and browser, the steps they took (from a replay or a screen recording), the technical capture (pages, failed or slow network calls, console errors), suspects found automatically, moments the reporter marked, the spoken narration, notes on screenshots, and extra fields.
- Zero or more images: time-ordered frames from a screen recording, stills from a replay (each with its page), and screenshots. On an annotated screenshot, RED markings are the reporter pointing at where the problem is - treat the red as a focus indicator, not part of the product UI.
```

  3. A new section right after SIGNAL PRIORITY:

```
FIND THE BUG FIRST (before writing anything)
- From all the evidence together, work out: what the reporter was trying to do; the first moment it went wrong (the step, frame or still where what happens stops matching what should happen); what proves it (a frame, a still, a failed or slow call, an error, text on the page); and what the user saw because of it.
- A failed call or an error matters when it lines up in time with that moment and explains what the user saw. One that happens elsewhere, or that changes nothing the user saw, is not the bug.
- If nothing clearly failed, say so. Never invent a failure, an error message or a cause the evidence doesn't show.
```

  4. WRITE IT LIKE A TEAMMATE FILED IT FROM SCRATCH becomes:

```
WRITE IT FOR THE TWO READERS
- Title: the problem as the user meets it, in product terms (e.g. "Saving a test case fails without any message"). No HTTP methods, paths, status codes or error names in the title.
- Description (Markdown). Use only the sections you can fill honestly - never pad, never invent details:
  - **Summary** - one or two sentences on what the user saw and why it matters, in product language. No HTTP methods, API paths, status codes, stack traces, exception names or call timings here: a PM must understand it without help.
  - **Steps to reproduce** - a numbered list, when the steps, events, narration or screens make the sequence clear. When the steps cross pages or tabs, say on the step where it changes which page it happens on (its path, e.g. "on /test-projects/<id>/test-cases").
  - **Expected** and **Actual** - one line each, for bugs. Actual is what the user saw, in product language.
  - **Cause** - one line, only when the technical capture or the suspects show what explains it: name the call or error plainly, with method, path, status or duration (e.g. "The save call (PUT /api/cases/42) returns 500." or "The search call (GET /api/search) takes 9.1 s."). Leave Cause out when nothing in the evidence explains it; never guess one. Do NOT list the calls, paste logs, or write a technical/logs/network section: the exact capture is appended to the ticket automatically, folded at the bottom.
  - For a feature request: the desired behaviour and the reason it matters, instead of Expected, Actual and Cause.
  - **Context** - ALWAYS include the page URL when one is present (and the browser if relevant). A teammate must be able to see where this happened. Write it as a Markdown link with the page title as its text - e.g. "**Context:** [Test Cases - Thunders App](https://app.thunders.ai/#/test-projects/…/test-cases)" - never a bare pasted URL.
  - Plain punctuation only: never use an em-dash or en-dash. Use periods, commas, colons, or parentheses instead. (Hyphens in compound words are fine.)
  - Do NOT narrate the screenshots in the body, and do NOT write an "Evidence" heading or section yourself - the system appends one, so writing your own produces the heading twice with the same caption repeated under it. Each screenshot gets its own caption via screenshot_notes and appears under that appended section. Reference them in prose only when it genuinely helps the story, never by file name.
- Keep it tight and skimmable. A short, correct ticket beats a long speculative one.
```

  (That replaces the old bullets "Title: concise and specific", "A one or two sentence summary", the old Steps/Expected/Actual/feature bullets, the "When the TECHNICAL CAPTURE shows a failed or slow call" bullet, and the old Context bullet; the punctuation, evidence and "keep it tight" bullets are carried over as shown.)

  5. In `compose-draft.ts`, both OUTPUT FORMAT / TOOLING sentences that say "following the WRITE IT LIKE A TEAMMATE rules" now say "following the WRITE IT FOR THE TWO READERS rules".

- [ ] **Step 5: Run, expect PASS; full suite; grep for stale references.**

Run: `npx vitest run`, `npx tsc --noEmit`, and `grep -rn "WRITE IT LIKE A TEAMMATE\|senior engineer\|compose_ticket" web/lib web/app` (expect no matches).

- [ ] **Step 6: Commit**

```bash
git add web/lib/agent/system-prompt.ts web/lib/agent/process-brief.ts web/lib/agent/process-brief.test.ts web/lib/agent/compose-draft.ts
git commit -m "feat(web): tickets lead with what the user saw; the technical cause gets one Cause line"
```

---

### Task 13: Eval low vs medium, choose the default, verify

- [ ] **Step 1: Both efforts.**

Run: `npx tsx scripts/ticket-eval/run.ts --label final-low --effort low --env <env>` then `--label final-medium --effort medium`.
Record both tables in `eval-log.md`. Read every ticket with named < 1 or inventedBug in the low run and note why.

- [ ] **Step 2: Choose.** Medium becomes the default only if its TOTAL `named` beats low's by at least 0.05 with no more invented bugs; then change `reasoningEffort()`'s fallback to `"medium"` and the matching test in `model.test.ts`/`responses.test.ts`/`process-brief.test.ts`/`compose-draft.test.ts`/`route.test.ts` (`effort: "medium"`), and commit `feat(web): ticket writers reason at medium by default`. Otherwise keep low.

- [ ] **Step 3: If the final run is not better than the baseline** on `named` and plain summaries, or invents a bug on `clean`: read the failing tickets, change one thing in the prompt or context block, rerun only the failing cases (`--case`), and repeat at most three times. Report honestly if it still isn't better.

- [ ] **Step 4: Full verification.**

Run (from `web/`): `npx vitest run` (all pass), `npx tsc --noEmit` (clean), `npx eslint .` (no new errors in touched files), and `node --env-file=C:/Users/razif/src_perso/brief-cloud/web/.env.local node_modules/next/dist/bin/next build --webpack` (green).

- [ ] **Step 5: One live draft through the real route** is out of reach without a signed-in session; the eval's drafts run the same `composeDraftTicket` the `/draft` route runs, so that is the end-to-end proof. Say so in the PR.

---

### Task 14: Pull request

- [ ] **Step 1:** Push and open the PR as razi2001 (see memory: pin the token per command).

```bash
GH_TOKEN=$(gh auth token -u razi2001) git push -u origin claude/ticket-quality-bug-findings-7170c6
GH_TOKEN=$(gh auth token -u razi2001) gh pr create --repo razi2001/brief-cloud --base main --title "Ticket quality: a scored test set, reasoning on, plainer tickets" --body-file <scratchpad>/pr-body.md
```

The body: what changed (the three parts), the eval tables (baseline, reasoning-low, final low/medium) and TOTAL lines, the chosen effort and the seconds it adds, what's out of scope (suspects everywhere, one-click speed), the deploy note (`AGENT_REASONING` optional, defaults to low; `fly deploy` needed), and the attribution line.

- [ ] **Step 2:** Bind the PR in the desktop app (`get_status`, then `bind_pr` if needed). Do not merge.
