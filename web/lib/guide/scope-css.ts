/**
 * The Guide draws the extension's pages with the extension's own stylesheets,
 * so the picture is the thing. This turns one of them into a copy that only
 * applies inside a scope class: every selector is put under it, the page-level
 * ones (:root, html, body) become the scope itself, and the animations get the
 * scope's prefix so they can't collide with the app's.
 *
 * EXTENSION_SHEETS lists the copies; components/guide/mock/real/*.css are the
 * outputs, written by scripts/sync-guide-css.mjs and kept in step with the
 * extension by scope-css.test.ts.
 */

export type Sheet = {
  /** The stylesheet, from the repository root. */
  source: string;
  /** The copy, from web/. */
  target: string;
  /** The class the copy applies inside (without the dot). */
  scope: string;
};

export const EXTENSION_SHEETS: readonly Sheet[] = [
  { source: "extension/popup.css", target: "components/guide/mock/real/popup.css", scope: "xp" },
  { source: "extension/bar.css", target: "components/guide/mock/real/bar.css", scope: "xb" },
  { source: "extension/editor/editor.css", target: "components/guide/mock/real/editor.css", scope: "xe" },
];

/** Extension pages whose styles sit in the page itself: the Guide copies the style and the body. */
export type PageCopy = { source: string; target: string; scope: string };
export const EXTENSION_PAGES: readonly PageCopy[] = [
  { source: "extension/permission.html", target: "components/guide/mock/real/permission.ts", scope: "xm" },
];

/**
 * A page's copy as a TypeScript module: its <style> scoped like a stylesheet,
 * and its body's markup without scripts (the Guide draws it as it is first shown).
 */
export function copyPage(html: string, scope: string, from: string): string {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1] ?? "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  const css = scopeCss(style, scope, from);
  return `// GENERATED from ${from} by web/scripts/sync-guide-css.mjs. Do not edit: run the script.\nexport const CSS = ${JSON.stringify(css)};\nexport const BODY = ${JSON.stringify(body)};\n`;
}

/** Splits on commas outside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function scopeSelector(sel: string, scope: string): string {
  if (sel === ":root" || sel === "html" || sel === "body") return scope;
  // body.ready, body:has(...), html .y: the page itself is the scope
  const page = sel.match(/^(?:html|body)(?=[.:[\s>~+]|$)/);
  if (page) return scope + sel.slice(page[0].length);
  // the keyframe steps are not selectors
  return `${scope} ${sel}`;
}

/** Index just after the block that opens at `open` (a "{"), skipping strings. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const close = css.indexOf(ch, i + 1);
      i = close < 0 ? css.length : close;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error("unbalanced braces");
}

function scopeRules(css: string, scope: string, prefix: string, frames: Set<string>): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    const head = css.slice(i, open);
    const end = blockEnd(css, open);
    const body = css.slice(open + 1, end - 1);
    const lead = head.match(/^\s*/)?.[0] ?? "";
    const prelude = head.trim();
    if (prelude.startsWith("@keyframes")) {
      const name = prelude.slice("@keyframes".length).trim();
      frames.add(name);
      out += `${lead}@keyframes ${prefix}${name} {${body}}`;
    } else if (prelude.startsWith("@font-face") || prelude.startsWith("@import")) {
      // fonts come from the app
    } else if (prelude.startsWith("@")) {
      out += `${lead}${prelude} {${scopeRules(body, scope, prefix, frames)}}`;
    } else {
      out += `${lead}${splitTop(prelude)
        .map((s) => scopeSelector(s, scope))
        .join(", ")} {${body}}`;
    }
    i = end;
  }
  return out;
}

/** The copy of `source` that applies inside `.${scope}` only. */
export function scopeCss(source: string, scope: string, from = "the extension"): string {
  const sel = `.${scope}`;
  const prefix = `${scope}-`;
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const frames = new Set<string>();
  let out = scopeRules(css, sel, prefix, frames);
  // the animations by their new names
  out = out.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (_, prop: string, value: string) =>
    prop + value.replace(/[A-Za-z_][\w-]*/g, (word) => (frames.has(word) ? prefix + word : word)),
  );
  const lines = out
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l, n, all) => l !== "" || (n > 0 && all[n - 1] !== ""));
  const tail = `
/* the Guide's own: the app's fonts, shown at once (no page script runs here),
   its fixed parts held inside it, and the app's .sheet look kept off it */
${sel} {
  --display: var(--font-display), 'Instrument Serif', Georgia, serif;
  --mono: var(--font-mono), 'JetBrains Mono', ui-monospace, monospace;
  opacity: 1;
  contain: layout;
}
${sel} .sheet { backdrop-filter: none; -webkit-backdrop-filter: none; }
`;
  return `/* GENERATED from ${from} by web/scripts/sync-guide-css.mjs. Do not edit: run the script. */\n${lines.join("\n").trim()}\n${tail}`;
}
