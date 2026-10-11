# Ticket quality: a test set, reasoning on, plainer tickets

Date: 2026-10-11. Status: approved design, not built.

## Why

What Razi sees in real tickets:

1. **The real bug is sometimes missed.** The ticket is about the wrong thing, or Expected/Actual are guessed.
2. **The description is too technical.** The summary opens on a log line ("GET /api/test-cases took 7.9 s") instead of what the user saw.
3. **One-click reports are not efficient enough**: slow, wrong or no bug found, a thin draft, sometimes nothing captured.

What the code does today, and why it leads there:

- Every ticket writer (filing in `process-brief.ts`, drafts in `compose-draft.ts`, the live draft stream) runs gpt-5.6-luna with `reasoning_effort: 'none'`. It is forced: on `/v1/chat/completions`, gpt-5.6 refuses function tools at any other effort. So the hardest step, working out what broke from frames, logs and suspects, runs with no reasoning at all.
- The model reads the whole `brief.json` pretty-printed (every raw event, plus the technical log) before the distilled context block, so it sees the same facts twice, raw first.
- The system prompt casts the model as "a senior engineer" and tells it to name the failing call in the summary or under Actual. That is where the log-line summaries come from.
- Nothing measures ticket quality. Every prompt change so far shipped on feel.

## Scope

This change covers three of the five parts agreed:

1. A test set that scores ticket quality.
2. Reasoning on, by moving the ticket writers to the Responses API, with cleaner input.
3. Plainer tickets: product language first, one technical Cause line.

Out of scope, each its own later change:

4. Suspects found on every report (server side, for recordings and normal replays too), and better detection (alerts and toasts, validation errors, a 200 that carries an error, stuck spinners, linking a click to the call it fired).
5. One-click speed and capture reliability (time each step from key press to draft; fix the cases where it doesn't fire or the moment isn't in the last minute).

The in-page ticket assistant (`/api/briefs/[id]/chat`, `fastModel()`) is not touched: it must feel instant, so it stays on chat completions with no reasoning.

## 1. The ticket writers move to the Responses API

### The loop

A new `web/lib/agent/responses.ts` holds the one place that talks to `client.responses.create`:

- `reasoning: { effort }` from `reasoningEffort()` in `model.ts`, which reads a new `AGENT_REASONING` env (`none | low | medium | high`, default `low`).
- `store: false` and `include: ["reasoning.encrypted_content"]`. OpenAI keeps nothing (the screenshots included), and the encrypted reasoning items from each turn are passed back as input on the next, so the model keeps its thinking across tool calls.
- Inputs: `input_text` and `input_image` (data URLs) parts, in the same order as today's storyboard.
- Tools: today's function definitions, reshaped to the Responses form (`{ type: "function", name, description, parameters }`).
- Turn handling: run `function_call` output items through a caller-supplied handler, append each `function_call_output` (matched by `call_id`), loop until a turn has no function calls or the turn cap (14) is reached.

`chatParams()` stays, for the assistant only.

### The three callers

- **Filing** (`process-brief.ts`): same tools, same order of work (search for precedent, pick the destination, create, read back, repair). The tool switch and every evidence rule stay as they are; only the transport changes. Kept behaviours: a failed turn after `create_issue` keeps the issue (never filed twice); a refused image retries the whole run text-only.
- **Draft** (`compose-draft.ts` `composeDraftTicket`): no tools. The title and body come back as structured output (`text.format` with a JSON schema `{ title, description }`) instead of a forced `compose_ticket` call.
- **Live draft stream** (`/api/briefs/[id]/stream` via `buildStreamMessages`): `responses.stream`, forwarding `response.output_text.delta` events as today's text deltas. The first words arrive later (the model thinks first); the page already shows "Writing…" until then.

### Risks to check first

- A live probe before any rewrite: gpt-5.6-luna on `/v1/responses` with `reasoning.effort: "low"`, one function tool, one image, `store: false` plus encrypted reasoning, two turns. If the account's models refuse any of that, stop and report before building on it.
- The installed `openai` SDK (6.42.x) types stop at gpt-5.4; model ids are plain strings, so this only needs a cast, not an upgrade.

## 2. What the agent reads and how it writes

### Input

- The pretty-printed `brief.json` is no longer sent. The context block (`buildContextBlock`) becomes the whole text input, with the images as today.
- Facts that only lived in the raw JSON get their own section in the block. Known one: a screen recording's clicks and key presses (`techFromRecording` collects them as `actions`, but `techForAgent` never prints them). A new **RECORDING STEPS** section lists them like the replay's steps (time, what was clicked or typed into, page). Typed values stay masked.
- Before dropping the dump, every top-level `brief.json` field the extension writes is checked against the block, and anything useful that isn't covered gets a section. The test set catches a regression here.

### Prompt

- The persona changes from "a senior engineer" to a QA lead writing for two readers: a PM or QA who triages it, and a developer who fixes it.
- A new **FIND THE BUG FIRST** section: before writing, work out what the user was trying to do, the first moment it went wrong, and which frame, still, call or error proves it. If nothing clearly failed, say so; never invent a failure.
- The body becomes:
  - **Summary**: what the user saw and why it matters, in product language. No HTTP methods, paths, status codes, stack traces or error identifiers.
  - **Steps to reproduce**, **Expected**, **Actual**: Actual is what the user saw, in product language.
  - **Cause**: one technical line, only when the evidence shows one, e.g. "The save call (POST /api/cases) returns 500." Omitted otherwise.
  - **Context**: the page link, as today.
  - The full technical log stays folded at the bottom, appended by the tracker, as today.
