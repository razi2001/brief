# Publishing Brief Cloud to the Chrome Web Store

A complete, copy-paste-ready runbook to take the **Brief Cloud** extension live today:
what was changed to pass review, how to package it, the icons and listing art, the
exact permission justifications and privacy disclosures, and the click-by-click
submission steps.

> Brief Cloud is a **separate item** from the existing local "Brief" listing. You are
> creating a brand-new Web Store item here, not updating the old one.

---

## 0. TL;DR checklist

- [ ] Deploy the web app so **https://cloud.get-brief.app/privacy** is live (the listing needs a working privacy-policy URL). See section 9.
- [ ] Zip the `extension/` folder (section 2).
- [ ] Have a Chrome Web Store developer account (one-time 5 USD fee).
- [ ] Create the item, upload the zip.
- [ ] Paste the listing copy (section 5), single purpose (section 6), permission justifications (section 7).
- [ ] Fill the Privacy practices form (section 8) and the privacy-policy URL (section 9).
- [ ] Upload icons (already in the package) + 1280x800 screenshots + the 440x280 small tile (+ optional 1400x560 marquee). All sit in `promo/` (section 4).
- [ ] Submit for review.

---

## 1. What was changed in the code to pass review

These changes are already applied on this branch. A Chrome reviewer's most common
rejection reasons are unused permissions, remote code, a missing privacy policy, and
a `localhost` entry in a production build. We cleared all of them.

| # | Change | File | Why |
|---|--------|------|-----|
| 1 | Removed `downloads` and `downloads.ui` permissions | `extension/manifest.json` | Dead code. The cloud build uploads recordings to the API; there is no local-zip download path, so no `chrome.downloads.*` call exists anywhere. Unused permissions trigger rejection / clarification requests. |
| 2 | Deleted `extension/lib/zip.js` and removed it from `web_accessible_resources` | `extension/lib/zip.js`, `manifest.json` | The local-zip builder is never imported. Dead code. |
| 3 | Removed `http://localhost:3000/*` from `externally_connectable.matches` | `extension/manifest.json` | Shipping a `localhost` origin in a production build lets any local page message the extension and plant or wipe the pairing token. Reviewers flag this. The prod build uses `cloud.get-brief.app`, so it is unused. (Dev note in section 12.) |
| 4 | Hardened `onMessageExternal` with an explicit sender-origin allowlist | `extension/background.js` | Defense in depth: even an allowlisted origin is re-checked before the pairing token is stored or cleared, so only the real Brief Cloud web app can touch it. |
| 5 | Narrowed `web_accessible_resources` to only the page-injected assets (`bar.*`, `shot.*`, `fonts.css`, `fonts/*`) | `extension/manifest.json` | `offscreen.*` is loaded internally (never by a web page), and the `skill/*` docs were exposed to every site. Narrowing shrinks the attack and fingerprint surface. |
| 6 | Added a public privacy-policy page | `web/app/privacy/page.tsx`, `web/proxy.ts` | The store requires a privacy policy for an extension that records screen, audio, and keystrokes and stores an auth token. Served at `cloud.get-brief.app/privacy`. |

**Kept on purpose** (do not remove, despite looking broad):

- `host_permissions: <all_urls>` is **required**. `cloud.js` uploads recordings via raw
  cross-origin `PUT`s to Supabase signed URLs (`*.supabase.co`), and the extension
  injects the recorder into already-open tabs and screenshots arbitrary pages. A
  narrowed allowlist would silently break every upload. We justify it in section 7.
- `tabs`, `scripting`, `storage`, `activeTab`, `tabCapture`, `offscreen`: all in active use.
- `https://cloud.get-brief.app/*` as the only `externally_connectable` pairing origin
  (`app.get-brief.app` is deprecated and was removed).

Verification run on this branch: manifest parses, extension JS syntax-checks clean,
no `chrome.downloads` references remain, web `tsc --noEmit` exits 0, and 64/64 web
unit tests pass.

**Final manifest permission set:** `activeTab, tabs, scripting, storage, tabCapture,
offscreen` + `host_permissions: <all_urls>`.

---

## 2. Package the extension

The zip you upload must have `manifest.json` at its **root** (not nested inside an
`extension/` folder). From the repo root in PowerShell:

