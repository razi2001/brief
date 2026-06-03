# Chrome Web Store — listing copy and submission notes

Everything you need to paste into https://chrome.google.com/webstore/devconsole when submitting Brief. Reviewed for length limits and Chrome's permission-justification guidance.

---

## 1. Listing fields

### Item name

```
Brief
```

### Short description (max 132 chars)

```
Voice + screen capture for coding agents. Record what's broken, paste one prompt, your AI files the ticket.
```
*(107 chars)*

### Category

Primary: **Developer Tools**
Secondary (if asked): **Productivity**

### Language

English (en)

### Single purpose

```
Capture a short voice + screen recording of a bug or feature request and hand the resulting brief to the user's local coding agent so it can file a ticket in their tracker.
```

### Detailed description

Paste this in the long-description field. Markdown is not rendered; Chrome strips most formatting but keeps paragraph breaks and bullet lists. This version is plain-text-safe.

```
Voice your bug. Your coding agent ships the ticket.

Brief is a Chrome extension for people who use a coding agent (Claude Code, Cursor, Cline, Claude Desktop, etc.). You spot something broken or want a feature, click the ✦ icon in your toolbar, talk through it while showing it on screen, and hit stop. Brief saves a self-contained zip locally and gives you one prompt to paste into your agent — the agent reads the brief and files the real ticket in Linear, GitHub, Jira, or Notion.

No more breaking flow to write a ticket.

WHAT BRIEF DOES
- Records the active tab's screen + your voice narration into a single file on your machine.
- Live-transcribes your voice (English or French) using Chrome's built-in speech recognition.
- Samples keyframe screenshots every 2 seconds and timestamps your click/scroll/keypress events, so your agent can map "what you said" to "what was on screen".
- Captures console errors and failed network requests on the page during the recording — pure gold for bug reports.
- Lets you mark up a screenshot with red annotations to point at the issue.
- Stacks up briefs in an inbox so you can capture several throughout the day, then file them all in one batch.

THE CATCH
You need a local coding agent that can read files from your Downloads folder and reach your tracker (Linear / GitHub / Jira / Notion) — Claude Code Desktop, Cursor, Cline, Claude Desktop, anything similar. Brief writes the brief; the agent files the ticket.

PRIVACY
Everything is local-first.
- The video file never leaves your machine.
- The microphone audio is streamed to Google's speech recognition service while transcribing (this is the browser's webkitSpeechRecognition API, not Brief) and is not stored.
- Console-error capture only runs while you are actively recording, only on the tab you are recording, and only forwards error messages — no DOM content, no cookies, no storage.
- Briefs are saved locally in ~/Downloads/brief/ and never leave your machine unless you hand them to your coding agent, which also runs on your machine.

Privacy policy: https://get-brief.app/privacy.html
Terms: https://get-brief.app/terms.html

HOW IT WORKS
1. Click the ✦ icon in your Chrome toolbar.
2. Name the brief, then hit Record on it. Speak while showing the bug or feature on screen.
3. Hit Stop. Brief writes a zip to ~/Downloads/brief/ containing the recording, keyframes, transcript, and a filing playbook.
4. Hit Export. The extension copies a one-line prompt to your clipboard. Paste it into your coding agent.
5. The agent reads the brief, files a ticket in your tracker with the screenshots inline, and deletes the source brief once it's filed.

REQUIREMENTS
- Chrome 116+ (or any Chromium-based browser: Edge, Brave, Arc, Opera).
- A local coding agent with file access and a tracker connected.

LIMITATIONS
- Does not work on chrome:// pages (Chrome blocks tab capture on its own pages).
- Speech recognition is one language per session (EN or FR) — pick one before recording.
- Speech recognition accuracy on heavy accents, code, and technical jargon is mediocre. The transcript is treated as a draft; your agent uses the keyframes and page context as ground truth.

OPEN SOURCE
Brief is open source. Source code and issue tracker: https://github.com/razi2001/brief
```

---

## 2. Privacy practices form

The dev console asks you to certify how user data is handled. Answers below.

### Data collected (check ALL that apply)

