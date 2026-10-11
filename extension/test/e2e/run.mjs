// Runs the extension's end-to-end suites: each suite is appended to the shared
// harness (_harness.mjs) and run on its own, in a fresh browser.
//
//   CHROME_PATH=/path/to/chrome-for-testing node extension/test/e2e/run.mjs [editor|recording-logs ...]
//
// Exits non-zero when any check fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const all = fs.readdirSync(here).filter((f) => f.endsWith('.suite.mjs')).map((f) => f.replace('.suite.mjs', ''));
const pick = process.argv.slice(2);
const suites = pick.length ? pick : all;
const harness = fs.readFileSync(path.join(here, '_harness.mjs'), 'utf8');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-e2e-'));
let failed = 0;
for (const name of suites) {
  const file = path.join(here, `${name}.suite.mjs`);
  if (!fs.existsSync(file)) { console.error(`no suite "${name}" (have: ${all.join(', ')})`); process.exit(2); }
  const script = path.join(work, `${name}.mjs`);
  fs.writeFileSync(script, `${harness}\n${fs.readFileSync(file, 'utf8')}`);
  console.log(`\n=== ${name}`);
  const r = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, BRIEF_EXTENSION_DIR: path.resolve(here, '..', '..') },
    timeout: 12 * 60 * 1000,
  });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
