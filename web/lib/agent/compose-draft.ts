import { errorMessage } from "@/lib/errors";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import { buildEvidenceManifest } from "./evidence";
import { buildContextBlock } from "./context-block";
import { agentModel } from "./model";
import { respondJson, text, image, type Part, type Usage } from "./responses";
import type { BriefInput } from "./process-brief";

export interface DraftResult {
  title: string;
  descriptionMarkdown: string;
  /** Tokens the write took (the ticket eval reports them). */
  usage?: Usage;
}

/**
 * Build messages for the STREAMING draft write: same writing rules, but the
 * model outputs the ticket as plain Markdown (a "# title" line, a blank line,
 * then the body) instead of structured JSON - so the tokens can be streamed
 * live to the brief page as it writes. Routing/fields are applied later at export.
 */
export function buildStreamMessages(brief: BriefInput, instructions?: string): { system: string; user: Part[] } {
  const prefs = (instructions ?? "").trim();
  const system =
    SYSTEM_PROMPT +
    `\n\nOUTPUT FORMAT: You are writing the ticket as a draft (no tracker, no tools). Output ONLY the ticket as Markdown: the FIRST line is "# " followed by a concise, specific title; then a blank line; then the Markdown body, following the WRITE IT FOR THE TWO READERS rules and the BANNED VOCABULARY. Do not wrap it in code fences. Write nothing before the title or after the body.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES - apply the ones about WORDING, FORMAT, required sections, tone, or what to include (ignore routing/assignee/status/label/field prefs):\n${prefs}`
      : "");

  const tail: Part[] = [];
  const ctxBlock = buildContextBlock(brief.json);
  if (ctxBlock) tail.push(text(ctxBlock));
  const frameCount = brief.images.filter((i) => i.name.includes("keyframe")).length;
  tail.push(
    text(
      "CORRELATE EVERYTHING before writing. Cross-reference every signal you have - " +
        (frameCount ? `the ${frameCount} time-ordered screen frames, ` : "") +
        "any annotated screenshot (red marks = where the reporter is pointing), the spoken narration, the page events, the console errors, and the URL. Build one coherent account; trust the screenshots/console/events over the narration. ALWAYS include the page URL in the ticket (an Environment/Context line) when present.",
    ),
  );
  const manifest = buildEvidenceManifest(brief.evidence.items, brief.evidence.includeVideo);
  if (manifest) tail.push(text(manifest));
  tail.push(text("Write the ticket now as Markdown, starting with the # title line."));

  const user = brief.images.length ? [...brief.images.map((img) => image(img.dataUrl)), ...tail] : [...tail];
  return { system, user };
}

/** Split streamed/whole Markdown into a title (first "# " line) + body. */
export function parseDraftMarkdown(md: string): DraftResult {
  const text = (md || "").replace(/\r\n/g, "\n").trim();
  const m = /^#\s+(.+)$/m.exec(text);
  if (m) {
    const title = m[1].trim();
    const body = text.slice(m.index + m[0].length).trim();
    return { title: title || "Untitled", descriptionMarkdown: body };
  }
  // No heading - treat the whole thing as the body.
  return { title: "Untitled", descriptionMarkdown: text };
}

const TICKET_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Concise, specific issue title - the problem, not a summary." },
    description: { type: "string", description: "The Markdown body, following the writing rules." },
  },
  required: ["title", "description"],
  additionalProperties: false,
};

/**
 * Write-only counterpart to processBrief: turn the captured evidence into the
 * best possible ticket TITLE + Markdown BODY, WITHOUT filing it to any tracker.
 *
 * Reuses the same writing rules and banned-vocabulary discipline as the filing
 * agent (SYSTEM_PROMPT), but strips the routing / field-setting / verify loop -
 * there's no tracker yet. The model returns the ticket as structured JSON.
 * Routing, labels, status, and assignee are applied later at export time by
 * processBrief.
 */
export async function composeDraftTicket(
  brief: BriefInput,
  instructions?: string,
): Promise<DraftResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = agentModel();
  const prefs = (instructions ?? "").trim();

  const sys =
    SYSTEM_PROMPT +
    `\n\nTOOLING: You are only WRITING the ticket as a draft, NOT filing it - there is no tracker to route to and no fields to set. Ignore the target-selection, label/priority/status/assignee/custom-field, evidence-attachment, and verify/repair instructions above; those happen later at export time. Produce only the best possible title and Markdown description from the evidence, following the WRITE IT FOR THE TWO READERS rules and the BANNED VOCABULARY. Return the finished ticket as JSON: { "title": ..., "description": ... }.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES - apply only the ones that affect WORDING, FORMAT, required sections, tone, or what to include. Ignore routing/assignee/status/label/field preferences (those are applied when the draft is exported):\n${prefs}`
      : "");

  const tail: Part[] = [];

  const ctxBlock = buildContextBlock(brief.json);
  if (ctxBlock) tail.push(text(ctxBlock));

  const frameCount = brief.images.filter((i) => i.name.includes("keyframe")).length;
  tail.push(
    text(
      "CORRELATE EVERYTHING before writing. Cross-reference every signal you have - " +
        (frameCount ? `the ${frameCount} time-ordered screen frames, ` : "") +
        "any annotated screenshot (red marks = where the reporter is pointing), the spoken narration, the page events, the console errors, and the URL. " +
        "Build a single coherent account of what the user did, what they expected, and what actually happened; resolve disagreements in favor of the screenshots/console/events over the narration. " +
        "ALWAYS include the page URL in the ticket (an Environment/Context line) when one is present, as a Markdown link with the page title as its text, never a bare URL.",
    ),
  );

  const manifest = buildEvidenceManifest(brief.evidence.items, brief.evidence.includeVideo);
  if (manifest) tail.push(text(manifest));
  tail.push(text("Write the ticket now."));

  const withImages = [...brief.images.map((img) => image(img.dataUrl)), ...tail];
  const textOnly = [...tail];

  const run = async (content: Part[]): Promise<DraftResult> => {
    const { value, usage } = await respondJson<{ title?: unknown; description?: unknown }>({
      client,
      model,
      instructions: sys,
      content,
      name: "ticket",
      schema: TICKET_SCHEMA,
    });
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const description = typeof value.description === "string" ? value.description : "";
    if (!title && !description) throw new Error("draft agent returned an empty ticket");
    return { title: title || "Untitled", descriptionMarkdown: description, usage };
  };

  // Degrade to text-only if the model rejects a provided image (mirrors processBrief).
  try {
    return await run(brief.images.length ? withImages : textOnly);
  } catch (e) {
    const m = errorMessage(e);
    if (brief.images.length && /image|vision|media/i.test(m)) return await run(textOnly);
    throw e;
  }
}