| Category | Collected? | Notes for the form |
|---|---|---|
| Personally identifiable information | **No** | Brief does not collect names, emails, addresses, age. |
| Health information | No | — |
| Financial and payment information | No | — |
| Authentication information | No | Brief does not handle credentials. |
| Personal communications | **No** | The microphone audio is the user's own voice narration of a bug. It is sent to Google's speech-recognition service for transcription (via the browser's `webkitSpeechRecognition` API) and is not stored or transmitted by Brief. The audio is also saved locally inside the user's own brief zip — it never leaves their machine via Brief. |
| Location | No | — |
| Web history | **No** | Brief records the URL/title of the *single tab* the user explicitly chose to record. This metadata is included in the user's local brief zip only and never transmitted. |
| User activity | **No** | Click/scroll/keypress events are captured *only during an active recording on the recorded tab*, included in the user's local brief, and never transmitted. |
| Website content | **No** | Brief captures screen pixels of the recorded tab into the user's local recording file. Not transmitted by Brief. |

### Certifications (check all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://get-brief.app/privacy.html
```

---

## 3. Permission justifications

Each permission gets its own justification field in the dev console. Paste these verbatim.

### `activeTab`

```
Used when the user clicks the toolbar icon to start a recording or take an annotated screenshot. Gives Brief temporary access to that one tab so it can inject the floating recording bar overlay or the screenshot annotator. Without it, the user-triggered capture cannot reach the page they are actively viewing.
```

### `tabs`

```
Used to read the active tab's URL and title for inclusion in the brief metadata (so the user's coding agent knows which page the bug was on) and to relay messages from the offscreen recorder back to the bar in the correct tab. Brief does not enumerate or read content from inactive tabs.
```

### `scripting`

```
Used to inject the content script (content.js) into the active tab on demand: once to mount the recording bar iframe when the user clicks the toolbar icon, and once more — only during an active recording — to install a console-error capture in the page's main world so error messages can be included in the bug report. Both injections are user-initiated; neither runs in the background.
```

### `storage`

```
Stores three pieces of state in chrome.storage.local: (1) the inbox of recorded-but-not-yet-exported briefs, so the user can stack several through the day and export them in one batch; (2) the user's preferred speech-recognition language (EN or FR); (3) the dragged position of the recording bar so it stays put across tabs. All data stays on the device. Nothing is transmitted.
```

### `downloads`

```
Brief writes each completed brief as a single .zip file into ~/Downloads/brief/. The zip contains the recording, sampled keyframe PNGs, the transcript JSON, and the filing playbook. The user's local coding agent reads from this folder to file the ticket. Without the downloads permission the brief cannot be persisted to disk and the whole product does not work.
```

### `downloads.shelf`

```
Briefly hides Chrome's download shelf while writing the brief zip so the user is not interrupted by a download-complete popup every time they finish a recording. The shelf is restored immediately after the write completes. This is purely a UX smoothing — no data is hidden from the user; the file is still visible in chrome://downloads and in the file system.
```

### `tabCapture`

```
Captures the screen pixels and audio of the tab the user explicitly chose to record. The user initiates every capture by clicking the toolbar icon — there is no background capture and no passive capture. The capture stops the moment the user clicks Stop or closes the recording bar. Captured data is written only to the user's local brief zip; it is never transmitted by Brief.
```

### `offscreen`

```
Brief runs the MediaRecorder inside a chrome-extension:// offscreen document rather than from an iframe injected into the page. This is necessary because many websites apply a Permissions-Policy header that blocks getUserMedia and getDisplayMedia from page-hosted iframes; the offscreen document is on the extension's own origin and is not subject to those headers, so recording works reliably across all sites. The offscreen document is created on user-initiated start and torn down on stop or cancel.
```

### Host permission: `<all_urls>`

This one gets the most scrutiny — give it room.

```
Brief lets the user record any website they are already looking at — that is the core product. The host permission is needed at three user-initiated moments:

1. When the user clicks the toolbar icon, Brief injects the floating recording bar overlay onto the page they are on (whatever it is). The user always sees the bar; there is no hidden capture.

2. During an active recording, Brief injects a small console-error capture into the recorded page's main world so error messages and failed network requests can be embedded in the resulting bug ticket. This runs ONLY while the user is recording, ONLY on the tab being recorded, and is torn down on stop or cancel.

3. When the user clicks Screenshot, Brief calls captureVisibleTab on the active tab so the user can annotate it with the in-page overlay.

Brief never reads page content in the background. There is no telemetry, no analytics, no content collection across tabs. The user has continuous visual confirmation a recording is happening (floating bar) and explicit control over when capture starts and stops.

Restricting to a smaller set of hosts would defeat the product: users record bugs on whatever site they happen to be using — internal tools, customer sites, dashboards, design tools, dev environments — and that set is unbounded.
```

### Microphone (declared via `getUserMedia`, no manifest entry)

The Chrome Store reviewer will see microphone usage and may ask about it in clarification mail. Have this ready:

```
Brief records the user's voice narration alongside the screen capture so the user can explain the bug or feature out loud while pointing at it on screen. Microphone access is requested only after the user clicks Record. Audio is encoded directly into the local WebM file alongside the tab's audio + video; it is never streamed to a Brief-owned server (Brief has no server).

