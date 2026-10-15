// Markdown -> Asana rich text, for a task's `html_notes`.
//
// Asana's rich text is not HTML. It is a small XML dialect wrapped in <body>,
// and the API answers 400 to anything outside it: a <p>, a <br>, a <table>, a
// `target` attribute, a bare "&" in a URL. md-html.ts emits several of those
// for the in-app read view, so this converter is separate and emits ONLY the
// tags in ASANA_TAGS, always as well-formed XML.
//
// Asana also has no paragraph element. A line of text ends with "\n", and the
// block elements (headings, lists, code, quotes, rules) stand on their own
// with nothing around them. So text lines are joined with "\n" and blocks are
// never padded with newlines, which would show up as empty lines in the task.

import { promoteSectionHeadings } from "./ticket-body";

/** Every tag this converter may emit. Anything else is a 400 from Asana. */
export const ASANA_TAGS = [
  "body",
  "h1",
  "h2",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "ol",
  "ul",
  "li",
  "a",
  "blockquote",
  "hr",
  "img",
] as const;

/**
 * An inline image has to reference an attachment ALREADY uploaded to the task,
 * by its gid, so it cannot be expressed in ordinary markdown. The adapter
 * writes this pseudo-URL instead and the converter turns it into
 * `<img data-asana-gid="..."/>`.
 */
const ATTACHMENT_SCHEME = "asana-attachment:";

/** Markdown for an inline image of an attachment on the same task. */
export function asanaImage(attachmentGid: string): string {
  return `![](${ATTACHMENT_SCHEME}${attachmentGid})`;
}

// Characters XML 1.0 forbids outright. One stray control byte pasted into a
// description would otherwise make Asana reject the whole task.
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Text XML can carry: lone UTF-16 surrogates (half an emoji, cut by a
 * truncation somewhere upstream) become U+FFFD, and forbidden characters go.
 */
function xmlSafe(s: string): string {
  return (s ?? "").toWellFormed().replace(XML_INVALID, "");
}

/** Escape text and attribute values alike (attributes are always double-quoted). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHttp(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url);
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

// A link target may hold one level of balanced parentheses, as Wikipedia URLs
// do, so "(...)" inside it does not end the link early.
const URL_TARGET = /((?:[^()\s]|\([^()\s]*\))+)/.source;

// A bare URL: balanced "(...)" groups are part of it ("/wiki/Foo_(bar)"), but a
// closing paren or sentence punctuation right after it is the prose around it
// ("(see https://x.com/a).").
const BARE_URL =
  /(https?:\/\/(?:[^\s<>"()]|\([^\s<>"()]*\))*(?:[^\s<>"().,;:!?'\]]|\([^\s<>"()]*\)))/.source;

// One alternation, so the LEFTMOST construct wins and nothing is matched
// inside something else. Group numbers are read in inlineToken.
const INLINE_SOURCE = [
  /`([^`]+)`/.source, // 1 code
  `!\\[([^\\]]*)\\]\\(\\s*${URL_TARGET}(?:\\s+"[^"]*")?\\s*\\)`, // 2 alt, 3 url
  `\\[([^\\]]+)\\]\\(\\s*${URL_TARGET}(?:\\s+"[^"]*")?\\s*\\)`, // 4 text, 5 url
  /<(https?:\/\/[^\s>]+)>/.source, // 6 autolink
  BARE_URL, // 7 bare url
  /\*\*\*(.+?)\*\*\*/.source, // 8 bold italic
  /\*\*(.+?)\*\*/.source, // 9 bold
  /__(.+?)__/.source, // 10 bold
  /~~(.+?)~~/.source, // 11 strike
  /\*([^*\s](?:[^*]*[^*\s])?)\*/.source, // 12 italic
  // Underscore italics only at word edges, so snake_case_names stay text.
  /(?<!\w)_([^_\s](?:[^_]*[^_\s])?)_(?!\w)/.source, // 13 italic
].join("|");

/**
 * Render one line of markdown inline. `links` is off inside a link's own text,
 * because an <a> inside an <a> is something Asana's editor cannot represent.
 */
