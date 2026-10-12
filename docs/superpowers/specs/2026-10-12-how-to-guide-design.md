# How-to Guide: design

Date: 2026-10-12. Approved in chat ("go build it").

> **Update, same day:** the practice shop was dropped ("no need practice shop"),
> and with it the extension change (practice-page recording, version ping).
> Capture lessons now try it in the real extension ("I tried it"), in a
> sandbox, or on the real page. The sections below on the practice app and
> the extension are kept for the record only.

## Goal

A **Guide** tab in the web app's sidebar that teaches every Brief feature with an
animated illustration, a few numbered steps and a live example the user can
actually do: a practice app with planted bugs to capture with the real extension,
and in-page sandboxes for the web-only features.

## Decisions

| Question | Choice |
|---|---|
| Live examples | Practice app (planted bugs, captured with the real extension) + in-page sandboxes |
| Illustrations | Animated UI mockups (React + CSS, on-brand), a cursor walking through each flow |
| Structure | Hub with feature cards + one page per feature |
| Nav label | Guide |

## Information architecture

`/guide` (hub) and `/guide/[slug]` (lesson), both in the authed `(main)` group, so
the sidebar stays. Guide is the last nav item, after Settings.

Lessons, in order (the hub groups them):

| Group | Slug | Title | Live example | Auto-done when |
|---|---|---|---|---|
| Start | `connect-tracker` | Connect your tracker | Link to Settings | a tracker is connected |
| Start | `install-extension` | Install the extension | Web Store + pair | the extension is paired |
| Capture | `record` | Record your screen | Practice: Checkout | - |
| Capture | `screenshots` | Screenshots and drawing | Sandbox: draw + Practice: Pricing | - |
| Capture | `upload` | Upload a file | Mark done | - |
| Capture | `replay` | Replay the last minute | Practice: Search | - |
| Capture | `brief-it` | Brief it in one click | Practice: Profile | - |
| Capture | `edit-evidence` | Trim, crop and mark | Sandbox: trim | - |
| Write and file | `create-or-draft` | Create a ticket or a draft | Practice capture, then Drafts | the user has any brief |
| Write and file | `edit-ticket` | Edit a ticket | Sandbox: editor | - |
| Write and file | `assistant` | Ticket assistant | Sandbox: assistant | - |
| Team | `ticket-rules` | Ticket rules | Link to Settings | rules are set |
| Team | `replay-sites` | Replay sites | Link to Settings | a Replay site applies |
| Team | `tickets-and-team` | Tickets, drafts and the podium | Link to Tickets | - |

## Hub

Header with a progress bar ("n of 14"). Four groups of cards; each card shows the
lesson's illustration as a still poster (it plays on hover), the title, a one-line
blurb and a check once done. Done = auto-done from the server, or tried (stored in
the browser's `localStorage`, key `briefGuideTried`, every access in try/catch).

## Lesson page

1. Breadcrumb (Guide > title), title, one line on what it is for.
2. The illustration, large. A scene player steps through a script (cursor moves,
   clicks, UI state changes) in a loop. The step list below is synced: the step
   being shown is highlighted, clicking a step jumps the scene to it. The scene
   pauses when off screen; with `prefers-reduced-motion` it shows the step
   clicked (no auto-advance).
3. Numbered steps (3 to 5), with keys as `Kbd` chips.
4. **Try it** panel: the live example, and a Done button (or an automatic tick
   when the app already knows, or when a sandbox is used).
5. Previous / Next.

Copy: short, conversational, no em or en dashes (brand rule), no filler.

## Illustrations

A mockup kit in `web/components/guide/mock/`: `Stage` (scales with its width via
container query units), `BrowserFrame`, `Cursor`, `MockPopup`, `MockChooser`,
`MockBar`, `MockToast`, `MockAcme` (the practice app's look), `MockEditor`,
`MockTicket`, `Kbd`. A `useScene(script)` hook drives each illustration: the
script is a list of `{ ms, step, cursor?, click?, state }` frames. One scene per
lesson, registered by key in `components/guide/scenes/`.

## Practice app

Public pages at `/practice/*` (added to `proxy.ts` isPublic) with their own fake
"Acme" look, outside the app shell. Each has one planted bug, reproduced by its
own route handler under `/practice/api/*`:

| Page | Bug | API |
|---|---|---|
| `/practice/checkout` | Pay fails with no message | `POST /practice/api/pay` → 500 `{"error":"payment service timeout"}` after 600 ms |
| `/practice/pricing` | The Team plan's price overflows its card | none (CSS) |
| `/practice/search` | The spinner never stops | `GET /practice/api/search` holds 20 s, then 504 |
| `/practice/profile` | Save changes does nothing | none (the click handler is on the wrong element) |

`/practice` is an index of the four. A small chip on each page links back to its
lesson. Nothing on these pages reads or writes user data.

## Extension change (1.4.1)

- New pure module `extension/practice.js`: `isPracticeUrl(url)` (true for
  `APP_URL/practice` and below, nothing else on the app) and
  `practiceMenuPattern()` (the context menu pattern for those pages).
- `isWatched(url)` is true for practice URLs, so Replay records them and
  Alt+Shift+B works there; `purgeUnwatchedReplay` keeps their chunks; the
  "Brief it" context menu also covers them.
- `onMessageExternal` answers `{ type: "brief-cloud-ping" }` with
  `{ ok: true, version }`.
- Version 1.4.0 → 1.4.1. Needs a Web Store release; until then Record,
  Screenshot and Upload work on practice pages, Replay and Brief it do not.

The web side reads the version with a ping (extension id from `localStorage`
`briefExtId`, set at pairing). On the Replay and Brief it lessons, an older or
silent extension shows "Update Brief to 1.4.1 to try this here".

## Sandboxes (no extension, no AI calls, nothing saved)

- **Draw**: pen on a sample screenshot of the Pricing bug; Undo, Clear. Drawing
  marks the lesson tried.
- **Trim**: a filmstrip with two handles (pointer drag and arrow keys) and a
  readout of what is kept. Trimming marks it tried.
- **Editor**: a sample ticket, `contentEditable`. Selecting text shows the
  toolbar: B / I / Code / Heading do real formatting; Improve and Shorten swap the
  selected paragraph for a pre-written version (labelled Demo), with Undo.
- **Assistant**: the sample ticket beside an assistant panel; three suggestion
  chips apply pre-written edits with Undo / Redo; Cmd/Ctrl+K focuses it.

## Server data for auto-done

`lib/guide/status-server.ts` `getGuideStatus(userId)` runs in parallel and is
best-effort (a failure reads as not done): tracker connected, extension paired,
any non-archived brief, effective ticket rules non-empty, effective Replay sites
non-empty.

## Testing

- vitest: lesson data (unique slugs, every scene and practice page exists, no
  dashes in copy, prev/next), progress logic, practice API handlers, sandboxes
  (jsdom: trim by keyboard, draw by pointer, assistant apply + undo), scene
  player stepping.
- tsc, eslint, `next build`.
- Visual: practice pages and the guide (via a temporary dev-only fixture route,
  removed before commit) screenshotted.
- Extension: `node --test` for `practice.js`; `.mjs` syntax check of changed
  modules.

## Out of scope

Cross-device progress, video walkthroughs, translations, a guide for signed-out
visitors.
