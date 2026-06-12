import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { Tracker, IssueResult } from "../tracker";

export interface BriefInput {
  json: unknown;                          // parsed brief.json
  images: Array<{ name: string; dataUrl: string }>; // selected keyframes/screenshot as data URLs (for the model to SEE)
  // Raw evidence files handed to the tracker, which embeds (Linear) or attaches (Jira) them.
  evidence: Array<{ filename: string; contentType: string; bytes: Buffer }>;
}
export interface FileResult { ticketUrl: string; ticketIdentifier: string; ticketTitle: string; summary: string; }

/**
 * Extract the high-signal context (page URL/title, browser, console errors) out
 * of brief.json into a compact, prominent text block. The whole brief.json is
 * still sent, but key facts buried in it - especially the URL and console
 * errors - get surfaced here so the agent reliably uses them.
 */
function buildContextBlock(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = json as Record<string, any>;
  const lines: string[] = [];
  if (j.pageUrl) lines.push(`- Page URL: ${j.pageUrl}`);
  if (j.pageTitle) lines.push(`- Page title: ${j.pageTitle}`);
  if (j.userAgent) lines.push(`- Browser (user agent): ${j.userAgent}`);

  // Console errors come through as events of type "console-error" (args[]),
  // plus window "error"/"unhandledrejection". Surface them verbatim.
  const events: any[] = Array.isArray(j.events) ? j.events : [];
  const errs: string[] = [];
  for (const e of events) {
    const type = e?.type ?? e?.__brief ?? "";
    if (/error|rejection|console-error/i.test(String(type))) {
      const msg = Array.isArray(e?.args)
        ? e.args.join(" ")
        : e?.message || e?.reason || (typeof e?.payload === "string" ? e.payload : JSON.stringify(e));
      if (msg && msg.trim()) errs.push(msg.trim().slice(0, 500));
    }
  }
  let block = "";
  if (lines.length) block += "PAGE CONTEXT (ground truth - put the URL in the ticket):\n" + lines.join("\n");
  if (errs.length) {
    const unique = [...new Set(errs)].slice(0, 8);
    block += (block ? "\n\n" : "") + "CONSOLE / RUNTIME ERRORS (verbatim - include the relevant ones in a code block):\n" + unique.map((m) => `- ${m}`).join("\n");
  }
  return block;
}

export async function processBrief(brief: BriefInput, tracker: Tracker, instructions?: string): Promise<FileResult> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.AGENT_MODEL || "gpt-4o";
  const noun = tracker.targetNoun; // "team" | "project"
  const prefs = (instructions ?? "").trim();
  const sys =
    SYSTEM_PROMPT +
    `\n\nTOOLING OVERRIDE: Do not output a JSON line and do not assume an MCP. Use the provided tools: call list_targets first to choose the most appropriate ${noun}, then call create_issue exactly once with a targetId (the ${noun} id), a concise title, and a markdown description. create_issue also accepts optional labels, priority, state, assignee, and comment - set each ONLY when the user's ticket preferences (or the report itself) call for it, choosing names from the chosen ${noun}'s lists (labels / states / members) where possible. The comment is posted on the issue after it's created (e.g. an automatic "In progress" note); it's separate from the description. Evidence files (screenshots/keyframes/recording) are handled automatically - they will be embedded or attached to the ticket by the system, so do NOT invent image URLs, do NOT paste data: URIs, and do NOT reference attachment file names. Write the description as if the evidence is shown inline. Stop after the issue is created.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES - these are binding instructions from the ticket owner. Apply every one that maps to something you control: where to file (${noun} choice), labels, priority, workflow state/status, wording, format, and what to include. If a preference names a label or state, pass it through create_issue's labels/state parameters - do not just mention it in the description. They never override the banned-vocabulary or evidence rules.\n${prefs}`
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
            labels: {
              type: "array",
              items: { type: "string" },
              description:
                "Label names to apply - only when the user's preferences or the report call for them. Prefer names from the chosen target's label list.",
            },
            priority: {
              type: "string",
              enum: ["urgent", "high", "medium", "low"],
              description: "Issue priority - only when the preferences or report justify one.",
            },
            state: {
              type: "string",
              description:
                "Workflow state/status name (e.g. \"Backlog\", \"Todo\", \"Triage\") from the chosen target's state list - only when the preferences ask for one.",
            },
            assignee: {
              type: "string",
              description:
                "Who to assign the issue to (a member name or email, e.g. \"Devin\") - only when the preferences ask for an assignee. Prefer a name from the chosen target's assignee list.",
            },
            comment: {
              type: "string",
              description:
                "A comment to post on the issue right after creating it (e.g. \"In progress\") - only when the preferences ask for an automatic comment. This is separate from the description.",
            },
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
      `No ${noun}s found in your ${tracker.kind === "jira" ? "Jira" : "Linear"} workspace - create a ${noun} there, then retry.`,
    );
  }
  // One line per target, with its usable labels/states (capped - this is prompt
  // text) so preference-driven labels and statuses resolve to real names.
  const targetList = targets
    .slice(0, 50)
    .map((t) => {
      let line = `- ${t.name} (${t.key}) - id: ${t.id}`;
      if (t.labels?.length) line += `\n  labels: ${t.labels.slice(0, 30).join(", ")}`;
      if (t.states?.length) line += `\n  states: ${t.states.slice(0, 20).join(", ")}`;
      if (t.assignees?.length) line += `\n  members: ${t.assignees.slice(0, 40).join(", ")}`;
      return line;
    })
    .join("\n");

  const briefText = { type: "text" as const, text: "brief.json:\n" + JSON.stringify(brief.json, null, 2) };
  const tail: any[] = [];

  // Pull the high-signal context out of brief.json and put it FRONT AND CENTER,
  // so the model reliably includes the page URL and reasons over the console
  // errors instead of leaving them buried in the JSON blob.
  const ctxBlock = buildContextBlock(brief.json);
  if (ctxBlock) tail.push({ type: "text", text: ctxBlock });

  // How many sampled video frames the images contain (so the model knows the
  // stills are a time-ordered sequence to correlate, not unrelated pictures).
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
              labels: Array.isArray(args.labels)
                ? args.labels.filter((l: unknown) => typeof l === "string" && l.trim())
                : undefined,
              priority: ["urgent", "high", "medium", "low"].includes(args.priority)
                ? args.priority
                : undefined,
              state: typeof args.state === "string" && args.state.trim() ? args.state : undefined,
              assignee:
                typeof args.assignee === "string" && args.assignee.trim() ? args.assignee : undefined,
              comment:
                typeof args.comment === "string" && args.comment.trim() ? args.comment : undefined,
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
      console.warn("[agent] model rejected a provided image - retrying text-only:", msg);
      created = await runLoop(textOnly);
    } else {
      throw e;
    }
  }

  return {
    ticketUrl: created.url,
    ticketIdentifier: created.identifier,
    ticketTitle: created.title || "",
    summary: created.title || "filed",
  };
}
