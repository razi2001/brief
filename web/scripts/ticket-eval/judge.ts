import type OpenAI from "openai";
import type { Kind, Ticket } from "./score";

export interface Verdict {
  namedBug: "yes" | "partly" | "no";
  inventedBug: boolean;
  plainSummary: boolean;
  why: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    namedBug: { type: "string", enum: ["yes", "partly", "no"] },
    inventedBug: { type: "boolean" },
    plainSummary: { type: "boolean" },
    why: { type: "string" },
  },
  required: ["namedBug", "inventedBug", "plainSummary", "why"],
  additionalProperties: false,
};

const RULES = `You grade one bug ticket an AI wrote from a browser capture. You are told the bug planted in the page (the ground truth) and its kind: "failure" (something in the page's network or console explains it), "ui" (visible only), or "none" (nothing was wrong).
- namedBug: "yes" when the ticket's title and summary are about the planted bug (the same user-visible problem; wording may differ). "partly" when the planted bug is in the ticket but not what it leads with, or only half of it is there. "no" when the ticket is about something else or misses it. For kind "none", answer "no".
- inventedBug: true when the ticket claims a failure, error message or cause that neither the planted bug nor the TRUE DETAILS include. For kind "none", any claimed failure counts. A detail listed under TRUE DETAILS is correct, not invented.
- plainSummary: true when a PM or QA who never saw the code would understand the title and opening summary on their own: product language, no HTTP methods, API paths, status codes or exception names there. Technical detail in a separate Technical notes section is fine.
- why: one sentence.`;

export async function judge(
  client: OpenAI,
  model: string,
  expect: { bug: string; kind: Kind; facts?: string[] },
  t: Ticket,
): Promise<Verdict> {
  const facts = expect.facts?.length ? `\nTRUE DETAILS (what the page and its calls really did):\n${expect.facts.map((f) => `- ${f}`).join("\n")}\n` : "";
  const resp = await client.responses.create({
    model,
    instructions: RULES,
    input: `PLANTED BUG (${expect.kind}): ${expect.bug}\n${facts}\nTICKET\n# ${t.title}\n\n${t.body}`,
    text: { format: { type: "json_schema", name: "verdict", schema: SCHEMA, strict: true } },
    reasoning: { effort: "medium" },
    store: false,
  });
  return JSON.parse(resp.output_text) as Verdict;
}
