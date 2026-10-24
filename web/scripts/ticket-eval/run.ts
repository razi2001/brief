// The ticket eval: writes a draft for every recorded case (and variant),
// several times, and scores each one. It costs OpenAI calls - run by hand:
//
//   cd web && npx tsx scripts/ticket-eval/run.ts [--case save-500] [--runs 3]
//     [--effort low|medium] [--label baseline] [--model gpt-5.6-luna] [--env <file>]
//     [--context]  (print what the writer reads for each case, write nothing)
//
// OPENAI_API_KEY comes from the environment, else from --env (default web/.env.local).
import { readFileSync } from "node:fs";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { loadBriefInput } from "../../lib/agent/load-brief-input";
import { composeDraftTicket } from "../../lib/agent/compose-draft";
import { buildContextBlock } from "../../lib/agent/context-block";
import { storyboardParts } from "../../lib/agent/storyboard";
import type { BriefOverrides } from "../../lib/agent/overrides";
import { folderStore } from "./folder-store";
import { codeChecks, type Checks, type Kind, type Ticket } from "./score";
import { judge, type Verdict } from "./judge";

const here = path.dirname(fileURLToPath(import.meta.url));
const JUDGE_MODEL = "gpt-5.6-luna";

type Variant = { name: string; description?: string };
// page: the path the Context should link (the bug's page); also: a second problem the reporter raised
type Expect = { bug: string; kind: Kind; facts?: string[]; variants?: Variant[]; page?: string; also?: string };
type Job = { name: string; root: string; prefix: string; expect: Expect; variant: Variant; run: number };
type Row = {
  case: string;
  variant: string;
  kind: Kind;
  run: number;
  ms?: number;
  usage?: { input: number; output: number; reasoning: number };
  checks?: Checks;
  verdict?: Verdict;
  ticket?: Ticket;
  error?: string;
};

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

function loadEnv(file: string) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

