// Markdown -> Notion blocks. Pure, and unit-tested in notion-blocks.test.ts.
//
// Notion has no markdown ingest: a page body is a tree of typed block objects,
// so the agent's markdown has to be parsed into real headings, lists, code
// blocks and images or the ticket arrives as one wall of literal asterisks.
// This is Notion's counterpart to markdownToAdf in jira.ts, and it supports the
// same structure the agent actually emits.

export interface NotionAnnotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface NotionRichText {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: NotionAnnotations;
}

export interface NotionBlock {
  object: "block";
  type: string;
  [key: string]: unknown;
}

/** Notion rejects any single rich-text item longer than this. */
export const RICH_TEXT_LIMIT = 2000;
/** Notion accepts at most this many children in one create/append call. */
export const CHILDREN_LIMIT = 100;

function text(
  content: string,
  annotations?: NotionAnnotations,
  url?: string,
): NotionRichText {
  const node: NotionRichText = {
    type: "text",
    text: url ? { content, link: { url } } : { content },
  };
  if (annotations && Object.keys(annotations).length) node.annotations = annotations;
  return node;
}

/**
 * Split a string that exceeds Notion's per-item cap into several items. Done on
 * the rich-text item rather than the block, so a long paragraph stays ONE
 * paragraph instead of being torn into several.
 */
function splitLong(content: string, make: (chunk: string) => NotionRichText): NotionRichText[] {
  if (content.length <= RICH_TEXT_LIMIT) return [make(content)];
  const out: NotionRichText[] = [];
  for (let i = 0; i < content.length; i += RICH_TEXT_LIMIT) {
    out.push(make(content.slice(i, i + RICH_TEXT_LIMIT)));
  }
  return out;
}

/** Notion rejects any URL longer than this. */
export const URL_LIMIT = 2000;

/**
 * True for a URL Notion will take as a link or an external image: absolute,
 * http(s), and within its length cap. The agent sometimes writes a relative
 * link ("/settings") or a bare anchor, and Notion rejects the WHOLE page for
 * one of those, so anything else is rendered as plain text instead.
 */
