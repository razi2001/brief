/**
 * Parsing for the brief-page assistant's streamed replies (see
 * /api/briefs/[id]/chat). The model streams:
 *
 *   <note>short reply</note>
 *   <ticket>
 *   # Title
 *   body markdown…
 *   </ticket>          ← omitted when the turn changes nothing
 *
 * Parsed incrementally on every chunk, so the note types out and the rewrite
 * streams into the editor live. Pure + unit-tested.
 */

export type ParsedAssistant = {
  /** The conversational reply, possibly still mid-stream. */
  note: string;
  /** Present once <ticket> has opened; body grows as tokens arrive. */
  ticket: { title: string | null; body: string } | null;
  /** True once the closing </ticket> has been received. */
  ticketComplete: boolean;
};

/** Trim a trailing PARTIAL "</ticket>" so a half-received closing tag is never
 *  rendered into the document mid-stream. */
export function stripPartialClose(s: string): string {
  const CLOSE = "</ticket>";
  for (let n = CLOSE.length - 1; n > 0; n--) {
    if (s.endsWith(CLOSE.slice(0, n))) return s.slice(0, -n);
  }
  return s;
}

/** Split ticket markdown into its "# Title" first line and the body below. */
export function splitTicketMd(md: string): { title: string | null; body: string } {
  const t = /^#\s+(.+)$/m.exec(md);
  if (!t) return { title: null, body: md.trim() };
  return { title: t[1].trim(), body: md.slice(t.index + t[0].length).replace(/^\s+/, "").trimEnd() };
}

/** Parse the accumulated stream so far (safe to call on every chunk). */
export function parseAssistantStream(acc: string): ParsedAssistant {
  let note = "";
  const ns = acc.indexOf("<note>");
  if (ns !== -1) {
    const ne = acc.indexOf("</note>", ns);
    note = (ne !== -1 ? acc.slice(ns + 6, ne) : acc.slice(ns + 6)).trim();
    // A note still streaming may end in a partial "</note>" - hide it.
    if (ne === -1) {
      const CLOSE = "</note>";
      for (let n = CLOSE.length - 1; n > 0; n--) {
        if (note.endsWith(CLOSE.slice(0, n))) {
          note = note.slice(0, -n).trimEnd();
          break;
        }
      }
      // Same for a ticket tag opening right after the note text.
      const OPEN = "<ticket>";
      for (let n = OPEN.length; n > 0; n--) {
        if (note.endsWith(OPEN.slice(0, n))) {
          note = note.slice(0, -n).trimEnd();
          break;
        }
      }
    }
  }

  const ts = acc.indexOf("<ticket>");
  if (ts === -1) return { note, ticket: null, ticketComplete: false };

  const after = acc.slice(ts + 8).replace(/^\s+/, "");
  const te = after.indexOf("</ticket>");
  const md = te !== -1 ? after.slice(0, te).trimEnd() : stripPartialClose(after);
  return { note, ticket: splitTicketMd(md), ticketComplete: te !== -1 };
}