/** Case folders: cases/<name>/expect.json, and cases/local/<name>/expect.json (gitignored). */
async function findCases(dir: string): Promise<Array<{ name: string; root: string; prefix: string }>> {
  const out: Array<{ name: string; root: string; prefix: string }> = [];
  for (const root of [dir, path.join(dir, "local")]) {
    let names: string[] = [];
    try {
      names = await readdir(root);
    } catch {
      continue;
    }
    for (const n of names.sort()) {
      try {
        await readFile(path.join(root, n, "expect.json"));
      } catch {
        continue;
      }
      out.push({ name: root === dir ? n : `local/${n}`, root, prefix: n });
    }
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const rate = (xs: Array<boolean | null | undefined>) => {
  const k = xs.filter((x): x is boolean => typeof x === "boolean");
  return k.length ? `${Math.round((100 * k.filter(Boolean).length) / k.length)}%` : "-";
};
const named = (v?: Verdict) => (v ? (v.namedBug === "yes" ? 1 : v.namedBug === "partly" ? 0.5 : 0) : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

async function main() {
  if (!process.env.OPENAI_API_KEY) loadEnv(arg("env", path.join(here, "..", "..", ".env.local"))!);
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (pass --env <file>)");
  process.env.AGENT_MODEL = arg("model", "gpt-5.6-luna");
  const effort = arg("effort");
  if (effort) process.env.AGENT_REASONING = effort;
  const runs = Number(arg("runs", "3"));
  const only = arg("case");
  const label = arg("label", "run")!;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const cases = (await findCases(path.join(here, "cases"))).filter((c) => !only || c.name === only);
  if (!cases.length) throw new Error("no cases (record them: extension/test/e2e/record-cases.mjs)");

  // --context: what the writer would read for each case (no ticket written)
  if (process.argv.includes("--context")) {
    for (const c of cases) {
      const overrides = JSON.parse(await readFile(path.join(c.root, c.prefix, "overrides.json"), "utf8").catch(() => "{}")) as BriefOverrides;
      const { input } = await loadBriefInput(folderStore(c.root), c.prefix, { overrides });
      const labels = storyboardParts(input.images).flatMap((p) => (p.type === "input_text" ? [p.text] : []));
      console.log(`\n===== ${c.name}\n${labels.join("\n")}\n\n${buildContextBlock(input.json)}`);
    }
    return;
  }
  const jobs: Job[] = [];
  for (const c of cases) {
    const expect = JSON.parse(await readFile(path.join(c.root, c.prefix, "expect.json"), "utf8")) as Expect;
    for (const variant of expect.variants?.length ? expect.variants : [{ name: "one-click" }]) {
      for (let run = 1; run <= runs; run++) jobs.push({ ...c, expect, variant, run });
    }
  }
  console.log(
    `${jobs.length} drafts (${cases.length} cases, ${runs} runs) on ${process.env.AGENT_MODEL}, reasoning ${process.env.AGENT_REASONING || "default"}`,
  );

  const rows = await pool(jobs, Number(arg("concurrency", "6")), async (j): Promise<Row> => {
    const row: Row = { case: j.name, variant: j.variant.name, kind: j.expect.kind, run: j.run };
    try {
      const saved = JSON.parse(
        await readFile(path.join(j.root, j.prefix, "overrides.json"), "utf8").catch(() => "{}"),
      ) as BriefOverrides;
      const overrides: BriefOverrides = {
        ...saved,
        ...(j.variant.description !== undefined ? { description: j.variant.description } : {}),
      };
      const { input } = await loadBriefInput(folderStore(j.root), j.prefix, { overrides });
      const t0 = Date.now();
      const draft = await composeDraftTicket(input, "");
      row.ms = Date.now() - t0;
      row.usage = draft.usage;
      row.ticket = { title: draft.title, body: draft.descriptionMarkdown };
      row.checks = codeChecks(row.ticket, j.expect.kind, j.expect);
      row.verdict = await judge(client, JUDGE_MODEL, j.expect, row.ticket);
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
    process.stdout.write(row.error ? "x" : ".");
    return row;
  });
  console.log("");

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.case} / ${r.variant}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const table = [...groups].map(([key, rs]) => {
    const ok = rs.filter((r) => !r.error);
    return {
      case: key,
      named: ok.length && ok[0].kind !== "none" ? avg(ok.map((r) => named(r.verdict))).toFixed(2) : "-",
      invented: ok.filter((r) => r.verdict?.inventedBug).length,
      plain: rate(ok.map((r) => r.verdict?.plainSummary)),
      plainCode: rate(ok.map((r) => r.checks?.plainSummary)),
      sections: rate(ok.map((r) => r.checks?.sections)),
      notes: rate(ok.map((r) => r.checks?.techNotes)),
      page: rate(ok.map((r) => r.checks?.contextPage)),
      also: rate(ok.map((r) => r.checks?.alsoNoticed)),
      rules: rate(ok.map((r) => !!r.checks && r.checks.contextLink && r.checks.noBannedWords && r.checks.noDashes)),
      s: (median(ok.map((r) => r.ms ?? 0)) / 1000).toFixed(1),
      tokens: Math.round(avg(ok.map((r) => (r.usage ? r.usage.input + r.usage.output : 0)))),
      errors: rs.length - ok.length,
    };
  });
  console.table(table);

  const ok = rows.filter((r) => !r.error);
  const buggy = ok.filter((r) => r.kind !== "none");
  const clean = ok.filter((r) => r.kind === "none");
  const total =
    `TOTAL named ${avg(buggy.map((r) => named(r.verdict))).toFixed(2)}` +
    ` | invented on clean ${clean.filter((r) => r.verdict?.inventedBug).length}/${clean.length}` +
    ` | invented anywhere ${ok.filter((r) => r.verdict?.inventedBug).length}/${ok.length}` +
    ` | plain (judge) ${rate(ok.map((r) => r.verdict?.plainSummary))} (code) ${rate(ok.map((r) => r.checks?.plainSummary))}` +
    ` | sections ${rate(ok.map((r) => r.checks?.sections))} | tech notes ${rate(ok.map((r) => r.checks?.techNotes))}` +
    ` | bug page ${rate(ok.map((r) => r.checks?.contextPage))} | also noticed ${rate(ok.map((r) => r.checks?.alsoNoticed))}` +
    ` | median ${(median(ok.map((r) => r.ms ?? 0)) / 1000).toFixed(1)} s | errors ${rows.length - ok.length}`;
  console.log(total);

  const outDir = path.join(here, "results");
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.json`);
  await writeFile(
    file,
    JSON.stringify({ label, model: process.env.AGENT_MODEL, effort: process.env.AGENT_REASONING ?? null, total, table, rows }, null, 2),
  );
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
