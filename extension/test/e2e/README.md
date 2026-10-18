# Extension end-to-end tests

Real Chrome (Chrome for Testing, headless) with the unpacked extension loaded,
driven over the DevTools protocol, against a small test site served locally.

| Suite | What it covers |
|---|---|
| `editor` | the editor for recordings, replays and screenshots (trim, crop, voice, marks, Space), Replay recording across tabs, saving a replay and its key-moment stills, the replay rendered to a video, technical logs (network calls with timings and trace ids, masked bodies, console), blob: images kept, filing uploads |
| `recording-logs` | a recording keeps its event log when the service worker is recycled mid-recording |
| `filing-restart` | a ticket filed in the background survives the worker being shut down mid-filing: its files are kept, it resumes, it's filed once |
| `auto-report` | "Brief it" (Alt+Shift+B, or right-click): the last minute becomes a draft with nothing opened - suspects found (a failed call), stills taken there, uploaded, the toolbar icon says it; an unrecorded page is explained in the popup |
| `replay-trim` | a trimmed replay opens on the part kept, not the start of the recording: its video's first frame (a ticket's thumbnail) and the editor reopening it |
| `popup-status` | the popup and `/api/me`: a tracker still on Clerk shows "Reconnect <tracker>" above an enabled Create, from the cache on the next open, gone once the server stops asking; old caches and servers without `trackerAction`; with no tracker that can file, Create shares a link and the menu's ticket row carries the fix as a pill (Connect, Reconnect, Finish) that opens Connections, with no error; the Create menu (Create in <tracker>, Share link, Fix prompt) sets what the button does and remembers it; Share link copies `/b/<id>` and the brief is created and drafted with that same id; Fix prompt copies the reporter's words and `/b/<id>.md` |
| `upload-race` | a recording trimmed while the original is still uploading: the trimmed upload is the one filed, whichever finishes last |

## Run

```sh
npx @puppeteer/browsers install chrome@155.0.8059.39 --path ./.browsers
CHROME_PATH=<the chrome binary it printed> node extension/test/e2e/run.mjs
```

`node extension/test/e2e/run.mjs editor` runs one suite. Screenshots and the
rendered replay video are written to `$E2E_OUT` (a temp folder by default).

The suites intercept every call to Brief Cloud (nothing leaves the machine).
`node --check` on a `.js` file misses syntax errors in these ES modules: check a
`.mjs` copy, or just run the suites.

Branded Chrome (137+) ignores unpacked extensions loaded this way: use Chrome
for Testing.

The `test/` folder is not part of the extension: leave it out of the Web
Store zip.

## Ticket eval cases

`record-cases.mjs` records the cases the ticket eval scores (`web/scripts/ticket-eval/`):
each page in `cases.mjs` has one planted bug; the script does what a user would on it,
takes the last minute as a one-click report (a fresh browser per case), and writes what
the extension uploaded to `web/scripts/ticket-eval/cases/<case>/`. `DEBUG_STORE=1` also
prints the replay buffer as stored right before the report.

    CHROME_PATH=<chrome for testing> node extension/test/e2e/record-cases.mjs [case ...]

Unit tests for the replay and suspect logic run with `node --test extension/test/*.test.mjs`.
