# How-to Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Guide tab in Brief Cloud that teaches every feature with animated mockups, numbered steps and live examples (a practice app with planted bugs plus in-page sandboxes).

**Architecture:** Lesson content is data (`web/lib/guide/lessons.ts`); a client scene player animates on-brand mockups per lesson; progress = server-known facts + tried flags in localStorage. Practice pages are public Next routes with their own route handlers that reproduce the bugs. The extension (1.4.1) watches `APP_URL/practice/*` for Replay and answers a version ping.

**Tech Stack:** Next 16 App Router, React 19, Tailwind 4, vitest + @testing-library (jsdom), Chrome MV3 extension (ES modules, `node --test`).

Spec: `docs/superpowers/specs/2026-10-12-how-to-guide-design.md`.

Execution note: run inline (the user asked for momentum). Commands assume cwd `web/` unless stated.

---

## File map

| File | Responsibility |
|---|---|
| `web/lib/guide/lessons.ts` | Lesson data: groups, slugs, titles, blurbs, steps, scene key, try-it, auto key. `lessonBySlug`, `neighbours`. |
| `web/lib/guide/progress.ts` | Pure progress: `isDone`, `countDone`, `parseTried`, `addTried`. |
| `web/lib/guide/practice.ts` | Practice page registry (slug, title, bug, lesson). Shared by pages, lessons, tests. |
| `web/lib/guide/status-server.ts` | `getGuideStatus(userId)` → auto-done facts. |
| `web/components/guide/useGuideProgress.ts` | localStorage hook (`briefGuideTried`). |
| `web/components/guide/useExtensionVersion.ts` | Pings the extension, returns `{state, version}`. |
| `web/components/guide/useScene.ts` | Scene player hook (frames, loop, pause off-screen, reduced motion, jump). |
| `web/components/guide/mock/*.tsx` | Mockup kit: Stage, BrowserFrame, Cursor, MockPopup, MockChooser, MockBar, MockToast, MockAcme, MockEditor, MockTicket, Kbd. |
| `web/components/guide/scenes/*.tsx` + `index.ts` | One scene per lesson; registry `SCENES` keyed by `SceneKey`. |
| `web/components/guide/sandboxes/*.tsx` | DrawSandbox, TrimSandbox, EditorSandbox, AssistantSandbox (+ sample ticket data). |
| `web/components/guide/GuideHub.tsx` | Hub (client). |
| `web/components/guide/LessonView.tsx` | Lesson page body (client): scene + synced steps + Try it + prev/next. |
| `web/components/guide/TryIt.tsx` | The Try it panel per kind (practice / sandbox / link / mark). |
| `web/app/(main)/guide/page.tsx`, `[slug]/page.tsx`, `guide.css` | Routes. |
| `web/app/practice/layout.tsx`, `page.tsx`, `checkout|pricing|search|profile/page.tsx`, `api/pay/route.ts`, `api/search/route.ts`, `practice.css` | Practice app. |
| `web/components/Nav.tsx` | + Guide item. |
| `web/proxy.ts` | `/practice(.*)` public. |
| `extension/practice.js` (+ test) | `isPracticeUrl`, `practiceMenuPattern`. |
| `extension/replay-sites.js`, `extension/background.js`, `extension/manifest.json` | Watch practice pages, ping, 1.4.1. |

## Tasks

### Task 1: Lesson data, practice registry, progress (TDD)
- [ ] Write `web/lib/guide/lessons.test.ts`: 14 lessons; unique slugs; every `group` in `GROUPS`; `neighbours(slug)` returns prev/next in order (first has no prev, last no next); every `tryIt.kind === "practice"` names a page in `PRACTICE_PAGES`; no `—` or `–` in any title/blurb/step; steps 3 to 5 each.
- [ ] Write `web/lib/guide/progress.test.ts`: `parseTried` survives junk JSON / non-arrays / unknown slugs; `addTried` dedupes; `isDone` true by auto fact or tried; `countDone` counts both without double-counting.
- [ ] Run `npx vitest run lib/guide` → FAIL (modules missing).
- [ ] Implement `lessons.ts`, `practice.ts`, `progress.ts`.
- [ ] Run → PASS. Commit `feat(web): guide lesson data and progress`.

### Task 2: Practice app (TDD for the API)
- [ ] Write `web/app/practice/api/practice-api.test.ts`: `POST` pay → 500, body `{error:"payment service timeout"}` (fake timers); `GET` search with `?q=` → 504 after the hold (fake timers); search with an aborted request resolves early.
- [ ] Run → FAIL. Implement `api/pay/route.ts`, `api/search/route.ts`. → PASS.
- [ ] Pages: layout (Acme header, practice chip linking to the lesson), index, checkout (Pay → POST, resets silently), pricing (Team price overflows), search (fetch never shown; spinner forever), profile (Save handler bound to a hidden element). `practice.css` scoped under `.acme`.
- [ ] `proxy.ts`: add `"/practice(.*)"` to `isPublic`.
- [ ] Commit `feat(web): practice app with four planted bugs`.

