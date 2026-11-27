import { errorMessage } from "@/lib/errors";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./system-prompt";
import { buildEvidenceManifest, pickEvidence, type EvidenceItem } from "./evidence";
import { buildContextBlock } from "./context-block";
import { correlateNote, storyboardParts } from "./storyboard";
import { videoLogSections, type VideoLogs } from "./tech-details";
import { agentModel } from "./model";
import { runToolLoop, text, type FunctionDef, type Part } from "./responses";
import type { Tracker, IssueResult, TrackerPriority } from "../tracker";
import { providerName } from "../trackers/registry";

export interface BriefInput {
  json: unknown;                          // parsed brief.json
  // distinct keyframes/screenshot as data URLs (for the model to SEE);
  // timestampMs (when known) positions a keyframe in the recording so the
  // model reads the frames as a timestamped storyboard; caption is the
  // reporter's note on a screenshot, shown inline with that image.
  images: Array<{ name: string; dataUrl: string; timestampMs?: number; caption?: string; url?: string }>;
  // The attachable evidence pool. The agent chooses what to attach
  // (create_issue's attach[]); `fallback` is used when it doesn't choose.
  // The recording is only in `files` when the user allowed attaching it.
  evidence: {
    files: Array<{ filename: string; contentType: string; bytes: Buffer; url?: string }>;
    items: EvidenceItem[];
    includeVideo: boolean;
    fallback: string[];
    /** Attached whatever the agent picks: the replay's video and its flagged stills. */
    forced?: string[];
  };
  /** The brief page, where an attached replay plays. Linked from the ticket. */
  replayUrl?: string;
}

// Section labels the agent writes on a line of their own, sometimes without
// the bold that marks them as labels ("Steps to reproduce" read as a plain
// sentence in the ticket). Normalized to **Label**, which every adapter turns
// into its heading (GitHub ###, Jira h3, Notion heading_3).
const SECTION_LABEL =
  /^\s{0,3}(?:\*\*)?(steps to reproduce|steps|expected(?: behaviou?r| result)?|actual(?: behaviou?r| result)?|context|environment|impact|workaround|notes?|errors?|console errors|network errors|summary|technical notes|also noticed)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i;
export function normalizeSectionLabels(markdown: string): string {
  return (markdown ?? "")
    .split("\n")
    .map((line) => {
      const m = SECTION_LABEL.exec(line);
      if (!m) return line;
      const t = m[1];
      return `**${t.charAt(0).toUpperCase()}${t.slice(1)}**`;
    })
    .join("\n");
}

/** The replay link, as the ticket's last line before the evidence. */
export function withReplayLink(markdown: string, url?: string): string {
  if (!url) return markdown;
  return `${(markdown ?? "").replace(/\s+$/, "")}\n\n**Replay:** [Watch the minute before the report](${url})`;
}
export interface FileResult {
  ticketUrl: string;
  ticketIdentifier: string;
  ticketTitle: string;
  /** The markdown body the agent wrote for the ticket, persisted so the
   *  shareable brief page can render the same "perfect ticket". */
  descriptionMarkdown: string;
  /** Final workflow state right after filing (post verify/repair), if readable. */
  ticketState?: { name: string; color: string | null };
  summary: string;
}

