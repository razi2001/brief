// Writes the Guide's copies of the extension's stylesheets (lib/guide/scope-css.ts).
// Run from web/ after changing one of them:  node scripts/sync-guide-css.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Node runs the TypeScript module directly (type stripping, Node 23.6+).
const { EXTENSION_SHEETS, EXTENSION_PAGES, scopeCss, copyPage } = await import("../lib/guide/scope-css.ts");
const web = fileURLToPath(new URL("..", import.meta.url));
// line endings as git stores them, whatever the checkout turned them into
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
for (const s of EXTENSION_SHEETS) {
  const target = `${web}/${s.target}`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, scopeCss(read(`${web}/../${s.source}`), s.scope, s.source));
  console.log("wrote", s.target);
}
for (const p of EXTENSION_PAGES) {
  writeFileSync(`${web}/${p.target}`, copyPage(read(`${web}/../${p.source}`), p.scope, p.source));
  console.log("wrote", p.target);
}
