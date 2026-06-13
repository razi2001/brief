// Provider-agnostic issue-tracker abstraction.
// Concrete implementations live in linear.ts (makeLinearTracker) and jira.ts (makeJiraTracker).
//
// The shape mirrors what a real Linear/Jira MCP server would expose (inspect
// metadata, create, update, read back) so the agent can verify and repair the
// issue until it matches the user's preferences - including provider-specific
// extras like Jira custom fields - without any preference-specific code here.

export interface TrackerTarget {
  id: string;
  key: string;
  name: string;
  /** Label names usable when filing into this target (Linear: workspace + team labels). */
  labels?: string[];
  /** Workflow state names available in this target (Linear teams only). */
  states?: string[];
  /** Assignable member names (so the agent can resolve "assign to X" preferences). */
  assignees?: string[];
}

/** Full metadata for one filing destination, fetched on demand by the agent. */
export interface TargetDetails {
  id: string;
  key: string;
  name: string;
  /** Workflow state / status names valid in this target. */
  states: string[];
  labels: string[];
  /** Assignable member display names. */
  members: string[];
  /** Linear: the team's projects (assignable via create/update `project`). */
  projects?: Array<{ id: string; name: string }>;
  /** Jira: non-subtask issue type names. */
  issueTypes?: string[];
  /** Jira: settable fields from createmeta, including custom fields. */
  customFields?: Array<{
    id: string;
    name: string;
    type: string;
    required?: boolean;
    allowedValues?: string[];
  }>;
}

/** Normalized priority the agent can set; adapters map it to provider values. */
export type TrackerPriority = "urgent" | "high" | "medium" | "low";

export interface IssueResult {
  id: string;
  identifier: string;
  url: string;
  title: string;
}

export interface IssueInput {
  targetId: string;
  title: string;
  descriptionMarkdown: string;
  labels?: string[];
  priority?: TrackerPriority;
  /** Workflow state/status name (e.g. "Backlog", "Todo", "Triage"). */
  state?: string;
  /** Member name/email to assign (e.g. "Devin") - best-effort, resolved by the adapter. */
  assignee?: string;
  /** Project name or id to file the issue under (Linear projects). */
  project?: string;
  /** A comment to post on the issue right after it's created (e.g. "In progress"). */
  comment?: string;
  /**
   * Provider-specific raw fields, passed through to the create call:
   * Jira: merged into the REST `fields` object (custom fields like
   * `customfield_10direction`); Linear: merged into IssueCreateInput.
   * Resolved fields (labels/priority/state/assignee/project) always win.
   */
  extraFields?: Record<string, unknown>;
  evidence: Array<{ filename: string; contentType: string; bytes: Buffer }>;
}

/** A partial update applied after creation (the agent's repair loop). */
export interface IssuePatch {
  title?: string;
  state?: string;
  assignee?: string;
  labels?: string[];
  priority?: TrackerPriority;
  project?: string;
  extraFields?: Record<string, unknown>;
}

export type UpdateResult = { ok: true } | { ok: false; error: string };

export interface Tracker {
  kind: "linear" | "jira";
  /** The noun the model should use for a filing destination: "team" (Linear) or "project" (Jira). */
  targetNoun: string;
  listTargets(): Promise<TrackerTarget[]>;
  /** Full metadata for one target - states, labels, members, projects/custom fields. */
  getTargetDetails(targetId: string): Promise<TargetDetails>;
  // File one issue. The tracker handles evidence its own way:
  //  - Linear: uploads images, embeds ![](assetUrl) inline in description.
  //  - Jira: creates the issue, then attaches the files (Attachments panel), and notes them in the body.
  // labels/priority/state are optional and best-effort: unknown names are
  // resolved (or created) where the provider allows, and silently skipped
  // otherwise - they must never fail the filing itself.
  fileIssue(input: IssueInput): Promise<IssueResult>;
  /**
   * Update an existing issue (by identifier, e.g. "RAZ-12" / "PROJ-42").
   * Unlike fileIssue's best-effort extras, this REPORTS failures (with the
   * valid options where possible) so the agent can correct itself and retry.
   */
  updateIssue(identifier: string, patch: IssuePatch): Promise<UpdateResult>;
  /** Read back the issue's current field values so the agent can verify. */
  getIssue(identifier: string): Promise<Record<string, unknown>>;
}

/**
 * Fuzzy name resolution for agent-supplied values ("triage" → "Triage",
 * "progress" → "In Progress"). Case-insensitive: exact, then prefix, then
 * substring. Returns the canonical candidate, or undefined.
 */
export function resolveName(want: string, candidates: string[]): string | undefined {
  const w = want.trim().toLowerCase();
  if (!w) return undefined;
  const lower = candidates.map((c) => c.toLowerCase());
  let idx = lower.findIndex((c) => c === w);
  if (idx === -1) idx = lower.findIndex((c) => c.startsWith(w));
  if (idx === -1) idx = lower.findIndex((c) => c.includes(w));
  return idx === -1 ? undefined : candidates[idx];
}
