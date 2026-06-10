import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { Tracker, IssueResult } from "../tracker";

export interface BriefInput {
  json: unknown;                          // parsed brief.json
  images: Array<{ name: string; dataUrl: string }>; // selected keyframes/screenshot as data URLs (for the model to SEE)
  // Raw evidence files handed to the tracker, which embeds (Linear) or attaches (Jira) them.
  evidence: Array<{ filename: string; contentType: string; bytes: Buffer }>;
}
export interface FileResult { ticketUrl: string; ticketIdentifier: string; summary: string; }

export async function processBrief(brief: BriefInput, tracker: Tracker, instructions?: string): Promise<FileResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.AGENT_MODEL || "gpt-4o";
  const noun = tracker.targetNoun; // "team" | "project"
  const prefs = (instructions ?? "").trim();
  const sys =
    SYSTEM_PROMPT +
    `\n\nTOOLING OVERRIDE: Do not output a JSON line and do not assume an MCP. Use the provided tools: call list_targets first to choose the most appropriate ${noun}, then call create_issue exactly once with a targetId (the ${noun} id), a concise title, and a markdown description. Evidence files (screenshots/keyframes/recording) are handled automatically — they will be embedded or attached to the ticket by the system, so do NOT invent image URLs, do NOT paste data: URIs, and do NOT reference attachment file names. Write the description as if the evidence is shown inline. Stop after the issue is created.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES (follow these for wording/format/labels; they never override the banned-vocabulary or evidence rules):\n${prefs}`
      : "");

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "list_targets",
        description: `List the ${noun}s (team or project) so you can choose where to file.`,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "create_issue",
        description: `Create exactly one issue in the chosen ${noun} (team or project).`,
        parameters: {
          type: "object",
          properties: {
            targetId: { type: "string", description: `The ${noun} id to file into` },
            title: { type: "string" },
            description: { type: "string", description: "Markdown body" },
          },
          required: ["targetId", "title", "description"],
          additionalProperties: false,
        },
      },
    },
  ];

  // Fail fast with a clear, actionable message when there's nowhere to file
  // (empty Jira site / no Linear teams), and seed the targets so the model
  // doesn't have to discover them and can't pick a bogus id.
  const targets = await tracker.listTargets();
  if (!targets.length) {
    throw new Error(
      `No ${noun}s found in your ${tracker.kind === "jira" ? "Jira" : "Linear"} workspace — create a ${noun} there, then retry.`,
    );
  }
  const targetList = targets.slice(0, 50).map((t) => `- ${t.name} (${t.key}) — id: ${t.id}`).join("\n");

  const briefText = { type: "text" as const, text: "brief.json:\n" + JSON.stringify(brief.json, null, 2) };
  const tail: any[] = [];
  if (brief.evidence.length) {
    tail.push({
      type: "text",
      text: `${brief.evidence.length} evidence file(s) (screenshots/keyframes/recording) will be attached or embedded automatically. Write the description assuming the reader can see them inline.`,
    });
  }
  tail.push({ type: "text", text: `Available ${noun}s (choose the most appropriate one and pass its id as targetId):\n${targetList}` });
  tail.push({ type: "text", text: `File exactly one ticket for this. Pick the best ${noun}, then create the issue.` });

  const withImages = [briefText, ...brief.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })), ...tail];
  const textOnly = [briefText, ...tail];

  const runLoop = async (userContent: any[]): Promise<IssueResult> => {
    const messages: any[] = [
      { role: "system", content: sys },
      { role: "user", content: userContent },
    ];
    let created: IssueResult | null = null;
    for (let i = 0; i < 8 && !created; i++) {
      const resp = await openai.chat.completions.create({ model, messages, tools, tool_choice: "auto" });
      const msg = resp.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls?.length) break;
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        let result: unknown;
        try {
          if (tc.function.name === "list_targets") result = targets;
          else if (tc.function.name === "create_issue") {
            created = await tracker.fileIssue({
              targetId: args.targetId,
              title: args.title,
              descriptionMarkdown: args.description,
              evidence: brief.evidence,
            });
            result = created;
          } else result = { error: "unknown tool" };
        } catch (e: any) {
          result = { error: String(e?.message ?? e) };
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    if (!created) throw new Error("agent did not create an issue");
    return created;
  };

  // The evidence is embedded/attached by the tracker regardless of vision. So if the
  // model rejects a provided image (degenerate/oversized/unsupported frame), degrade
  // gracefully to a text-only prompt rather than failing the whole ticket.
  let created: IssueResult;
  try {
    created = await runLoop(brief.images.length ? withImages : textOnly);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (brief.images.length && /image|vision|media/i.test(msg)) {
      console.warn("[agent] model rejected a provided image — retrying text-only:", msg);
      created = await runLoop(textOnly);
    } else {
      throw e;
    }
  }

  return { ticketUrl: created.url, ticketIdentifier: created.identifier, summary: created.title || "filed" };
}