```powershell
# Bump the version first if you have submitted before (see note below)
Compress-Archive -Path extension\* -DestinationPath brief-cloud-1.0.0.zip -Force
```

- **Version:** `manifest.json` is `1.0.0` for the first submission. Every subsequent
  upload must have a **higher** version (e.g. `1.0.1`), or the dashboard rejects it.
- **Optional clean-up:** `extension/skill/` is documentation for the local-agent
  edition and is not used by Brief Cloud. It is no longer web-exposed, so it is
  harmless, but you can exclude it for a tidier package:
  ```powershell
  $tmp = "build\extension"; Remove-Item build -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $tmp | Out-Null
  Copy-Item extension\* $tmp -Recurse
  Remove-Item "$tmp\skill" -Recurse -Force
  Compress-Archive -Path "$tmp\*" -DestinationPath brief-cloud-1.0.0.zip -Force
  ```
- **Never** ship a build with `http://localhost:3000/*` in the manifest (section 12).

---

## 3. Icons

All four required PNG sizes already ship in `extension/icons/` and are
dimensionally valid RGBA with transparent corners:

| Size | File | Used for |
|------|------|----------|
| 16x16 | `icon16.png` | favicon / toolbar |
| 32x32 | `icon32.png` | Windows toolbar |
| 48x48 | `icon48.png` | extensions management page |
| 128x128 | `icon128.png` | **store listing + install dialog** |

They are the Brief **Cloud** edition of the mark: the orange rounded tile with the
cream corner brackets and four-point star, with the top-right bracket replaced by a
white cloud. Source vector: `extension/icons/icon.svg`.

**One optional polish:** the 128x128 is full-bleed (the orange tile reaches the canvas
edge, only the four rounded corners are transparent). It passes validation as-is. If
you want it to sit more comfortably inside the Web Store's own rounded tile, export a
padded variant with the art at roughly 96x96 centered on a 128 transparent canvas, and
upload that as the store icon. Not required to publish.

---

## 4. Listing art (the affiche publicitaire)

All cloud-branded and rendered to PNG in `promo/`. They were regenerated for the
cloud story (auto-files to Linear or Jira) on the cloud mark, replacing the old
local-version art ("Local-first", "Works with any coding agent").

| Asset | File | Size | Where it goes in the listing |
|-------|------|------|------------------------------|
| Small promo tile | `promo/promo-small.png` | 440x280 | "Small promo tile" (recommended; needed for featuring) |
| Marquee promo tile | `promo/promo-marquee.png` | 1400x560 | "Marquee promo tile" (optional) |
| Screenshot 1 (real popup) | `promo/screen-popup.png` | 1280x800 | Screenshots (at least one required) |
| Screenshot 2 (how it works) | `promo/screen-settings.png` | 1280x800 | Screenshots |