- The rule "name the call in the summary or under Actual" is replaced by "name it in Cause".
- The one-click section of the context block follows the same rules: the Summary and Actual describe what the user saw; the suspect that explains it goes in Cause.
- `normalizeSectionLabels` learns `Cause` and `Summary`.

## 3. The test set

### Cases

`web/scripts/ticket-eval/cases/<case>/` holds one capture, laid out exactly like storage (`brief.json`, `screenshots/`, `keyframes/`, `replay.json`, `replay-frames/`; the rendered `replay.webm` is left out, the writer never reads it), plus `expect.json`:

```json
{
  "bug": "Saving a test case fails: the save call returns 500 and the form shows no error.",
  "kind": "failure",
  "variants": [
    { "name": "one-click" },
    { "name": "described", "description": "can't save my test case" }
  ]
}
```

- `kind` is `failure` (something in the capture explains it), `ui` (visible only, nothing in the logs) or `none` (nothing is wrong).
- A variant overrides `brief.json` fields the way the popup's edits do (`mergeBriefOverrides`), so the same capture is scored both as a one-click report and as a report with a short typed description.

Eight planted-bug pages, served by the e2e harness's local test site and captured once through the real extension (one-click report, uploads intercepted and written to the case folder by a `record-cases` suite):

| Case | Planted bug | kind |
|---|---|---|
| save-500 | Save returns 500, the form says nothing | failure |
| save-200-error | Save returns 200 with `{ "error": ... }`, nothing happens, the setting is off again after a reload | ui (the capture keeps response bodies of failed calls only, so nothing in the logs shows this one; part 4) |
| validation | The form rejects a valid email with a red message | ui |
| stuck-spinner | A list never loads: its call fails (504) and the spinner keeps turning (a call that never answers would leave no trace in the capture) | failure |
| dead-button | "Export" does nothing when clicked, no call, no error | ui |
| layout | A row's text overlaps the next column | ui |
| slow-search | Search takes 9 s to show results | failure |
| clean | A normal flow, nothing wrong | none |

Razi's own recent drafts can be added under `cases/local/` (gitignored, never committed): drafts keep all their media; filed briefs don't (`brief.json` is deleted after filing).

The planted cases are all one-click replays (a screen recording needs a real tab capture, which the harness only fakes). The new RECORDING STEPS section is therefore covered by unit tests, and by a local draft with a recording when one is added.

### Reading a case

`loadBriefInput` takes a small storage interface (`download(path)`, `list(prefix)`) instead of the Supabase client. Production passes a wrapper over the `briefs` bucket; the eval passes one over a case folder. No other change to how evidence is assembled.

### Runner

`npm run eval:tickets` (in `web/`, run by hand, needs `OPENAI_API_KEY`; not in CI since it costs calls) writes a draft for every case and variant three times through `composeDraftTicket`, then scores each:

- **Checks in code**: Steps, Expected and Actual present (kinds `failure`, `ui`); Context link present; no banned words; no em or en dashes; the Summary has no HTTP method, path, status code or stack-trace text; Cause present when `kind` is `failure`, absent when `none` (not checked for `ui`, where a frontend cause may or may not be visible).
- **A judge call** (the same model, reasoning `medium`, given the ticket and `expect.json`): did the ticket name the planted bug (yes, partly, no); for `none`, did it invent one.
- **Cost**: seconds and tokens per draft.

Output: a table per case and variant, totals, and a JSON file under `web/scripts/ticket-eval/results/` (gitignored). `--effort low|medium` and `--case <name>` flags.

### Success

- A baseline run on today's code, before anything else changes.
- After the change: more planted bugs named than the baseline; no invented bug on `clean` in any run; a plain-language Summary in every run.
- `low` vs `medium` effort: medium becomes the default only if it names more bugs than low; the seconds it adds are reported either way.

## Order of work

1. The storage interface for `loadBriefInput`, the planted-bug pages, the `record-cases` suite, the cases, the runner. Baseline run.
2. The live Responses API probe, then `responses.ts` and the three callers. Existing tests pass; eval rerun (same prompt, reasoning on).
3. Input cleanup and the prompt rewrite. Eval rerun, `low` vs `medium`.
4. Results written into the PR description.

## Files

- New: `web/lib/agent/responses.ts`, `web/scripts/ticket-eval/` (runner, scoring, cases), the planted-bug pages and the `record-cases` suite under `extension/test/e2e/`.
- Changed: `web/lib/agent/model.ts`, `process-brief.ts`, `compose-draft.ts`, `context-block.ts`, `system-prompt.ts`, `run-processing.ts`, `web/app/api/briefs/[id]/stream/route.ts`, `web/package.json`, `.gitignore`.
- Tests: unit tests for the Responses loop (mocked client: tool round trip, reasoning items passed back, created-then-failed keeps the issue, image refusal falls back), the new context-block section, the section labels, and the eval's code checks.