export async function processBrief(
  brief: BriefInput,
  tracker: Tracker,
  instructions?: string,
  // When provided (export of a draft the reporter already iterated on), the agent
  // files THIS title + description verbatim and only routes/sets fields - it does
  // not rewrite the content.
  fixed?: { title: string; description: string },
): Promise<FileResult> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = agentModel();
  const noun = tracker.targetNoun;
  // The tracker's own name ("Azure DevOps", not "azure"), wherever the model or
  // the user reads it.
  const trackerName = providerName(tracker.kind);
  const caps = tracker.capabilities;
  const prefs = (instructions ?? "").trim();

  // Which optional create_issue parameters this tracker actually has. Naming
  // them in the prompt keeps the model from spending a turn trying to set a
  // field the provider has no concept of (a GitHub issue has no priority; a
  // Trello card has no status of its own).
  const settable = [
    caps.labels && "labels",
    caps.priority && "priority",
    caps.states && "state",
    "assignee",
    caps.projects && "project",
    caps.customers && "customer",
    caps.comments && "comment",
    caps.customFields && "custom_fields",
  ].filter(Boolean) as string[];

  const detailsExtras = [
    caps.projects && "projects",
    caps.customers && "customers",
    caps.issueTypes && "issue types",
    caps.customFields && "custom fields (with their field ids and allowed values)",
  ].filter(Boolean) as string[];
  const sys =
    SYSTEM_PROMPT +
    `\n\nTHIS TRACKER: ${trackerName}. A filing destination is called a ${noun}.` +
    (tracker.bodyGuidance ? ` ${tracker.bodyGuidance}` : "") +
    `\n\nTOOLING: You drive the tracker through tools, MCP-style. search_issues(query) looks up EXISTING issues so you can route and label by precedent - call it before picking a ${noun}. list_targets shows where you can file. get_target_details(targetId) returns the ${noun}'s real states, labels, members${detailsExtras.length ? `, and ${detailsExtras.join(", ")}` : ""} - call it BEFORE create_issue whenever the preferences mention any of those, and use the exact names it returns.${caps.customFields ? " It also marks the custom fields the target REQUIRES: create_issue must set every required one, or the tracker refuses the ticket." : ""} create_issue files the one issue (targetId + title + markdown description, plus optional ${settable.join("/")}). After creating, get_issue(identifier) reads back the live field values and update_issue(identifier, ...) repairs anything that didn't land - its error messages list the valid options, so correct the value and retry once.${caps.comments ? " The comment is posted on the issue after it's created; it's separate from the description." : ""} Evidence: choose what to attach via create_issue's attach parameter (file names from the EVIDENCE AVAILABLE list) - pick the minimal set that proves the issue; the system ${caps.nativeAttachments ? "uploads and embeds" : "embeds"} your selection automatically. In the title/description do NOT invent image URLs, do NOT paste data: URIs, and do NOT reference attachment file names - write as if the evidence is shown inline. When the issue is created and verified, reply with a short plain-text confirmation (no tool call) to finish.` +
    (prefs
      ? `\n\nUSER TICKET PREFERENCES - these are binding instructions from the ticket owner. Apply every one that maps to something you control: where to file (${noun} choice)${caps.states ? ", workflow state/status" : ""}, assignee${caps.projects ? ", project" : ""}${caps.customers ? ", customer" : ""}${caps.labels ? ", labels" : ""}${caps.priority ? ", priority" : ""}${caps.customFields ? ", custom fields" : ""}, wording, format, and what to include. Pass each through the matching tool parameter - do not just mention it in the description - and VERIFY it landed via get_issue, repairing with update_issue. They never override the banned-vocabulary or evidence rules.\n${prefs}`
      : "") +
    (fixed
      ? `\n\nALREADY-WRITTEN TICKET - DO NOT REWRITE. The reporter has finalized this ticket's title and description (they iterated on it themselves). Your ONLY job is to route it: pick the right ${noun} (use search_issues for precedent), set ${settable.filter((x) => x !== "comment").join("/")} per precedent and the user's preferences, and attach the right evidence. When you call create_issue, pass the EXACT title and description below, byte for byte - do NOT rewrite, rephrase, summarize, translate, re-section, or "improve" them. The banned-vocabulary rule does not apply to their text; file it as written.\n\nTITLE:\n${fixed.title}\n\nDESCRIPTION:\n${fixed.description}`
      : "");

  // How each provider spells "a field I didn't give you a named parameter for".
  // Getting this wrong is expensive: the agent sends a value in the wrong shape
  // and the field silently doesn't land.
  const CUSTOM_FIELD_HELP: Record<string, string> = {
    linear:
      'Advanced Linear IssueCreateInput fields by API name (e.g. {"estimate": 2, "dueDate": "2026-07-01"}) - only when the preferences need something the named parameters don\'t cover.',
    jira:
      'Jira fields by field id from get_target_details\' customFields (e.g. {"customfield_10042": "Production", "customfield_10028": 1, "components": ["Web"]}) - when the preferences need them, AND always for every field get_target_details marks required. Use each field\'s listed type/allowedValues: a number field takes a number, a field with allowedValues takes one (or, for a list field, several) of them by name. If create_issue answers that the project requires fields, set them here with the most fitting allowed value (1 for a number like story points) and call create_issue again.',
    github:
      'Extra GitHub fields: "milestone" (a milestone title from get_target_details\' customFields), and "project:<number>:<Field name>" to set a single-select field on a project board (e.g. {"project:3:Area": "Billing"}).',
    azure:
      'Azure DevOps fields by REFERENCE name from get_target_details\' customFields (e.g. {"Microsoft.VSTS.Common.Severity": "2 - High"}), plus "System.WorkItemType" to choose the work item type. Use each field\'s listed allowedValues.',
    clickup:
      'ClickUp custom fields by field id (or exact field name) from get_target_details\' customFields (e.g. {"Environment": "Production"}). For dropdown fields use one of the listed allowedValues.',
    trello:
      'Extra Trello card fields by API name (e.g. {"due": "2026-07-01T12:00:00Z"}) - only when the preferences ask for one.',
    notion:
      'Notion database properties by their exact property NAME from get_target_details\' customFields (e.g. {"Environment": "Production"}). For select and status properties use one of the listed allowedValues.',
    gitlab:
      'Extra GitLab fields: {"milestone": "<title from get_target_details>", "due_date": "2026-07-01", "weight": 3, "confidential": true, "issue_type": "incident"} - only when the preferences need them.',
    asana:
      'Asana custom fields by field gid or exact name from get_target_details\' customFields (e.g. {"Environment": "Production"}); enum fields take one of the listed allowedValues.',
    monday:
      'Board columns by column id or exact title from get_target_details\' customFields (e.g. {"Environment": "Production"}); status and dropdown columns take one of the listed allowedValues.',
  };

  const customFieldsParam = {
    type: "object",
    description:
      CUSTOM_FIELD_HELP[tracker.kind] ??
      "Provider-specific fields by id from get_target_details' customFields - only when the preferences need them.",
    additionalProperties: true,
  };

  // Where a parameter's MEANING differs by provider - not just whether it
  // exists - the model is told what it actually does here. Without this the
  // agent treats a Trello list like a Linear workflow state and a GitHub
  // priority label like a real priority field.
  const STATE_HELP: Record<string, string> = {
    trello:
      "The LIST on the board this card belongs in - a Trello card has no separate status, so its list is its status. Use an exact list name from the target's state list (e.g. \"Triage\", \"Doing\").",
    github:
      "The Status value on the repository's project board (from the target's state list). A bare GitHub issue is only open or closed, so this only applies when the repo has a project board - leave it unset otherwise.",
    notion:
      "The value for this database's status property, using an exact option name from the target's state list.",
    azure:
      "The work item state (e.g. \"New\", \"Active\") from the target's state list - only when the preferences ask for a starting state.",
    gitlab:
      '"Open", "Closed", or a status label like "workflow::In review" from the target\'s state list - only when the preferences ask for one.',
    asana:
      'The section to put the task in, from the target\'s state list. "Done" completes the task when there is no section by that name.',
    monday: "A label of the board's Status column, from the target's state list.",
  };

  const PRIORITY_HELP: Record<string, string> = {
    github:
      "Issue priority - only when the preferences or report justify one. GitHub has no priority field, so this is applied to the repo's existing priority-style label (or the board's Priority field) and is skipped when neither exists.",
    trello:
      "Card priority - only when the preferences or report justify one. Trello has no priority field, so this is applied to a matching existing board label and skipped when there is none.",
    gitlab:
      "Issue priority - only when the preferences or report justify one. GitLab has no priority field, so this is applied to the project's existing priority-style label and skipped when there is none.",
    asana:
      "Task priority - only when the preferences or report justify one. Applied to the project's Priority field when it has one, skipped otherwise.",
    monday:
      "Item priority - only when the preferences or report justify one. Applied to the board's Priority column when it has one, skipped otherwise.",
  };

  const CUSTOMER_HELP =
    "The customer this issue was reported for (a name or domain from the target's customers, e.g. \"Acme\" or \"acme.com\") - links the issue to that customer as a customer request. Set it whenever the report shows which of the CUSTOMERS hit the problem (the reporter names them, their domain or product is the page, or the preferences name one). Judge by meaning: a word that merely equals a customer name is not a mention. Never guess.";

  const PROJECT_HELP: Record<string, string> = {
    azure:
      "The Area Path to file under (from the target's details) - when the preferences name an area, or say to pick the best matching one.",
    github:
      "The project board (title or number from the target's details) to add this issue to - needed when setting a state or a board field.",
    monday:
      'The group on the board (e.g. "Bugs") to put the item in - when the preferences name one, or say to pick the best matching one.',
  };

  const tools: FunctionDef[] = [
    {
      name: "list_targets",
      description: `List the ${noun}s so you can choose where to file.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "search_issues",
      description:
        `Search EXISTING ${trackerName} issues to learn how this workspace files things like THIS report - which ${noun} similar issues live in, what labels and priority they carry, who owns them. Call this BEFORE choosing where to file. Use keywords from the failure (the error text, the failing endpoint/URL, the feature or page name); run a couple of searches with different keywords if the first is thin.`,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keywords to search for, e.g. \"checkout coupon 500\" or \"login redirect loop\".",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "get_target_details",
      description: `Full metadata for one ${noun}: its workflow states, labels, assignable members${detailsExtras.length ? `, and ${detailsExtras.join(", ")}` : ""}. Call this before create_issue whenever the user's preferences mention a status, assignee, project, label, or custom field.`,
      parameters: {
        type: "object",
        properties: {
          targetId: { type: "string", description: `The ${noun} id (from list_targets)` },
        },
        required: ["targetId"],
        additionalProperties: false,
      },
    },
    {
      name: "create_issue",
      description: `Create exactly one issue in the chosen ${noun}.`,
      parameters: {
        type: "object",
        properties: {
          targetId: { type: "string", description: `The ${noun} id to file into` },
          title: { type: "string" },
          description: { type: "string", description: "Markdown body" },
          ...(caps.labels
            ? {
                labels: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Label names to apply - only when the user's preferences or the report call for them. Prefer names from the target's details.",
                },
              }
            : {}),
          ...(caps.priority
            ? {
                priority: {
                  type: "string",
                  enum: ["urgent", "high", "medium", "low"],
                  description: PRIORITY_HELP[tracker.kind] ?? "Issue priority - only when the preferences or report justify one.",
                },
              }
            : {}),
          ...(caps.states
            ? {
                state: {
                  type: "string",
                  description: STATE_HELP[tracker.kind] ?? "Workflow state/status name (e.g. \"Backlog\", \"Todo\", \"Triage\") from the target's state list - only when the preferences ask for one.",
                },
              }
            : {}),
          assignee: {
            type: "string",
            description:
              "Who to assign the issue to (a member name or email, e.g. \"Devin\") - only when the preferences ask for an assignee. Prefer a name from the target's member list.",
          },
          ...(caps.projects
            ? {
                project: {
                  type: "string",
                  description: PROJECT_HELP[tracker.kind] ?? "Project (name or id from the target's details) to file the issue under - when the preferences ask for a project, or say to pick the best matching one.",
                },
              }
            : {}),
          ...(caps.customers
            ? {
                customer: {
                  type: "string",
                  description: CUSTOMER_HELP,
                },
              }
            : {}),
          ...(caps.comments
            ? {
                comment: {
                  type: "string",
                  description:
                    "A comment to post on the issue right after creating it (e.g. \"In progress\") - only when the preferences ask for an automatic comment. This is separate from the description.",
                },
              }
            : {}),
          attach: {
            type: "array",
            items: { type: "string" },
            description:
              "Evidence file names to attach (from the EVIDENCE AVAILABLE list). Pick the minimal set that proves the issue - e.g. the annotated screenshot, or a before/after frame pair. Omit to let the system choose a sensible default.",
          },
          screenshot_notes: {
            type: "array",
            items: { type: "string" },
            description:
              "One short, direct description for EACH screenshot, in the same order they were shown to you (Screenshot 1, 2, ...). Each renders as the caption directly ABOVE its image. Write what the image SHOWS and the problem it evidences, present tense - e.g. \"The sub-issues panel renders with broken spacing; the circled row is the misaligned item.\" Do NOT describe it as an artifact (\"a screenshot that...\", \"the reporter circled/noted...\") - just state what is on screen.",
          },
          ...(caps.customFields ? { custom_fields: customFieldsParam } : {}),
        },
        required: ["targetId", "title", "description"],
        additionalProperties: false,
      },
    },
    {
      name: "get_issue",
      description:
        "Read back the created issue's live field values (state, assignee, labels, project, priority) to verify the preferences landed.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "The issue identifier, exactly as create_issue returned it" },
        },
        required: ["identifier"],
        additionalProperties: false,
      },
    },
    {
      name: "update_issue",
      description:
        "Fix the created issue when verification shows a preference didn't land. Failures return the valid options (states, members, projects) - correct the value and retry once.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "The issue identifier, exactly as create_issue returned it" },
          title: { type: "string" },
          ...(caps.states
            ? { state: { type: "string", description: STATE_HELP[tracker.kind] ?? "Workflow state/status name to move the issue to" } }
            : {}),
          assignee: { type: "string", description: "Member name or email to assign" },
          ...(caps.labels
            ? { labels: { type: "array", items: { type: "string" }, description: "Replacement label set" } }
            : {}),
          ...(caps.priority
            ? { priority: { type: "string", enum: ["urgent", "high", "medium", "low"] } }
            : {}),
          ...(caps.projects
            ? { project: { type: "string", description: PROJECT_HELP[tracker.kind] ?? "Project name or id to move the issue under" } }
            : {}),
          ...(caps.customers ? { customer: { type: "string", description: "Customer name or domain to link the issue to (adds a customer request)" } } : {}),
          ...(caps.customFields ? { custom_fields: customFieldsParam } : {}),
        },
        required: ["identifier"],
        additionalProperties: false,
      },
    },
  ];

  // Fail fast with a clear, actionable message when there's nowhere to file
  // (empty Jira site / no Linear teams), and seed the targets so the model
  // doesn't have to discover them and can't pick a bogus id.
  const targets = await tracker.listTargets();
  if (!targets.length) {
    throw new Error(
      `No ${noun}s found in your ${trackerName} workspace - create a ${noun} there, then retry.`,
    );
  }
  // One line per target, with its usable labels/states (capped - this is prompt
  // text) so preference-driven labels and statuses resolve to real names.
  const targetList = targets
    .slice(0, 50)
    .map((t) => {
      let line = `- ${t.name} (${t.key}) - id: ${t.id}`;
      if (t.description) line += `\n  about: ${t.description.slice(0, 200)}`;
      if (t.labels?.length) line += `\n  labels: ${t.labels.slice(0, 30).join(", ")}`;
      if (t.states?.length) line += `\n  states: ${t.states.slice(0, 20).join(", ")}`;
      if (t.assignees?.length) line += `\n  members: ${t.assignees.slice(0, 40).join(", ")}`;
      return line;
    })
    .join("\n");

  const tail: Part[] = [];

  // Pull the high-signal context out of brief.json and put it FRONT AND CENTER,
  // so the model reliably includes the page URL and reasons over the console
  // errors instead of leaving them buried in the JSON blob.
  const ctxBlock = buildContextBlock(brief.json);
  if (ctxBlock) tail.push(text(ctxBlock));

  tail.push(text(correlateNote(brief.images)));

  const manifest = buildEvidenceManifest(brief.evidence.items, brief.evidence.includeVideo);
  if (manifest) tail.push(text(manifest));
  tail.push(text(`Available ${noun}s (use search_issues first to learn routing precedent, then pick the most appropriate one and pass its id as targetId):\n${targetList}`));
  // The workspace's customers, so the agent can link the one this was reported
  // for. It judges from meaning, not a word match: a customer named like a
  // common word ("CSM") is linked only when the report means that customer.
  const customers = caps.customers && tracker.listCustomers ? await tracker.listCustomers().catch(() => []) : [];
  if (customers.length) {
    const list = customers
      .slice(0, 200)
      .map((c) => (c.domains.length ? `- ${c.name} (${c.domains.join(", ")})` : `- ${c.name}`))
      .join("\n");
    tail.push(
      text(
        `CUSTOMERS in this workspace. If the report shows which customer hit this - the reporter names them, the page is on their domain or product, the preferences name one - pass that customer's exact name as create_issue's customer. Only when the report really means that customer: a word that happens to equal a customer name is not a mention. None clearly meant: leave customer out.\n${list}`,
      ),
    );
  }
  tail.push(text(`File exactly one ticket for this. Call search_issues for precedent, pick the best ${noun}, then create the issue.`));

  // The images as a labelled, ordered storyboard (times, pages, notes).
  const storyboard = storyboardParts(brief.images);
  const withImages = [...storyboard, ...tail];
  const textOnly = [...tail];

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length
      ? (v as Record<string, unknown>)
      : undefined;
  const PRIORITIES: TrackerPriority[] = ["urgent", "high", "medium", "low"];
  const priority = (v: unknown): TrackerPriority | undefined => PRIORITIES.find((p) => p === v);

  // The markdown body the agent wrote on create_issue - captured here so the
  // caller can persist it for the shareable brief page (it's never read back
  // from the tracker, and update_issue can't change it).
  let descriptionMarkdown = "";

  const runLoop = async (content: Part[]): Promise<IssueResult> => {
    // Held in an object: the tool calls set it from inside the loop.
    // lastCreateError: why the tracker refused create_issue, kept so a run
    // that never manages to file ends on that reason, not a generic one.
    const state: { created: IssueResult | null; lastCreateError: string | null } = { created: null, lastCreateError: null };
    // The loop runs past creation so the agent can verify (get_issue) and
    // repair (update_issue) until the preferences actually landed. It ends
    // when the model answers without tool calls, or at the turn cap.
    await runToolLoop({
      client,
      model,
      instructions: sys,
      content,
      tools,
      maxTurns: 14,
      // The issue already exists - a failed VERIFICATION turn must not lose
      // it (marking the brief failed would file a duplicate on retry).
      onTurnError: (e) => {
        if (!state.created) return false;
        console.warn("[agent] verification turn failed after creation - keeping the issue:", e);
        return true;
      },
      onCall: async (name, args) => {
        switch (name) {
          case "list_targets":
            return targets;
          case "search_issues":
            return await tracker.searchIssues(str(args.query) ?? "", { limit: 15 });
          case "get_target_details":
            return await tracker.getTargetDetails(String(args.targetId ?? ""));
          case "create_issue":
            if (state.created) {
              return { error: `issue ${state.created.identifier} already exists - use update_issue to change it` };
            }
            {
              // Resolve the agent's evidence selection; an empty/invalid pick
              // falls back to the lean default. The recording can only be
              // chosen when the user allowed it (it isn't in the pool otherwise).
              const attachable = brief.evidence.items
                .filter((it) => it.kind !== "recording" || brief.evidence.includeVideo)
                .map((it) => it.name);
              const chosen = [...pickEvidence(args.attach, attachable, brief.evidence.fallback)];
              // Replay stills are exactly the reporter's flagged moments (forced
              // below): never an extra one the agent picked.
              for (let i = chosen.length - 1; i >= 0; i--) {
                const it = brief.evidence.items.find((x) => x.name === chosen[i]);
                if ((it?.kind === "replay" || it?.kind === "replay-video") && !(brief.evidence.forced ?? []).includes(it.name)) chosen.splice(i, 1);
              }
              // Every screenshot the reporter added is their explicit evidence -
              // always attach all of them, regardless of what the model picked.
              for (const it of brief.evidence.items) {
                if (it.kind === "screenshot" && attachable.includes(it.name) && !chosen.includes(it.name)) {
                  chosen.push(it.name);
                }
              }
              // Where the reporter flagged the bug: always on the ticket.
              for (const name of brief.evidence.forced ?? []) {
                if (attachable.includes(name) && !chosen.includes(name)) chosen.push(name);
              }
              // "Attach the recording" is an explicit user instruction, not a
              // hint - guarantee the actual video lands on the ticket. The
              // model kept picking the screenshot/frames instead, so when the
              // toggle is on we force the recording into the attached set.
              const recName = brief.evidence.items.find((it) => it.kind === "recording")?.name;
              if (brief.evidence.includeVideo && recName && attachable.includes(recName) && !chosen.includes(recName)) {
                chosen.push(recName);
              }
              // Pair the agent's per-screenshot descriptions with the images.
              // screenshot_notes is ordered to match the screenshots as shown
              // (Screenshot 1, 2, ...); map each to its file so the tracker can
              // render the caption directly above that image.
              const notes = Array.isArray(args.screenshot_notes)
                ? args.screenshot_notes.filter((n: unknown): n is string => typeof n === "string")
                : [];
              const captionByName = new Map<string, string>();
              brief.evidence.items
                .filter((it) => it.kind === "screenshot")
                .forEach((it, i) => {
                  const note = notes[i]?.trim();
                  if (note) captionByName.set(it.name, note);
                });
              // A replay still carries its own caption (the reporter's mark note).
              for (const it of brief.evidence.items) {
                if (it.kind === "replay" && it.caption && !captionByName.has(it.name)) captionByName.set(it.name, it.caption);
              }
              const evidenceFiles = brief.evidence.files
                .filter((f) => chosen.includes(f.filename))
                .map((f) => ({ ...f, caption: captionByName.get(f.filename) }));
              // When exporting an already-written draft, file the reporter's
              // title/description verbatim - never the model's rewrite.
              const issueTitle = fixed ? fixed.title : String(args.title ?? "");
              const issueDescription = withReplayLink(
                fixed ? fixed.description : normalizeSectionLabels(String(args.description ?? "")),
                brief.replayUrl,
              );
              const logs = (brief.json as { techLogs?: VideoLogs[] })?.techLogs;
              const sections = Array.isArray(logs) ? videoLogSections(logs) : [];
              try {
              state.created = await tracker.fileIssue({
                details: sections.length ? sections : undefined,
                targetId: String(args.targetId ?? ""),
                title: issueTitle,
                descriptionMarkdown: issueDescription,
                labels: Array.isArray(args.labels)
                  ? args.labels.filter((l: unknown) => typeof l === "string" && l.trim())
                  : undefined,
                priority: priority(args.priority),
                state: str(args.state),
                assignee: str(args.assignee),
                project: str(args.project),
                customer: str(args.customer),
                comment: str(args.comment),
                extraFields: obj(args.custom_fields),
                evidence: evidenceFiles,
              });
              } catch (e) {
                state.lastCreateError = errorMessage(e);
                throw e;
              }
              descriptionMarkdown =
                typeof issueDescription === "string" ? issueDescription : "";
              return state.created;
            }
          case "get_issue":
            return await tracker.getIssue(str(args.identifier) ?? state.created?.identifier ?? "");
          case "update_issue":
            return await tracker.updateIssue(str(args.identifier) ?? state.created?.identifier ?? "", {
              title: str(args.title),
              state: str(args.state),
              assignee: str(args.assignee),
              labels: Array.isArray(args.labels)
                ? args.labels.filter((l: unknown) => typeof l === "string" && l.trim())
                : undefined,
              priority: priority(args.priority),
              project: str(args.project),
              customer: str(args.customer),
              extraFields: obj(args.custom_fields),
            });
          default:
            return { error: "unknown tool" };
        }
      },
    });
    if (!state.created) {
      throw new Error(
        state.lastCreateError
          ? `The ticket wasn't created. ${state.lastCreateError}`
          : "The ticket wasn't created: Brief's AI stopped before filing it. Press Retry, or open the draft and file it yourself.",
      );
    }
    return state.created;
  };

  // The evidence is embedded/attached by the tracker regardless of vision. So if the
  // model rejects a provided image (degenerate/oversized/unsupported frame), degrade
  // gracefully to a text-only prompt rather than failing the whole ticket.
  let created: IssueResult;
  try {
    created = await runLoop(brief.images.length ? withImages : textOnly);
  } catch (e) {
    const msg = errorMessage(e);
    if (brief.images.length && /image|vision|media/i.test(msg)) {
      console.warn("[agent] model rejected a provided image - retrying text-only:", msg);
      created = await runLoop(textOnly);
    } else {
      throw e;
    }
  }

  // Snapshot the final field values (the verify/repair loop may have moved the
  // state after creation) so the caller can persist the real title + status.
  let ticketState: FileResult["ticketState"];
  let finalTitle = created.title || "";
  try {
    const live = await tracker.getIssue(created.identifier);
    if (typeof live.title === "string" && live.title) finalTitle = live.title;
    if (typeof live.state === "string" && live.state) {
      ticketState = {
        name: live.state,
        color: typeof live.stateColor === "string" ? live.stateColor : null,
      };
    }
  } catch {
    /* display data only - never fail the filing over it */
  }

  return {
    ticketUrl: created.url,
    ticketIdentifier: created.identifier,
    ticketTitle: finalTitle,
    descriptionMarkdown,
    ticketState,
    summary: finalTitle || "filed",
  };
}