export function isHttpUrl(url?: string): boolean {
  if (!url || url.length > URL_LIMIT) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Literal text as rich text, split at the per-item cap, with no markdown read into it. */
export function plainRichText(content: string): NotionRichText[] {
  return content ? splitLong(content, (c) => text(c)) : [];
}

// Inline markdown: ![alt](url), [label](url), **bold**, *italic*, `code`.
const INLINE_RE =
  /(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(`[^`]+`)/g;

/** Parse one line of markdown into Notion rich-text items. */
export function parseRichText(input: string): NotionRichText[] {
  const src = (input ?? "").trim();
  const out: NotionRichText[] = [];
  if (!src) return out;

  const push = (content: string, annotations?: NotionAnnotations, url?: string) => {
    if (!content) return;
    out.push(...splitLong(content, (c) => text(c, annotations, url)));
  };

  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(src))) {
    if (m.index > last) push(src.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      // An inline image inside a paragraph becomes a link - a standalone image
      // line is turned into a real image block by parseMarkdownBlocks instead.
      const im = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok)!;
      push(im[1] || im[2], undefined, isHttpUrl(im[2]) ? im[2] : undefined);
    } else if (m[2]) {
      // A link Notion would refuse keeps its label as plain text.
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!;
      push(lm[1], undefined, isHttpUrl(lm[2]) ? lm[2] : undefined);
    } else if (m[3]) {
      push(tok.slice(2, -2), { bold: true });
    } else if (m[4]) {
      push(tok.slice(1, -1), { italic: true });
    } else if (m[5]) {
      push(tok.slice(1, -1), { code: true });
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < src.length) push(src.slice(last));
  return out;
}

export function block(type: string, payload: Record<string, unknown>): NotionBlock {
  return { object: "block", type, [type]: payload };
}

/** The plain text a block shows, for matching headings by what they say. */
export function blockText(b: NotionBlock): string {
  const rich = (b[b.type] as { rich_text?: NotionRichText[] } | undefined)?.rich_text ?? [];
  return rich.map((t) => t.text.content).join("");
}

/** Languages Notion accepts on a code block; anything else becomes plain text. */
const CODE_LANGUAGES = new Set([
  "bash", "c", "c#", "c++", "css", "diff", "docker", "go", "graphql", "html",
  "java", "javascript", "json", "kotlin", "less", "markdown", "makefile",
  "objective-c", "php", "plain text", "powershell", "python", "ruby", "rust",
  "scala", "scss", "shell", "sql", "swift", "typescript", "xml", "yaml",
]);

export function codeLanguage(lang?: string): string {
  const l = (lang ?? "").trim().toLowerCase();
  if (!l) return "plain text";
  if (CODE_LANGUAGES.has(l)) return l;
  // Common shorthands the agent writes that Notion spells differently.
  const alias: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "shell",
    yml: "yaml",
    text: "plain text",
    txt: "plain text",
    console: "shell",
    jsx: "javascript",
    tsx: "typescript",
  };
  return alias[l] ?? "plain text";
}

/**
 * Convert markdown into Notion blocks.
 *
 * Mirrors the structure markdownToAdf handles for Jira, including the "a whole
 * line wrapped in ** **" convention the agent uses for section labels ("**Steps
 * to reproduce**"), which becomes a real heading rather than a bold paragraph.
 */
export function markdownToBlocks(markdown: string): NotionBlock[] {
  const lines = (markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: NotionBlock[] = [];

  const isOrdered = (l: string) => /^\s*\d+\.\s+/.test(l);
  const isBullet = (l: string) => /^\s*[-*]\s+/.test(l);
  const isTodo = (l: string) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(l);
  const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
  const isWholeBold = (l: string) => /^\*\*(.+)\*\*$/.test(l.trim());
  const isQuote = (l: string) => /^\s*>\s?/.test(l);
  const isRule = (l: string) => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  const standaloneImage = (l: string) => /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(l.trim());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      const content = code.join("\n") || " ";
      blocks.push(
        block("code", {
          language: codeLanguage(lang),
          rich_text: splitLong(content, (c) => text(c)),
        }),
      );
      continue;
    }

    if (isRule(line)) {
      blocks.push(block("divider", {}));
      i++;
      continue;
    }

    // A line that is nothing but an image becomes a real image block, so the
    // screenshot renders in the page instead of showing up as a link. Only for
    // an absolute http(s) url: anything else would fail the page, so it falls
    // through and is read as an ordinary paragraph.
    const img = standaloneImage(line);
    if (img && isHttpUrl(img[2])) {
      blocks.push(
        block("image", {
          type: "external",
          external: { url: img[2] },
          ...(img[1] ? { caption: parseRichText(img[1]) } : {}),
        }),
      );
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // Notion only has three heading levels; deeper ones clamp to heading_3.
      const level = Math.min(h[1].length, 3);
      blocks.push(block(`heading_${level}`, { rich_text: parseRichText(h[2]) }));
      i++;
      continue;
    }

    const wb = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (wb) {
      blocks.push(block("heading_3", { rich_text: parseRichText(wb[1]) }));
      i++;
      continue;
    }

    if (isQuote(line)) {
      const quoted: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(block("quote", { rich_text: parseRichText(quoted.join(" ")) }));
      continue;
    }

    // Task list, checked before plain bullets since it looks like one.
    if (isTodo(line)) {
      while (i < lines.length && isTodo(lines[i])) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i])!;
        blocks.push(
          block("to_do", {
            checked: m[1].toLowerCase() === "x",
            rich_text: parseRichText(m[2]),
          }),
        );
        i++;
      }
      continue;
    }

    if (isOrdered(line)) {
      while (i < lines.length && isOrdered(lines[i])) {
        blocks.push(
          block("numbered_list_item", {
            rich_text: parseRichText(lines[i].replace(/^\s*\d+\.\s+/, "")),
          }),
        );
        i++;
      }
      continue;
    }

    if (isBullet(line)) {
      while (i < lines.length && isBullet(lines[i]) && !isTodo(lines[i])) {
        blocks.push(
          block("bulleted_list_item", {
            rich_text: parseRichText(lines[i].replace(/^\s*[-*]\s+/, "")),
          }),
        );
        i++;
      }
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i].trim()) &&
      !isHeading(lines[i]) &&
      !isWholeBold(lines[i]) &&
      !isOrdered(lines[i]) &&
      !isBullet(lines[i]) &&
      !isQuote(lines[i]) &&
      !isRule(lines[i]) &&
      !standaloneImage(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(block("paragraph", { rich_text: parseRichText(para.join(" ")) }));
  }

  return blocks;
}

/** The nested children a block carries, if any (toggles do). */
function childrenOf(b: NotionBlock): NotionBlock[] | undefined {
  const payload = b[b.type] as { children?: unknown } | undefined;
  return payload && Array.isArray(payload.children) ? (payload.children as NotionBlock[]) : undefined;
}

/**
 * Lift any nested children up to sibling level, in reading order.
 *
 * Notion accepts only two levels of nesting in one request, and a toggle is
 * already the first: whatever goes inside it has to be flat or the whole page
 * create is rejected. markdownToBlocks emits flat blocks today, so this is the
 * guarantee rather than a transformation that normally does anything.
 */
export function flattenBlocks(blocks: NotionBlock[]): NotionBlock[] {
  const out: NotionBlock[] = [];
  for (const b of blocks) {
    const kids = childrenOf(b);
    if (!kids) {
      out.push(b);
      continue;
    }
    const payload = { ...(b[b.type] as Record<string, unknown>) };
    delete payload.children;
    out.push({ ...b, [b.type]: payload }, ...flattenBlocks(kids));
  }
  return out;
}

/**
 * A collapsed toggle with a title and flat content.
 *
 * The children are capped at Notion's per-array limit. A technical-logs
 * section renders as a handful of blocks (a note, a label, a code block per
 * part), so the cap is a guard against a rejected request, not a real cut.
 */
export function toggleBlock(title: string, children: NotionBlock[]): NotionBlock {
  return block("toggle", {
    rich_text: [text(title.slice(0, RICH_TEXT_LIMIT))],
    children: flattenBlocks(children).slice(0, CHILDREN_LIMIT),
  });
}

/**
 * The technical logs, one toggle per video, so the exact network and console
 * data is in the ticket without burying the report under it.
 */
export function detailsToggles(details?: Array<{ title: string; markdown: string }>): NotionBlock[] {
  return (details ?? [])
    .filter((d) => d.markdown.trim())
    .map((d) => toggleBlock(d.title, markdownToBlocks(d.markdown)));
}

/** Notion accepts at most this many block elements, nested ones included, per request. */
export const BLOCKS_PER_REQUEST = 1000;

/** How many block elements this block costs a request: itself plus everything inside it. */
function blockWeight(b: NotionBlock): number {
  return 1 + (childrenOf(b) ?? []).reduce((n, k) => n + blockWeight(k), 0);
}

/**
 * Split blocks into create/append-sized batches.
 *
 * Two limits apply to every request: at most 100 top-level children, and at
 * most 1000 block elements counting the ones nested inside toggles. A batch
 * closes at whichever comes first, so a body with several full toggles still
 * goes through rather than being rejected whole.
 */
export function batchBlocks(blocks: NotionBlock[]): NotionBlock[][] {
  const out: NotionBlock[][] = [];
  let current: NotionBlock[] = [];
  let weight = 0;
  for (const b of blocks) {
    const w = blockWeight(b);
    if (current.length && (current.length >= CHILDREN_LIMIT || weight + w > BLOCKS_PER_REQUEST)) {
      out.push(current);
      current = [];
      weight = 0;
    }
    current.push(b);
    weight += w;
  }
  if (current.length) out.push(current);
  return out;
}
