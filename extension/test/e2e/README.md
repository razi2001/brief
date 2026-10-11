# Extension end-to-end tests

Real Chrome (Chrome for Testing, headless) with the unpacked extension loaded,
driven over the DevTools protocol, against a small test site served locally.

| Suite | What it covers |
|---|---|
| `editor` | the editor for recordings, replays and screenshots (trim, crop, voice, marks, Space), Replay recording across tabs, saving a replay and its key-moment stills, the replay rendered to a video, technical logs (network calls with timings and trace ids, masked bodies, console), blob: images kept, filing uploads |
| `recording-logs` | a recording keeps its event log when the service worker is recycled mid-recording |

## Run

```sh
npx @puppeteer/browsers install chrome@155.0.8059.39 --path ./.browsers
CHROME_PATH=<the chrome binary it printed> node extension/test/e2e/run.mjs
```

`node extension/test/e2e/run.mjs editor` runs one suite. Screenshots and the
rendered replay video are written to `$E2E_OUT` (a temp folder by default).

Branded Chrome (137+) ignores unpacked extensions loaded this way: use Chrome
for Testing.

The `test/` folder is not part of the extension: leave it out of the Web
Store zip.