function inline(raw: string, links = true): string {
  let out = "";
  let last = 0;
  // A fresh regex per call: the recursion below would otherwise share lastIndex.
  for (const m of raw.matchAll(new RegExp(INLINE_SOURCE, "g"))) {
    out += esc(raw.slice(last, m.index));
    out += inlineToken(m, links);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + esc(raw.slice(last));
}

function inlineToken(m: RegExpMatchArray, links: boolean): string {
  if (m[1] !== undefined) return `<code>${esc(m[1])}</code>`;
  if (m[3] !== undefined) {
    const url = m[3];
    const gid = url.startsWith(ATTACHMENT_SCHEME) ? url.slice(ATTACHMENT_SCHEME.length) : "";
    // Digits only: the gid lands in an attribute, so nothing else may pass.
    if (/^\d+$/.test(gid)) return `<img data-asana-gid="${gid}"/>`;
    // Any other image cannot be embedded (Asana only inlines its own
    // attachments), so it degrades to a link, or to its alt text.
    const alt = m[2].trim();
    if (links && isHttp(url)) return `<a href="${esc(url)}">${esc(alt || "Image")}</a>`;
    return esc(alt);
  }
  if (m[5] !== undefined) {
    // Only http(s) becomes a link; a javascript: or relative URL keeps its text.
    if (links && isHttp(m[5])) return `<a href="${esc(m[5])}">${inline(m[4], false)}</a>`;
    return inline(m[4], false);
  }
  if (m[6] !== undefined || m[7] !== undefined) {
    const url = (m[6] ?? m[7]) as string;
    return links ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url);
  }
  if (m[8] !== undefined) return `<strong><em>${inline(m[8], links)}</em></strong>`;
  if (m[9] !== undefined || m[10] !== undefined) {
    return `<strong>${inline((m[9] ?? m[10]) as string, links)}</strong>`;
  }
  if (m[11] !== undefined) return `<s>${inline(m[11], links)}</s>`;
  if (m[12] !== undefined || m[13] !== undefined) {
    return `<em>${inline((m[12] ?? m[13]) as string, links)}</em>`;
  }
  return esc(m[0]);
}

/**
 * Headings stay plain text. Emphasis inside a heading adds nothing a reader
 * can see, and it is the least certain corner of what Asana accepts.
 */
function headingText(raw: string): string {
  return esc(stripInline(raw).trim());
}

/** Inline markdown down to its words: links keep their text, markers go. */
function stripInline(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, "$1")
    .replace(/(?<!\w)_([^_\s](?:[^_]*[^_\s])?)_(?!\w)/g, "$1");
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const QUOTE = /^\s{0,3}>\s?/;

function width(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

type ListItem = { indent: number; ordered: boolean; text: string };

function listItem(line: string): ListItem | null {
  const o = /^(\s*)\d{1,9}[.)]\s+(.*)$/.exec(line);
  if (o) return { indent: width(o[1]), ordered: true, text: o[2] };
  // "- - -" is a rule, not an item holding "- -".
  if (HR.test(line)) return null;
  const b = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (b) return { indent: width(b[1]), ordered: false, text: b[2] };
  return null;
}

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || HR.test(line);
}

/** A GFM table's delimiter row, e.g. `|---|:---:|`. */
function isTableDelimiter(line: string): boolean {
  return line.includes("|") && line.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
}

/** One list (and any lists nested in it), starting at `start`. */
function parseList(lines: string[], start: number): { html: string; next: number } {
  const first = listItem(lines[start]) as ListItem;
  const { indent, ordered } = first;
  const items: Array<{ text: string; children: string }> = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line inside a loose list only ends it when what follows is
      // not another item of this list (or of one nested in it).
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = j < lines.length ? listItem(lines[j]) : null;
      if (next && (next.indent > indent || (next.indent === indent && next.ordered === ordered))) {
        i = j;
        continue;
      }
      break;
    }

    const it = listItem(line);
    if (it && it.indent === indent && it.ordered === ordered) {
      items.push({ text: it.text, children: "" });
      i++;
      continue;
    }
    if (it && it.indent > indent && items.length) {
      const nested = parseList(lines, i);
      items[items.length - 1].children += nested.html;
      i = nested.next;
      continue;
    }
    // A wrapped line, indented under its item, belongs to that item.
    if (!it && items.length && width(line) > indent && !isBlockStart(line)) {
      items[items.length - 1].text += ` ${line.trim()}`;
      i++;
      continue;
    }
    break;
  }

  const tag = ordered ? "ol" : "ul";
  const lis = items.map((it) => `<li>${inline(it.text.trim())}${it.children}</li>`).join("");
  return { html: `<${tag}>${lis}</${tag}>`, next: i };
}

/** A line holding nothing but an attachment image. */
const IMAGE_LINE = new RegExp(`^!\\[[^\\]]*\\]\\(${ATTACHMENT_SCHEME}\\d+\\)$`);

