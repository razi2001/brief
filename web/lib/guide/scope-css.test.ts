import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_PAGES, EXTENSION_SHEETS, copyPage, scopeCss } from "./scope-css";

const web = join(__dirname, "..", "..");
/** Line endings aside (a Windows checkout may turn them into CRLF). */
const lf = (s: string) => s.replace(/\r\n/g, "\n");

describe("the Guide's copies of the extension's stylesheets", () => {
  for (const s of EXTENSION_SHEETS) {
    it(`${s.target} is ${s.source} as it is now (run: node scripts/sync-guide-css.mjs)`, () => {
      const source = readFileSync(join(web, "..", s.source), "utf8");
      const copy = readFileSync(join(web, s.target), "utf8");
      expect(lf(copy)).toBe(lf(scopeCss(lf(source), s.scope, s.source)));
    });
  }

  for (const p of EXTENSION_PAGES) {
    it(`${p.target} is ${p.source} as it is now (run: node scripts/sync-guide-css.mjs)`, () => {
      const html = readFileSync(join(web, "..", p.source), "utf8");
      expect(lf(readFileSync(join(web, p.target), "utf8"))).toBe(lf(copyPage(lf(html), p.scope, p.source)));
    });
  }

  it("applies only inside its scope, page rules on the scope itself, animations renamed, fonts left to the app", () => {
    const out = scopeCss(
      ":root { --a:1; } html, body { width:360px; } body:has(#x) { --h:2px; } .tile, .gal > b { color:red; } @media (max-width:1px) { .a { b:c; } } @keyframes pop { from { opacity:0; } } .b { animation: pop .2s; } @font-face { font-family: X; }",
      "xp",
    );
    expect(out).toContain(".xp { --a:1; }");
    expect(out).toContain(".xp, .xp { width:360px; }");
    expect(out).toContain(".xp:has(#x) { --h:2px; }");
    expect(out).toContain(".xp .tile, .xp .gal > b { color:red; }");
    expect(out).toContain("@media (max-width:1px) { .xp .a { b:c; } }");
    expect(out).toContain("@keyframes xp-pop");
    expect(out).toContain("animation: xp-pop .2s;");
    expect(out).not.toContain("font-family: X");
  });
});
