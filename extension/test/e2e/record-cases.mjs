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
