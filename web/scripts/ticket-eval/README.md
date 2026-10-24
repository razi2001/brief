# Ticket eval

Scores the tickets the draft writer produces for recorded reports with a known, planted bug.

- `cases/<case>/`: one capture, laid out like storage (`brief.json`, `replay.json`, `replay-frames/`; a `.gz` stands in for a big file), the popup's `overrides.json`, and `expect.json` (the planted bug, its kind `failure | ui | none`, and variants that change the typed description).
- Record or re-record them: `CHROME_PATH=<chrome for testing> node extension/test/e2e/record-cases.mjs [case ...]` (pages in `extension/test/e2e/cases.mjs`).
- The `rec-*` cases are screen recordings the reporter talks through, crossing pages: brief.json with the event log, keyframes, `audio.webm` (the voice, one sentence at a time, from OpenAI TTS) and the transcript the popup would send. Rebuild them with `CHROME_PATH=<any chrome> node scripts/ticket-eval/make-recording-cases.mjs [case ...]` (needs ffmpeg). Their `expect.json` can name the `page` the bug is on and an `also` (a second problem the reporter raised).
- `--context` prints what the writer reads for each case (the image labels and the context block) and writes nothing.
- Your own drafts can go in `cases/local/<name>/` (gitignored) with an `expect.json` you write.

Run (costs OpenAI calls: about 50 drafts plus 50 judge calls at 3 runs):

    cd web && npm run eval:tickets -- --label baseline
    npm run eval:tickets -- --case save-500 --runs 1 --effort medium

Per case and variant:

- `named`: the judge's call on whether the ticket is about the planted bug (1, 0.5 or 0)
- `invented`: tickets that claim a failure that wasn't planted
- `plain` (judge) and `plainCode` (no method, path, status or error name in the title and summary)
- `sections`: Steps, Expected and Actual all there
- `notes`: a Technical notes section when something failed, none when nothing did
- `page`: the Context links the page the bug is on (`page` in expect.json), not just where the recording started
- `also`: an Also noticed section for the second problem the reporter raised (`also` in expect.json)
- `rules`: page link, no banned words, no dashes
- median seconds and tokens per draft

Every ticket is saved under `results/` (gitignored).
