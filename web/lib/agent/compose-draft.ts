import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import { buildEvidenceManifest } from "./evidence";
import { buildContextBlock } from "./context-block";
import type { BriefInput } from "./process-brief";

export interface DraftResult {
  title: string;
  descriptionMarkdown: string;
}

/**
 * Write-only counterpart to processBrief: turn the captured evidence into the
 * best possible ticket TITLE + Markdown BODY, WITHOUT filing it to any tracker.
 *
 * Reuses the same writing rules and banned-vocabulary discipline as the filing
 * agent (SYSTEM_PROMPT), but strips the routing / field-setting / verify loop -
 * there's no tracker yet. The model returns the ticket through a single forced
 * compose_ticket call. Routing, labels, status, and assignee are applied later
 * at export time by processBrief.
 */
export async function composeDraftTicket(
  brief: BriefInput,
  instructions?: string,
): Promise<DraftResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.AGENT_MODEL || "gpt-4o";
  const prefs = (instructions ?? "").trim();

  const sys =
    SYSTEM_PROMPT +
    `\n\nTOOLING: You are only WRITING the ticket as a draft, NOT filing it - there is no tracker to route to and no fields to set. Ignore the target-selection, label/priority/status/assignee/custom-field, evidence-attachment, and verify/repair instructions above; those happen later at export time. Produce only the best possible title and Markdown description from the evidence, following the WRITE IT LIKE A TEAMMATE rules and the BANNED VOCABULARY. Call compose_ticket(title, description) exactly once with the finished ticket, then stop.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES - apply only the ones that affect WORDING, FORMAT, required sections, tone, or what to include. Ignore routing/assignee/status/label/field preferences (those are applied when the draft is exported):\n${prefs}`
      : "");

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "compose_ticket",
        description: "Return the finished ticket as a concise title and a Markdown description.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Concise, specific issue title - the problem, not a summary." },
            description: { type: "string", description: "The Markdown body, following the writing rules." },
          },
          required: ["title", "description"],
          additionalProperties: false,
        },
      },
    },
  ];

  const briefText = { type: "text" as const, text: "brief.json:\n" + JSON.stringify(brief.json, null, 2) };
  const tail: any[] = [];

  const ctxBlock = buildContextBlock(brief.json);
  if (ctxBlock) tail.push({ type: "text", text: ctxBlock });

  const frameCount = brief.images.filter((i) => i.name.includes("keyframe")).length;
  tail.push({
    type: "text",
    text:
      "CORRELATE EVERYTHING before writing. Cross-reference every signal you have - " +
      (frameCount ? `the ${frameCount} time-ordered screen frames, ` : "") +
      "any annotated screenshot (red marks = where the reporter is pointing), the spoken narration, the page events, the console errors, and the URL. " +
      "Build a single coherent account of what the user did, what they expected, and what actually happened; resolve disagreements in favor of the screenshots/console/events over the narration. " +
      "ALWAYS include the page URL in the ticket (an Environment/Context line) when one is present.",
  });

  const manifest = buildEvidenceManifest(brief.evidence.items, brief.evidence.includeVideo);
  if (manifest) tail.push({ type: "text", text: manifest });
  tail.push({ type: "text", text: "Write the ticket now and call compose_ticket exactly once." });

  const withImages = [
    briefText,
    ...brief.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
    ...tail,
  ];
  const textOnly = [briefText, ...tail];

  const run = async (userContent: any[]): Promise<DraftResult> => {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userContent },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "compose_ticket" } },
    });
    const msg = resp.choices[0].message;
    const tc = msg.tool_calls?.find((t) => t.type === "function" && t.function.name === "compose_ticket");
    if (!tc || tc.type !== "function") throw new Error("draft agent did not compose a ticket");
    const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const description = typeof args.description === "string" ? args.description : "";
    if (!title && !description) throw new Error("draft agent returned an empty ticket");
    return { title: title || "Untitled", descriptionMarkdown: description };
  };

  // Degrade to text-only if the model rejects a provided image (mirrors processBrief).
  try {
    return await run(brief.images.length ? withImages : textOnly);
  } catch (e: any) {
    const m = String(e?.message ?? e);
    if (brief.images.length && /image|vision|media/i.test(m)) return await run(textOnly);
    throw e;
  }
}
