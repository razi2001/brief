import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { LinearApi } from "../linear";

export interface BriefInput {
  json: unknown;                          // parsed brief.json
  images: Array<{ name: string; dataUrl: string }>; // selected keyframes/screenshot as data URLs
}
export interface FileResult { ticketUrl: string; ticketIdentifier: string; summary: string; }

export async function processBrief(brief: BriefInput, linear: LinearApi): Promise<FileResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.AGENT_MODEL || "gpt-4o";
  const sys = SYSTEM_PROMPT + "\n\nTOOLING OVERRIDE: Do not output a JSON line and do not assume an MCP. Use the provided tools: call list_linear_teams first to choose the most appropriate team, then call create_linear_issue exactly once with a teamId, a concise title, and a markdown description (embed any provided images with markdown if you have URLs; otherwise describe them). Stop after the issue is created.";

  const tools = [
    { type: "function" as const, function: { name: "list_linear_teams", description: "List Linear teams so you can choose where to file.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
    { type: "function" as const, function: { name: "create_linear_issue", description: "Create exactly one Linear issue.", parameters: { type: "object", properties: { teamId: { type: "string" }, title: { type: "string" }, description: { type: "string", description: "Markdown body" } }, required: ["teamId", "title", "description"], additionalProperties: false } } },
  ];

  const userContent: any[] = [
    { type: "text", text: "brief.json:\n" + JSON.stringify(brief.json, null, 2) },
    ...brief.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
    { type: "text", text: "File exactly one Linear ticket for this. Pick the best team, then create the issue." },
  ];

  const messages: any[] = [
    { role: "system", content: sys },
    { role: "user", content: userContent },
  ];

  let created: { id: string; identifier: string; url: string; title: string } | null = null;
  for (let i = 0; i < 6 && !created; i++) {
    const resp = await openai.chat.completions.create({ model, messages, tools, tool_choice: "auto" });
    const msg = resp.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) break;
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      let result: unknown;
      try {
        if (tc.function.name === "list_linear_teams") result = await linear.listTeams();
        else if (tc.function.name === "create_linear_issue") { created = await linear.createIssue(args); result = created; }
        else result = { error: "unknown tool" };
      } catch (e: any) { result = { error: String(e?.message ?? e) }; }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  if (!created) throw new Error("agent did not create an issue");
  return { ticketUrl: created.url, ticketIdentifier: created.identifier, summary: created.title || "filed" };
}
