// The ticket-body rules every tracker adapter shares: which evidence URLs a
// tracker can fetch, how section labels become headings, where the evidence
// goes, what an evidence file is called, and how the technical logs fold away
// or travel as a file.
//
// Pure, with nothing behind it. These used to live in github.ts, which made
// every adapter (and every adapter's tests) load the GitHub adapter and Clerk
// just to place a screenshot. Keeping one copy here is also what keeps the
// adapters agreeing on what counts as the agent's Evidence heading: when each
// had its own, a "## Evidence:" got a second heading on one tracker and a
// "##### Evidence" got none at all on another.

// ---------------------------------------------------------------------------
// Evidence URLs
// ---------------------------------------------------------------------------

/**
 * A tracker that embeds an image by URL fetches it from its own servers
 * (GitHub through its camo proxy, Notion), and a linked recording is opened
 * from a teammate's machine, so a URL only this machine can reach is a broken
 * image or a dead link forever. A localhost APP_URL - i.e. local development -
 * is exactly that case, and a broken image in a real ticket is worse than no
 * image.
 */
export function isPubliclyFetchable(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    // URL keeps an IPv6 host in brackets ("[::1]"), so the bare form never matches.
    if (host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]" || host === "::1") return false;
    // RFC1918 / link-local: reachable on your network, not from the tracker's.
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Section labels
// ---------------------------------------------------------------------------

/**
 * The label a line holds when the WHOLE line is bold ("**Steps to reproduce**"
 * holds "Steps to reproduce"), else null. A bold sentence ("**It crashed.**")
 * is prose someone happened to bold, not a label.
 */
function boldLabel(line: string): string | null {
  const m = /^\s{0,3}\*\*(.+?)\*\*\s*$/.exec(line);
  if (!m) return null;
  const text = m[1].trim();
  // A label, not a sentence someone happened to bold entirely.
  if (!text || text.length > 60 || /[.!?]$/.test(text)) return null;
  return text;
}

/**
 * Promote a line that is ENTIRELY bold into a real heading.
 *
 * The agent writes section labels as "**Steps to reproduce**", a convention the
 * other adapters already turn into a heading (Jira -> h3, Notion -> heading_3).
 * GitHub renders markdown verbatim, so those arrived as bold paragraphs and the
 * issue had no navigable structure - no anchors, no outline, nothing for the
 * eye to catch when scanning.
 *
 * Only a WHOLE line is promoted. "**Expected** the full name is visible" is a
 * bold lead-in to a sentence, not a section, and turning that into a heading
 * would push its own text onto the next line.
 */
export function promoteSectionHeadings(markdown: string): string {
  return (markdown ?? "")
    .split("\n")
    .map((line) => {
      const label = boldLabel(line);
      return label === null ? line : `### ${label}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// The agent's Evidence section
// ---------------------------------------------------------------------------

/**
 * The agent's Evidence heading, as exactly what mdToHtml renders as a heading:
 * one to four "#" at the very start of the line, then whitespace. Anything
 * looser ("##Evidence", an indented "  ## Evidence", "##### Evidence") is a
 * plain paragraph there, and treating it as the heading would leave the
 * screenshots under no heading at all. "Evidence:" counts, as the agent writes
 * labels with and without the colon.
 */
const EVIDENCE_HEADING = /^(#{1,4})[ \t]+evidence[ \t]*:?[ \t]*$/i;
const EVIDENCE_LABEL = /^evidence[ \t]*:?$/i;

/**
 * The level a bold "**Evidence**" label stands for: the heading
 * promoteSectionHeadings turns it into, so the section ends in the same place
 * whether or not the body was promoted first.
 */
const LABEL_LEVEL = 3;

/**
 * A heading that can end the Evidence section. Up to six "#" so a tracker that
 * flattens levels (Asana shows "#####" as h2) ends the section there too; with
 * the level rule a "#####" never ends one, since the Evidence heading itself
 * is at most "####".
 */
const SECTION_HEADING = /^(#{1,6})[ \t]/;

/**
 * Same opening rule as mdToHtml (a fence may be indented, as one inside a list
 * item is), plus "~~~", which every tracker that renders Markdown itself
 * treats as a fence too.
 */
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Which lines sit inside a fenced code block, the fences themselves included.
 * A "# comment" in a shell snippet, or a "## Evidence" quoted in a code block,
 * is code and never a section.
 */
function fencedLines(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let open: { char: string; length: number } | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (open) {
      out.push(true);
      // Only a run of the same character, at least as long, closes the block.
      if (m && m[1][0] === open.char && m[1].length >= open.length) open = null;
      continue;
    }
    if (m) open = { char: m[1][0], length: m[1].length };
    out.push(!!m);
  }
  return out;
}

/** The level of the Evidence heading on this line, or 0 when it is not one. */
function evidenceLevel(line: string): number {
  const h = EVIDENCE_HEADING.exec(line);
  if (h) return h[1].length;
  const label = boldLabel(line);
  return label !== null && EVIDENCE_LABEL.test(label) ? LABEL_LEVEL : 0;
}

export type EvidenceSectionOptions = {
  /**
   * End the agent's Evidence section at the next heading of ANY level, not just
   * one of the same or a higher level. For a tracker that flattens heading
   * levels (Asana has only h1 and h2), a deeper heading after Evidence shows up
   * as the next section, and the images belong before it.
   */
  endAtAnyHeading?: boolean;
};

/** Whether this line, after the Evidence heading, starts the next section. */
function endsSection(line: string, level: number, opts: EvidenceSectionOptions): boolean {
  // A bold label is how the agent writes a section, at any depth.
  if (boldLabel(line) !== null) return true;
  const h = SECTION_HEADING.exec(line);
  return !!h && (!!opts.endAtAnyHeading || h[1].length <= level);
}

/** Does this markdown already carry an Evidence section of its own? */
export function hasEvidenceHeading(markdown: string): boolean {
  const lines = (markdown ?? "").split("\n");
  const fenced = fencedLines(lines);
  return lines.some((line, i) => !fenced[i] && evidenceLevel(line) > 0);
}

/**
 * Split the markdown at the END of the agent's own Evidence section: the head
 * runs up to the next section (a heading of the same or a higher level, or a
 * bold label), the tail is the rest. Null when there is no Evidence heading.
 *
 * For a body whose evidence is not markdown (Azure DevOps inserts HTML between
 * the two halves); placeEvidence is the markdown version.
 */
export function splitAtEvidenceEnd(
  markdown: string,
  opts: EvidenceSectionOptions = {},
): { head: string; tail: string } | null {
  const md = markdown ?? "";
  const lines = md.split("\n");
  const fenced = fencedLines(lines);
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    if (!level) {
      level = evidenceLevel(lines[i]);
      continue;
    }
    if (endsSection(lines[i], level, opts)) {
      return { head: lines.slice(0, i).join("\n"), tail: lines.slice(i).join("\n") };
    }
  }
  return level ? { head: md, tail: "" } : null;
}

/** Markdown blocks one blank line apart, skipping the empty ones. */
export function joinBlocks(...blocks: string[]): string {
  return blocks.filter((b) => b.trim()).join("\n\n");
}

/**
 * Put the evidence inside the agent's own Evidence section when it wrote one,
 * else under a new "## Evidence" at the end.
 *
 * The agent is told not to write that section but sometimes does, and not
 * always last. Appending a second heading is what produced tickets with
 * Evidence twice, the caption once as a bullet and again under the image.
 * Inserting at the END of the section, rather than the end of the body,
 * matters when another section follows it: the images would otherwise sit
 * under that section's heading instead.
 */
export function placeEvidence(
  body: string,
  evidenceMarkdown: string,
  opts: EvidenceSectionOptions = {},
): string {
  if (!evidenceMarkdown.trim()) return body ?? "";
  const md = (body ?? "").replace(/\s+$/, "");
  const split = splitAtEvidenceEnd(md, opts);
  if (!split) return joinBlocks(md, `## Evidence\n\n${evidenceMarkdown}`);
  return joinBlocks(
    `${split.head.replace(/\s+$/, "")}\n\n${evidenceMarkdown}`,
    split.tail.replace(/^\s+/, ""),
  );
}

// ---------------------------------------------------------------------------
// Evidence files
// ---------------------------------------------------------------------------

/**
 * A screenshot or a screen recording. The capture attaches nothing else, so
 * every file that is not an image is shown as a recording.
 */
export type EvidenceKind = "image" | "recording";

/** The media type alone, lowercased: "video/webm;codecs=vp9" is "video/webm". */
function mediaType(contentType: string): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

export function evidenceKind(contentType: string): EvidenceKind {
  return mediaType(contentType).startsWith("image/") ? "image" : "recording";
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/**
 * The extension a file of this type is uploaded with, so it still opens once
 * someone downloads it. A type outside the table keeps its subtype when that
 * reads as an extension ("image/avif" is .avif), and is .bin otherwise.
 */
export function evidenceExtension(contentType: string): string {
  const type = mediaType(contentType);
  const known = EXTENSIONS[type];
  if (known) return known;
  const sub = type.split("/")[1] ?? "";
  return /^[a-z0-9]{1,5}$/.test(sub) ? sub : "bin";
}

/**
 * What a ticket calls an evidence file: "Screenshot 2", "Screen recording",
 * "Screen recording 2". `index` counts the files of the same kind from 1, so
 * a report with a single recording never reads "Screen recording 1".
 */
export function evidenceLabel(contentType: string, index: number): string {
  if (evidenceKind(contentType) === "image") return `Screenshot ${index}`;
  return index > 1 ? `Screen recording ${index}` : "Screen recording";
}

/**
 * The name an evidence file is uploaded under: "screenshot-2.png",
 * "screen-recording.webm". Never the capture's own file name: a
 * "keyframe-00012.png" or "replay.webm" tells the reader how the report was
 * made, which a ticket must not. One rule for every tracker that shows file
 * names, so a file is called the same thing wherever it is filed.
 */
export function evidenceFileName(contentType: string, index: number): string {
  const base = evidenceLabel(contentType, index).toLowerCase().replace(/\s+/g, "-");
  return `${base}.${evidenceExtension(contentType)}`;
}

/**
 * Each file's index among the files of its own kind, in order: two
 * screenshots around a recording are 1, 1, 2. For a tracker that names every
 * file up front, rather than only the ones that uploaded.
 */
export function evidenceIndexes(evidence: Array<{ contentType: string }>): number[] {
  let images = 0;
  let recordings = 0;
  return evidence.map((e) => (evidenceKind(e.contentType) === "image" ? ++images : ++recordings));
}

// ---------------------------------------------------------------------------
// Technical logs
// ---------------------------------------------------------------------------

/**
 * The technical details, folded: GitHub and GitLab both render <details> as a
 * disclosure, so pages of network calls stay out of the reader's way.
 */
export function withDetailsFolds(body: string, details?: Array<{ title: string; markdown: string }>): string {
  // each video's logs folded on their own, under their own title
  const folds = (details ?? []).filter((d) => d.markdown.trim())
    .map((d) => `<details>\n<summary>${d.title}</summary>\n\n${d.markdown.trim()}\n\n</details>`);
  return folds.length ? `${body.replace(/\s+$/, "")}\n\n${folds.join("\n\n")}` : body;
}

/** The technical logs as an attachment, ready to upload. */
export type TechnicalLogsFile = {
  filename: "technical-logs.md";
  contentType: "text/markdown";
  bytes: Buffer;
};

/**
 * The technical logs as one Markdown file, a section per video under its own
 * title, or null when there is nothing to attach. For a tracker with no fold
 * to hide pages of network calls in (Asana, monday) or a description cap they
 * can outgrow on their own (Trello), the logs ride along as an attachment.
 */
export function technicalLogsFile(
  details?: Array<{ title: string; markdown: string }>,
): TechnicalLogsFile | null {
  const sections = (details ?? [])
    .filter((d) => d.markdown?.trim())
    .map((d) => `## ${d.title}\n\n${d.markdown.trim()}`);
  if (!sections.length) return null;
  return {
    filename: "technical-logs.md",
    contentType: "text/markdown",
    bytes: Buffer.from(`${sections.join("\n\n")}\n`, "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

/**
 * What the agent is told about a repository.
 *
 * A bare name is not enough to route by: "brief-marketing-website" and
 * "brief-cloud" look equally plausible for a bug in the app until you know
 * which one serves the URL the reporter was on. The forge's own homepage,
 * topics and primary language are exactly that missing context, so they are
 * folded into the description the agent reads. GitHub and GitLab both use it.
 */
export function describeRepo(r: {
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  topics?: string[];
}): string | undefined {
  const bits: string[] = [];
  if (r.description?.trim()) bits.push(r.description.trim());
  if (r.homepage?.trim()) bits.push(`Serves: ${r.homepage.trim()}`);
  if (r.topics?.length) bits.push(`Topics: ${r.topics.slice(0, 8).join(", ")}`);
  if (r.language?.trim()) bits.push(`Language: ${r.language.trim()}`);
  return bits.length ? bits.join(". ") : undefined;
}