Each PNG has a matching `.html` source in `promo/`; `screen-popup.html` pulls in the
live popup styling via `_popup-mock.html`. To re-render any of them (Chrome headless):

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$f = "C:\Users\razif\src_perso\brief-cloud\promo\promo-marquee.html"  # adjust path/name
$src = "file:///" + $f.Replace('\','/')
& $chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=1 `
  --allow-file-access-from-files --virtual-time-budget=2500 `
  --screenshot=($f -replace '\.html$','.png') --window-size=1400,560 $src
```

(Use `--window-size=440,280` for the small tile and `1280,800` for the screenshots.)

---

## 5. Store listing copy (ready to paste)

**Item name** (45 char max):

```
Brief Cloud: record a bug, file the ticket
```

**Summary / short description** (132 char max):

```
Record a bug, hit stop. Brief Cloud writes a clear ticket and files it to your Linear or Jira automatically. No local agent.
```

**Detailed description:**

```
Half the bugs your team hits never get filed, because writing a good ticket takes five minutes and nobody bothers. Brief Cloud fixes that.

Hit the mark, talk through the bug while it is on screen, and stop. Brief Cloud captures the tab, your voice, screenshots, and the console errors, then writes a clear, structured ticket and files it straight to your connected Linear or Jira. No copy and paste, no local agent to run.

HOW IT WORKS
1. Connect Linear or Jira once on the web, then pair the extension.
2. Record a brief on any tab. Add a note, custom fields, or a screenshot if you want.
3. Hit Create ticket. Brief Cloud transcribes your voice, reads the evidence, and files the issue with reproduction steps attached.

WHAT GOES INTO EVERY TICKET
- A clean, written description from your spoken narration
- Reproduction steps from your clicks and scrolls (keystrokes are masked)
- Screenshots and sampled keyframes from the recording
- Console errors and failed network requests captured during the recording
- The page URL and environment, so nothing gets lost

PRIVACY
The extension does nothing in the background. It only captures while you are
actively recording a brief. No analytics, no ad trackers, no selling your data.
Full policy: https://cloud.get-brief.app/privacy
```

(All copy avoids em and en dashes, per the brand voice.)

**Category:** Developer Tools  ·  **Language:** English

---

## 6. Single purpose (paste into the "Single purpose" field)

```
Brief Cloud lets a user record a bug or feature request in the browser (tab video,
voice narration, screenshots, and runtime errors) and turns that recording into a
written issue that is filed to the user's connected Linear or Jira tracker.
```

Everything the extension does and every permission it requests maps to this one
purpose.

---

## 7. Permission justifications (paste each into its field)

The Web Store asks for a justification per permission. These are accurate to the code.

**activeTab**
```
Used to capture the tab the user is acting on when they click the toolbar icon or a
brief's Record or Screenshot button: it backs tabCapture.getMediaStreamId to record
the current tab and tabs.captureVisibleTab to screenshot it. All capture is started by
an explicit user gesture on the visible tab.
```

**tabs**
```
Used to (1) open the extension's own helper pages (the microphone-permission page, the
Brief Cloud pairing page, and the filed-ticket page) with tabs.create/update; (2) read
the active tab's URL and title so each filed ticket records where the bug happened; and
(3) focus an already-open Brief Cloud tab instead of opening duplicates, which requires
reading tab URLs.
```

**scripting**
```
Used to inject the in-page recorder content script into tabs that were already open
when the extension was installed or updated, to re-inject it on demand right before a
recording or screenshot, and to inject a small page-context hook that captures console
errors, uncaught exceptions, and failed network requests during a recording so they
appear in the ticket. Only the extension's own bundled scripts are injected; no remote
code is ever loaded or executed.
```

**storage**
```
Used as the extension's only persistence layer: the local inbox of pending briefs, the
Brief Cloud pairing token, a cached microphone-grant flag so the popup opens instantly,
the recording bar's dragged position, and a short-lived flag telling the popup which
brief to expand after a capture. All stored locally on the user's device.
```

**tabCapture**
```
The core feature. On a user gesture the popup calls tabCapture.getMediaStreamId for the
active tab, then an offscreen document uses that id with getUserMedia to capture the
tab's audio and video, mixed with the microphone, so the user can narrate a bug. Always
user-initiated.
```

**offscreen**
```
An MV3 service worker cannot run getUserMedia, MediaRecorder, AudioContext, or canvas
keyframe extraction. The extension creates one offscreen document (reasons USER_MEDIA
and DISPLAY_MEDIA) to host the recorder: it captures and mixes the streams, records the
webm, extracts keyframes, and uploads the finished brief to Brief Cloud in the
background.
```

**Host permissions (`<all_urls>`)** (the "host permissions" justification field)
```
Bugs can happen on any website, so the recorder must work on any page. The all-sites
host grant is required for three things that content-script matches alone do not cover:
(1) uploading the recording, screenshots, and keyframes via cross-origin PUT requests to
the storage host that returns signed upload URLs; (2) injecting the recorder into tabs
that were already open before the extension loaded; and (3) capturing a screenshot of
the current page with tabs.captureVisibleTab. The extension is inert on every page until
the user starts a recording or takes a screenshot.
```

**Remote code:** the listing form asks "Are you using remote code?" Answer **No**. The
only script injection uses the extension's own bundled files and one locally-defined
function; nothing is fetched and executed at runtime.

---

## 8. Privacy practices (the "Data collection" form)

Declare the categories below. For each, the form asks you to confirm the data is
collected; map them to what Brief Cloud actually sends:

| Web Store category | Declare? | What it maps to in Brief Cloud |
|--------------------|:--------:|--------------------------------|
| Personally identifiable information | **Yes** | The brief name, your typed description, and custom fields may contain whatever you type, including PII. |
| Authentication information | **Yes** | The pairing token that authenticates the extension to your account (stored locally, sent only to cloud.get-brief.app). |
| Website content | **Yes** | The tab recording, screenshots, keyframes, captured console/network errors, and the page URL/title of the recorded tab. |
| User activity | **Yes** | The timeline of clicks, scrolls, and (masked) keystrokes used to build reproduction steps, plus the browser user-agent. |
| Web history | **Your call** | We capture the URL/title of the page you record, not your browsing history. If you prefer to over-disclose for a smooth review, check it; otherwise leave it. |
| Health, Financial, Location, Personal communications | No | None collected. |

Then check the three required certifications (all true for Brief Cloud):

- [x] I do not sell or transfer user data to third parties outside the approved use cases.
- [x] I do not use or transfer user data for purposes unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending.

Note for the reviewer if asked about third parties: brief data goes only to the Brief
Cloud backend (`cloud.get-brief.app`), Supabase Storage (media uploads), OpenAI
(server-side transcription of the narration), Clerk (auth), and the user's own
connected tracker (Linear or Jira). There are no analytics or advertising SDKs.

---

## 9. Privacy policy

A complete, accurate policy now lives at **`web/app/privacy/page.tsx`** and is public
(allowlisted in `web/proxy.ts`). Once the web app is deployed it is reachable at:

```
https://cloud.get-brief.app/privacy
```

Paste that URL into the listing's "Privacy policy URL" field.

**Important ordering:** deploy the web app **before** you submit, so the URL resolves
when the reviewer checks it. From `web/` in your main repo (which has `node_modules`
and `.env.local`):

```sh
npm run build   # confirm it is green
fly deploy      # or your deploy command
```

Then open `https://cloud.get-brief.app/privacy` in an incognito window to confirm it
loads without a sign-in redirect.

