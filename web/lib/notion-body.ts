// The body of a Notion ticket page, as blocks. Pure, and unit-tested in
// notion.test.ts.
//
// Notion has no upload step in this adapter: evidence is embedded by the
// stable Brief-hosted url (see app/api/evidence/[shareId]), the same way
// GitHub does it, so the same rules about what to embed and how to label it
// apply here.

import { BRIEF_ATTRIBUTION, type IssueInput } from "./tracker";
import {
  block,
  blockText,
  detailsToggles,
  isHttpUrl,
  markdownToBlocks,
  parseRichText,
  type NotionBlock,
  type NotionRichText,
} from "./notion-blocks";
import { hasEvidenceHeading, isPubliclyFetchable } from "@/lib/ticket-body";

/**
 * Video formats Notion's video block plays from an external url. Anything else
 * (WebM, which is what most screen recordings are) gets a link instead: a
 * video block Notion cannot play is rejected, and with it the whole page.
 */
const NOTION_VIDEO = /\.(amv|asf|avi|f4v|flv|gifv|mkv|mov|mpg|mpeg|mpv|mp4|m4v|qt|wmv)$/i;

function notionPlaysVideo(url: string): boolean {
  try {
    return NOTION_VIDEO.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function plainText(content: string, opts: { bold?: boolean; url?: string } = {}): NotionRichText {
  return {
    type: "text",
    text: opts.url ? { content, link: { url: opts.url } } : { content },
    ...(opts.bold ? { annotations: { bold: true } } : {}),
  };
}

function headingLevel(b: NotionBlock): number {
  const m = /^heading_([123])$/.exec(b.type);
  return m ? Number(m[1]) : 0;
}

/**
 * The shared rule (ticket-body.ts), applied to a rendered heading instead of a
 * markdown line: a heading block, whatever its level, that says "Evidence" or
 * "Evidence:". The level does not matter here because markdownToBlocks has
 * already decided what is a heading, and a bold label is a heading_3 by now.
 */
function isEvidenceHeading(b: NotionBlock): boolean {
  return headingLevel(b) > 0 && hasEvidenceHeading(`# ${blockText(b)}`);
}

/**
 * The evidence, as blocks, embedded by url.
 *
 * Notion takes an externally hosted image directly, which is why evidence
 * travels with a stable Brief-hosted url. The rules are GitHub's:
 *  - a file with no `url` (a keyframe, deleted right after filing) is skipped
 *    rather than linked to something that will 404;
 *  - a url Notion cannot reach (a localhost APP_URL in development) is skipped
 *    rather than shown as a broken image in a real ticket;
 *  - the caption sits directly above its image, where a reader looks first,
 *    instead of in Notion's small grey caption under it;
 *  - a recording is "Screen recording", never its file name: the ticket never
 *    says how the report was captured.
 */
export function evidenceBlocks(evidence: IssueInput["evidence"]): NotionBlock[] {
  const out: NotionBlock[] = [];
  let skipped = 0;
  for (const e of evidence ?? []) {
    if (!e.url) continue;
    // Not http(s) is not something Notion can embed, and would fail the page.
    if (!isHttpUrl(e.url) || !isPubliclyFetchable(e.url)) {
      skipped += 1;
      continue;
    }
    if (e.contentType.startsWith("image/")) {
      if (e.caption?.trim()) out.push(block("paragraph", { rich_text: parseRichText(e.caption.trim()) }));
      out.push(block("image", { type: "external", external: { url: e.url } }));
    } else if (notionPlaysVideo(e.url)) {
      out.push(block("paragraph", { rich_text: [plainText("Screen recording", { bold: true })] }));
      out.push(block("video", { type: "external", external: { url: e.url } }));
    } else {
      out.push(
        block("paragraph", {
          rich_text: [
            plainText("Screen recording:", { bold: true }),
            plainText(" "),
            plainText("Watch the screen recording", { url: e.url }),
          ],
        }),
      );
    }
  }
  if (skipped) {
    console.warn(
      `[notion-tracker] ${skipped} evidence file(s) not embedded: APP_URL is not reachable from Notion. ` +
        `Set APP_URL to a public origin to get inline screenshots.`,
    );
  }
  return out;
}

/** The agent's markdown, minus an attribution it may have copied in, so the page never carries two. */
function withoutAttribution(markdown: string): string {
  const t = (markdown ?? "").replace(/\s+$/, "");
  if (!t.endsWith(BRIEF_ATTRIBUTION)) return t;
  return t
    .slice(0, -BRIEF_ATTRIBUTION.length)
    .replace(/(?:^|\n)\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, "")
    .replace(/\s+$/, "");
}

/**
 * The whole page body, in reading order: the report, the evidence, the
 * technical logs folded one toggle per video, then the attribution.
 *
 * The agent is told not to write its own Evidence section but sometimes does,
 * and adding a second one gave tickets the heading twice. So when the body
 * already has one, the evidence goes at the end of THAT section (before the
 * next heading of the same or a higher level) rather than under a new heading.
 */
export function buildNotionBody(
  descriptionMarkdown: string,
  evidence: IssueInput["evidence"],
  details?: IssueInput["details"],
): NotionBlock[] {
  const blocks = markdownToBlocks(withoutAttribution(descriptionMarkdown));
  const media = evidenceBlocks(evidence);

  if (media.length) {
    const at = blocks.findIndex(isEvidenceHeading);
    if (at === -1) {
      blocks.push(block("heading_2", { rich_text: [plainText("Evidence")] }), ...media);
    } else {
      const level = headingLevel(blocks[at]);
      let end = at + 1;
      while (end < blocks.length && !(headingLevel(blocks[end]) > 0 && headingLevel(blocks[end]) <= level)) {
        end += 1;
      }
      blocks.splice(end, 0, ...media);
    }
  }

  return [
    ...blocks,
    ...detailsToggles(details),
    // Last, under a divider, so it never comes between the reader and the report.
    block("divider", {}),
    ...markdownToBlocks(BRIEF_ATTRIBUTION),
  ];
}