/**
 * A "line" is text that ends with "\n" before the next line; a "block" stands
 * on its own. `gap` records a blank line before a text line, which Asana keeps
 * as an empty line between paragraphs.
 */
type Piece = { kind: "line" | "block"; html: string; gap?: boolean };

/**
 * Convert the agent's markdown (plus the adapter's evidence and attribution)
 * into Asana rich text, wrapped in <body>.
 *
 *  - `#` becomes h1 and `##` h2. Asana has nothing smaller, so `###` and
 *    deeper become h2 too, as do whole-line `**Label**` section labels (the
 *    same rule GitHub's adapter applies, so a ticket reads the same in both).
 *  - Fenced code and GFM tables become <pre>. Asana's own tables are not
 *    worth the risk for a few columns of text, and a monospace block keeps
 *    them aligned.
 *  - Links survive for http(s) only.
 *  - `asanaImage(gid)` lines become inline images of task attachments. An
 *    image is a block in Asana's rich text, so it gets no newline around it.
 *  - Paragraphs (text separated by a blank line) keep that blank line.
 */
export function asanaHtml(markdown: string): string {
  const src = promoteSectionHeadings(xmlSafe((markdown ?? "").replace(/\r\n?/g, "\n")));
  const lines = src.split("\n");
  const pieces: Piece[] = [];
  let i = 0;
  let gap = false;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      gap = true;
      i++;
      continue;
    }
    // Only a text line directly after a blank line carries the gap forward.
    const blankBefore = gap;
    gap = false;

    if (IMAGE_LINE.test(line.trim())) {
      pieces.push({ kind: "block", html: inline(line.trim()) });
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = fence[1][0] === "`" ? /^\s{0,3}`{3,}\s*$/ : /^\s{0,3}~{3,}\s*$/;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++; // the closing fence (or past the end, for an unclosed block)
      if (buf.some((l) => l.trim())) pieces.push({ kind: "block", html: `<pre>${esc(buf.join("\n"))}</pre>` });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const buf = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) buf.push(lines[i++]);
      pieces.push({ kind: "block", html: `<pre>${esc(buf.map((l) => l.trim()).join("\n"))}</pre>` });
      continue;
    }

    // Before headings and lists: "---" and "* * *" are rules, not items.
    if (HR.test(line)) {
      pieces.push({ kind: "block", html: "<hr/>" });
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const text = headingText(h[2] ?? "");
      if (text) {
        const tag = h[1].length === 1 ? "h1" : "h2";
        pieces.push({ kind: "block", html: `<${tag}>${text}</${tag}>` });
      }
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        const inner = lines[i].replace(QUOTE, "").trim();
        if (inner) buf.push(inline(inner));
        i++;
      }
      if (buf.length) pieces.push({ kind: "block", html: `<blockquote>${buf.join("\n")}</blockquote>` });
      continue;
    }

    if (listItem(line)) {
      const list = parseList(lines, i);
      pieces.push({ kind: "block", html: list.html });
      i = list.next;
      continue;
    }

    // Plain text keeps its own line breaks: the agent writes "Expected: ..."
    // and "Actual: ..." on consecutive lines and means them as two lines.
    pieces.push({ kind: "line", html: inline(line.trim()), gap: blankBefore });
    i++;
  }

  let body = "";
  pieces.forEach((p, k) => {
    if (k > 0 && p.kind === "line" && pieces[k - 1].kind === "line") body += p.gap ? "\n\n" : "\n";
    body += p.html;
  });
  return `<body>${body}</body>`;
}

/**
 * The same markdown as readable plain text, for Asana's `notes` field: the
 * fallback when the rich text is refused. No markers are left for a reader to
 * squint past ("### Steps", "**Save**"); links keep their URL in parentheses.
 */
export function asanaPlainText(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const raw of xmlSafe((markdown ?? "").replace(/\r\n?/g, "\n")).split("\n")) {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      out.push(raw);
      continue;
    }
    const h = HEADING.exec(raw);
    let line = h ? (h[2] ?? "") : raw.replace(QUOTE, "");
    if (HR.test(line)) {
      out.push("");
      continue;
    }
    // Attachment images exist only in rich text; a link keeps its target.
    line = line
      .replace(new RegExp(`!\\[[^\\]]*\\]\\(${ATTACHMENT_SCHEME}\\d+\\)`, "g"), "")
      .replace(/!?\[([^\]]*)\]\(\s*(https?:\/\/[^)\s]+)\s*\)/g, "$1 ($2)");
    out.push(stripInline(line).replace(/\s+$/, ""));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