The audio is also streamed to Google's speech-recognition service via the browser's webkitSpeechRecognition API for live transcription. This is the standard browser-built-in API; Brief does not control or store what Google does with that audio stream. This is disclosed in the privacy policy.

The extension ships with a one-time microphone-permission onboarding page (permission.html, on the chrome-extension:// origin) so that users grant the mic once at the extension origin rather than re-granting on every site they record.
```

---

## 4. Screenshots — required for the listing

Required dimensions: **1280×800** (preferred) or **640×400**. Submit between 1 and 5. PNG or JPEG.

Suggested set (capture in this order; each one tells part of the story):

1. **Popup with a few named briefs in the list.** Shows the central UX. Optionally include one with the disclosure panel open (description + additional data).
2. **Recording bar live on a real-looking website**, transcript ticker visible, timer at ~00:08.
3. **Screenshot annotator** with a red circle drawn on a real page, pointing at something concretely wrong.
4. **"Copied — paste into your agent" success state** of the bar — captures the punchline of the product.
5. **The settings / How-it-works page** — shows the product is simple and explains itself.

Tip: use a 1280×800 Chrome window with the dev tools closed. Take screenshots via the OS (Win + Shift + S or macOS Cmd-Shift-4), not via DevTools' device emulation, so the bar overlay and fonts render at the real pixel ratio.

### Optional promo images

| Asset | Dimensions | Recommended? |
|---|---|---|
| Small promotional tile | 440×280 | Yes — shown in the Store search results |
| Marquee promotional tile | 1400×560 | Optional — only used if the listing gets featured |

Both are static images. Match the orange (#dd6936) + cream (#f5f1e8) palette already in the icon and popup so the listing feels consistent with the product.

---

## 5. Distribution ZIP

The reviewer needs a zip of the extension folder contents, NOT the whole repo.

```sh
cd extension
zip -r ../brief-v0.2.0.zip . -x "*.DS_Store" "Thumbs.db"
```

Verify the zip:
```sh
unzip -l ../brief-v0.2.0.zip | head -20
```

Top-level entries should be `manifest.json`, `background.js`, `popup.*`, `bar.*`, etc. — NOT a top-level `extension/` folder. The Store reviewer expects the manifest at the root of the zip.

Things to confirm before zipping:
- [ ] `extension/manifest.json` `version` is bumped if you've already submitted once.
- [ ] No `console.log` calls leaking secrets or developer-only info. (Brief uses some `console.warn` / `console.error` for diagnostics, which is fine.)
- [ ] No unused permissions in the manifest. (Current set is all needed.)
- [ ] The icons all open correctly in an image viewer.

---

## 6. Visibility, regions, audience

- **Visibility:** Public.
- **Distribution:** All regions.
- **Pricing:** Free.
- **Audience:** *Not made for children*. Brief is a developer tool; the audience is adults using coding agents at work.

---

## 7. Submission checklist

In dev-console order. Tick as you go.

- [ ] Pay the one-time $5 developer registration fee (if not already done)
- [ ] Click "New item" → upload `brief-v0.2.0.zip`
- [ ] Fill **Store listing** tab:
  - [ ] Name: `Brief`
  - [ ] Short description (paste from §1)
  - [ ] Detailed description (paste from §1)
  - [ ] Category: Developer Tools
  - [ ] Language: English
  - [ ] Upload 1–5 screenshots (§4)
  - [ ] Upload small promo tile (§4) — optional but recommended
  - [ ] Single purpose (paste from §1)
- [ ] Fill **Privacy practices** tab:
  - [ ] Privacy policy URL: `https://get-brief.app/privacy.html`
  - [ ] Permission justifications for each permission (paste from §3)
  - [ ] Data collection certifications (all three boxes — see §2)
  - [ ] Remote code: **No** (Brief does not load remote JS)
- [ ] Fill **Distribution** tab:
  - [ ] Visibility: Public
  - [ ] Regions: All
  - [ ] Pricing: Free
- [ ] Hit **Submit for review**.
- [ ] Wait 1–2 weeks. Watch the email tied to the dev account for any clarification mail (most likely about `<all_urls>` or the microphone — have §3 ready to paste in the reply).

---

## 8. After approval — wire up the README

Once the listing is live and you have the Store URL, update the README:

- Replace the "Install" section with a "Install from the Chrome Web Store" link as the primary CTA.
- Keep the "Load unpacked" instructions below as a fallback for contributors.
- Update the link in `extension/permission.html` and `extension/settings.html` if any hard-coded install/upgrade text references the github zip download.
