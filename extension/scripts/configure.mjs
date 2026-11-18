// Points the extension at your own Brief server.
//
//   node extension/scripts/configure.mjs https://brief.example.com
//   node extension/scripts/configure.mjs http://localhost:3000
//
// Rewrites config.js (the backend the extension calls) and manifest.json
// (the only site allowed to hand it a pairing token). Then reload the
// extension at chrome://extensions. Run it again to switch back:
//   node extension/scripts/configure.mjs https://cloud.get-brief.app
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
let origin;
try {
  origin = new URL(arg).origin;
} catch {
  console.error("Usage: node extension/scripts/configure.mjs <your Brief URL, e.g. https://brief.example.com>");
  process.exit(1);
}

const configPath = join(root, "config.js");
let config = readFileSync(configPath, "utf8");
config = config
  .replace(/export const ENV = "[a-z]+";/, 'export const ENV = "prod";')
  .replace(/prod: "[^"]*"/, `prod: "${origin}"`);
writeFileSync(configPath, config);

const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.externally_connectable = { ...manifest.externally_connectable, matches: [`${origin}/*`] };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Extension now talks to ${origin}. Reload it at chrome://extensions.`);