### Task 3: Extension 1.4.1 (TDD for practice.js)
- [ ] Write `extension/test/practice.test.mjs`: `isPracticeUrl` true for `APP_URL/practice`, `/practice/checkout?x`, false for `/practiceX`, `/tickets`, other hosts, junk; `practiceMenuPattern()` → `<scheme>://<hostname>/practice*`.
- [ ] Run `node --test extension/test/practice.test.mjs` → FAIL. Implement `extension/practice.js` → PASS.
- [ ] `replay-sites.js` `isWatched`: practice URLs watched. `background.js`: menu patterns include the practice pattern (menu exists even with no sites), `purgeUnwatchedReplay` keeps practice chunks, `brief-cloud-ping` → `{ok:true, version}`. Manifest 1.4.1.
- [ ] `.mjs` syntax check of changed modules (copy to `.mjs`, `node --check`); run existing `node --test extension/test/*.test.mjs`.
- [ ] Commit `feat(extension): practice pages are recorded for Replay; version ping; 1.4.1`.

### Task 4: Scene player + mockup kit
- [ ] Write `web/components/guide/useScene.test.tsx` (jsdom, fake timers): advances frames by `ms`, loops, `jump(i)` sets the frame and keeps playing from there, reduced motion holds the frame.
- [ ] Implement `useScene.ts` → PASS.
- [ ] Mockup kit components (pure presentational, `cqw` units inside `Stage`).
- [ ] `guide.css` (scoped `.gd-*`: cursor, click ripple, waveform, toast, keyframes).
- [ ] Commit.

### Task 5: Scenes (one per lesson) + registry
Scenes and their frames (step index in brackets):
- `connect`: Settings tracker row → picker (Linear/Jira/GitHub) [0] → click Linear [1] → OAuth sheet "Allow" [2] → row shows green Connected [3].
- `install`: browser toolbar, puzzle icon [0] → pin Brief [1] → click Brief icon, popup opens [2] → pairing tab "Connected" [3].
- `record`: popup, click + [0] → chooser, click Video [1] → countdown 3 2 1 [2] → bar recording, waveform + timer, Acme page cursor clicks Pay [3] → click Stop, Video tile lands in Evidence [4].
- `screenshots`: + → Screenshot [0] → annotator over Acme pricing, pen circles the price [1] → caption typed [2] → tile with caption [3].
- `upload`: + → Upload [0] → file picker row "bug.mp4" [1] → tile lands [2].
- `replay`: Acme search spinner (watched dot on icon) [0] → + → Replay [1] → editor with the last 60 s, handles trim [2] → Add to brief, tile [3].
- `briefit`: Acme profile, Save clicked twice, nothing [0] → keys Alt Shift B [1] → toast "Reporting…" [2] → toast "Draft queued" [3] → Drafts row appears [4].
- `evidence`: editor filmstrip, handles drag [0] → split S [1] → crop box [2] → flag mark with note [3].
- `create`: popup filled, Create ticket pressed [0] → "Queued" check [1] → Tickets row "Filing…" → "Todo" with tracker id [2]; alt: Save as draft [3].
- `editticket`: ticket text, selection appears [0] → toolbar [1] → Improve [2] → paragraph swaps, "Saved" [3].
- `assistant`: Cmd K [0] → panel with chips [1] → click "Add repro steps" [2] → section added, Undo shown [3].
- `rules`: Settings Ticket rules editor typing "Label: bug, Priority: high" [0] → Save [1] → ticket preview shows label + priority [2].
- `sites`: Settings Replay, type `app.acme.com` [0] → Add [1] → browser icon gets green dot on that site [2].
- `tickets`: Tickets list rows, status pills sync [0] → filter chip [1] → Home podium [2].
- [ ] Registry test in `lessons.test.ts` (every lesson's `scene` is a key of `SCENES`).
- [ ] Commit.

### Task 6: Sandboxes (TDD)
- [ ] `sandboxes.test.tsx` (jsdom): Trim: ArrowRight on start handle moves it, readout changes, `onUsed` fires once. Draw: pointerdown/move/up adds a stroke, Undo removes it, `onUsed` fires. Assistant: clicking "Add repro steps" adds the section, Undo removes it, Redo restores. Editor: Improve on a selection inside paragraph 1 swaps it for the improved text; Undo restores.
- [ ] Implement the four sandboxes + `sample-ticket.ts`. → PASS. Commit.

### Task 7: Pages, hub, lesson view, nav, status
- [ ] `status-server.ts` (best-effort, parallel).
- [ ] `useGuideProgress.ts`, `useExtensionVersion.ts`.
- [ ] `GuideHub.tsx`, `LessonView.tsx`, `TryIt.tsx`.
- [ ] Routes `app/(main)/guide/page.tsx`, `[slug]/page.tsx` (`notFound()` for unknown slugs; `generateStaticParams` not used since pages read the session).
- [ ] Nav: Guide item (book icon) after Settings.
- [ ] Commit.

### Task 8: Verify
- [ ] `npx tsc --noEmit`, `npx eslint` on new/changed files, `npx vitest run`, `npx next build`.
- [ ] Dev server; practice pages in the preview browser (public); guide pages through a temporary dev-only fixture route (removed before commit); screenshot hub + 3 lessons; mobile width check (no horizontal scroll).
- [ ] Fix what turns up. Final commit, PR.