---

## 10. Submission walkthrough (click by click)

1. **Developer account.** Go to the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   Sign in with the Google account that should own the listing. If this is your first
   item, pay the one-time **5 USD** registration fee and accept the developer agreement.
2. **Verify your publisher email** if prompted (Account tab). Unverified accounts cannot publish.
3. **New item.** Click **Add new item**. Drag in `brief-cloud-1.0.0.zip`. Wait for the
   upload and automatic manifest validation to finish.
4. **Store listing tab.**
   - Item name, summary, detailed description: paste from section 5.
   - Category: **Developer Tools**. Language: **English**.
   - Icon: the 128x128 is read from the package; upload the padded variant here if you made one (section 3).
   - Screenshots: upload `promo/screen-popup.png` and `promo/screen-settings.png` (1280x800).
   - Small promo tile: upload `promo/promo-small.png` (440x280).
   - Marquee (optional): upload `promo/promo-marquee.png` (1400x560).
5. **Privacy practices tab.**
   - Single purpose: paste from section 6.
   - Permission justifications: paste each from section 7. Answer "remote code" = **No**.
   - Data collection: fill per section 8 and check the three certifications.
   - **Privacy policy URL:** `https://cloud.get-brief.app/privacy` (section 9).
6. **Distribution tab.** Visibility **Public** (or Unlisted if you want a link-only soft
   launch first). Choose regions (all, unless you have a reason to limit).
7. **Save draft**, then **Submit for review**. Fix any inline errors the dashboard flags
   (missing field, asset size, etc.) and resubmit.

---

## 11. After you submit

- Review usually takes a few hours to a few business days. Extensions with broad host
  permissions (ours) can take longer and occasionally get a clarification email; the
  justifications in sections 6 to 8 are written to answer those directly.
- If rejected, the email cites a specific policy. The likely ones here are host-permission
  scope or a data-use question; reply with the relevant justification text above.
- To ship an update later: bump `manifest.json` `version`, re-zip, upload a new package,
  and submit again.

---

## 12. Developer note: localhost pairing in dev

`http://localhost:3000/*` was removed from the shipped manifest on purpose. For local
development against `npm run dev`:

1. Set `ENV = "local"` in `extension/config.js`.
2. Temporarily add `"http://localhost:3000/*"` back to
   `externally_connectable.matches` in `extension/manifest.json`.

`background.js` already trusts `APP_URL` as a pairing origin, so no other change is
needed. **Never commit the localhost entry into the package you upload to the Web
Store** (section 2).
