// The body of a Notion ticket page, as blocks. Pure, and unit-tested in
// notion.test.ts.
//
// Evidence goes into Notion itself where it can: notion.ts uploads each file
// through Notion's File Upload API first, and the block refers to that upload.
// A file that could not be uploaded (over the workspace's size limit, or
// refused) is embedded by the stable Brief-hosted url instead (see
// app/api/evidence/[shareId]), the same way GitHub does it, so the same rules
// about what to embed and how to label it apply either way.

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
 * One evidence file, with the id of its Notion file upload when its bytes went
 * to Notion. Without one, the file is embedded by its url.
 */
export type NotionEvidence = IssueInput["evidence"][number] & { fileUploadId?: string };

/**
 * Video formats Notion's video block plays from an external url. Anything else
 * (WebM, which is what most screen recordings are) gets a link instead when it
 * is embedded by url: an external video block Notion cannot play is rejected,
 * and with it the whole page. An uploaded WebM plays like any other upload.
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
 * The evidence, as blocks: an uploaded file by its upload, anything else by url.
 *
 * An uploaded image or video is Notion's own file, so it shows and plays like
 * one pasted in by hand (a WebM recording included). The rest is embedded by
 * the stable Brief-hosted url, and the rules are GitHub's:
 *  - a file with no `url` (a keyframe, deleted right after filing) is skipped
 *    rather than linked to something that will 404;
 *  - a url Notion cannot reach (a localhost APP_URL in development) is skipped
 *    rather than shown as a broken image in a real ticket;
 * and for every file, uploaded or not:
 *  - the caption sits directly above its image, where a reader looks first,
 *    instead of in Notion's small grey caption under it;
 *  - a recording is "Screen recording", never its file name: the ticket never
 *    says how the report was captured.
 */
export function evidenceBlocks(evidence: NotionEvidence[] | undefined): NotionBlock[] {
  const out: NotionBlock[] = [];
  let skipped = 0;
  for (const e of evidence ?? []) {
    if (e.fileUploadId) {
      const file = { type: "file_upload", file_upload: { id: e.fileUploadId } };
      if (e.contentType.startsWith("image/")) {
        if (e.caption?.trim()) out.push(block("paragraph", { rich_text: parseRichText(e.caption.trim()) }));
        out.push(block("image", file));
        continue;
      }
      if (e.contentType.startsWith("video/")) {
        out.push(block("paragraph", { rich_text: [plainText("Screen recording", { bold: true })] }));
        out.push(block("video", file));
        continue;
      }
      // Neither: notion.ts never uploads one, but if it did, the url still works.
    }
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
  evidence: NotionEvidence[] | undefined,
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
