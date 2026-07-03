/**
 * Parsing + application for the brief-page assistant's streamed replies (see
 * /api/briefs/[id]/chat). The model streams a note plus, when the turn changes
 * the ticket, TARGETED edits (preferred - small, precise, fast):
 *
 *   <note>short reply</note>
 *   <edit><find>verbatim text from the body</find><replace>new text</replace></edit>
 *   <title>New title</title>                ← title-only change
 *   <ticket># Title\nbody…</ticket>         ← full rewrite, restructures only
 *
 * Parsed incrementally on every chunk: completed <edit> blocks apply one by
 * one as they arrive, so the doc updates in place instead of being rewritten
 * top to bottom. Pure + unit-tested; shared by the client (live apply) and
 * the route (persistence), so both always compute the same final document.
 */

export type EditOp = { find: string; replace: string };

export type ParsedAssistant = {
  /** The conversational reply, possibly still mid-stream. */
  note: string;
  /** Title-only change (<title> tag), once complete. */
  title: string | null;
  /** COMPLETED targeted edits so far, in stream order. */
  edits: EditOp[];
  /** Full-rewrite ticket; body grows as tokens arrive. */
  ticket: { title: string | null; body: string } | null;
  /** True once the closing </ticket> has been received. */
  ticketComplete: boolean;
};

/** Trim a trailing PARTIAL occurrence of `tag` so a half-received tag is never
 *  rendered mid-stream. */
function stripPartialTag(s: string, tag: string): string {
  for (let n = tag.length - 1; n > 0; n--) {
    if (s.endsWith(tag.slice(0, n))) return s.slice(0, -n);
  }
  return s;
}

/** Back-compat helper (ticket bodies): trim a trailing partial "</ticket>". */
export function stripPartialClose(s: string): string {
  return stripPartialTag(s, "</ticket>");
}

/** Split ticket markdown into its "# Title" first line and the body below. */
export function splitTicketMd(md: string): { title: string | null; body: string } {
  const t = /^#\s+(.+)$/m.exec(md);
  if (!t) return { title: null, body: md.trim() };
  return { title: t[1].trim(), body: md.slice(t.index + t[0].length).replace(/^\s+/, "").trimEnd() };
}

/** Where in the doc a targeted edit lands. Exact match first; falls back to
 *  the trimmed needle so cosmetic whitespace drift doesn't fail the op. First
 *  occurrence only - <find> is required to be unique-with-context. Exposed so
 *  the client can TYPE the replacement in at the right spot (mid-doc caret). */
export function locateEdit(md: string, op: EditOp): { index: number; length: number } | null {
  const tryOne = (needle: string): { index: number; length: number } | null => {
    if (!needle) return null;
    const i = md.indexOf(needle);
    if (i === -1) return null;
    return { index: i, length: needle.length };
  };
  return tryOne(op.find) ?? tryOne(op.find.trim());
}

/** Apply one targeted edit (see locateEdit for matching rules). */
export function applyEdit(md: string, op: EditOp): { md: string; ok: boolean } {
  const loc = locateEdit(md, op);
  if (!loc) return { md, ok: false };
  return { md: md.slice(0, loc.index) + op.replace + md.slice(loc.index + loc.length), ok: true };
}

/** Private-use sentinel marking the live typing position inside streamed
 *  markdown. Survives mdToHtml's escaping untouched; the editor swaps it for
 *  the blinking caret span, so the caret rides mid-document as edits type in. */
export const CURSOR_SENTINEL = "\uE000";

/** Apply edits in stream order; unmatched ops are skipped (and counted). */
export function applyEdits(md: string, ops: EditOp[]): { md: string; applied: number; failed: number } {
  let cur = md;
  let applied = 0;
  let failed = 0;
  for (const op of ops) {
    const r = applyEdit(cur, op);
    cur = r.md;
    if (r.ok) applied++;
    else failed++;
  }
  return { md: cur, applied, failed };
}

const EDIT_RE = /<edit>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/g;

/** Parse the accumulated stream so far (safe to call on every chunk). */
export function parseAssistantStream(acc: string): ParsedAssistant {
  let note = "";
  const ns = acc.indexOf("<note>");
  if (ns !== -1) {
    const ne = acc.indexOf("</note>", ns);
    note = (ne !== -1 ? acc.slice(ns + 6, ne) : acc.slice(ns + 6)).trim();
    if (ne === -1) {
      // Still streaming: hide any partially-received follow-up tag.
      for (const tag of ["</note>", "<ticket>", "<edit>", "<title>"]) {
        const stripped = stripPartialTag(note, tag);
        if (stripped !== note) {
          note = stripped.trimEnd();
          break;
        }
      }
    }
  }

  const tm = /<title>([\s\S]*?)<\/title>/.exec(acc);
  const title = tm ? tm[1].trim() || null : null;

  const edits: EditOp[] = [];
  EDIT_RE.lastIndex = 0;
  for (let m = EDIT_RE.exec(acc); m; m = EDIT_RE.exec(acc)) {
    edits.push({ find: m[1].replace(/^\n/, "").replace(/\n$/, ""), replace: m[2].replace(/^\n/, "").replace(/\n$/, "") });
  }

  const ts = acc.indexOf("<ticket>");
  if (ts === -1) return { note, title, edits, ticket: null, ticketComplete: false };

  const after = acc.slice(ts + 8).replace(/^\s+/, "");
  const te = after.indexOf("</ticket>");
  const md = te !== -1 ? after.slice(0, te).trimEnd() : stripPartialClose(after);
  return { note, title, edits, ticket: splitTicketMd(md), ticketComplete: te !== -1 };
}
