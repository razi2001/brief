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
  /** Short purpose/description of this destination (Linear team description / Jira project description), to help routing. */
  description?: string;
}

/** Full metadata for one filing destination, fetched on demand by the agent. */
export interface TargetDetails {
  id: string;
  key: string;
  name: string;
  /** Short purpose/description of this destination, to help routing. */
  description?: string;
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

/** One existing issue returned by a precedent search, enriched so the agent can learn routing/labeling conventions. */
export interface IssueSearchResult {
  identifier: string;
  title: string;
  url: string;
  /** Where it lives: Linear team name / Jira project name. */
  target: string;
  /** Workflow state / status name. */
  state?: string;
  labels?: string[];
  assignee?: string;
  /** Normalized priority name (urgent/high/medium/low) where resolvable. */
  priority?: string;
  /** Jira issue type (Bug/Task/...). */
  issueType?: string;
  /** Linear project name, when set. */
  project?: string;
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
  // Each evidence file, optionally with a one-line human caption the agent wrote
  // for it. The adapter renders the caption directly above the embedded image
  // (Linear) or in the body next to the attachment reference (Jira).
  evidence: Array<{ filename: string; contentType: string; bytes: Buffer; caption?: string }>;
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
  /**
   * Search EXISTING issues for routing/labeling precedent. Best-effort:
   * returns [] on any failure (a search outage must never break filing).
   */
  searchIssues(query: string, opts?: { limit?: number }): Promise<IssueSearchResult[]>;
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

/** Where the attribution link points - the app itself. */
export const BRIEF_URL = "https://cloud.get-brief.app/";

/**
 * The attribution line every filed ticket carries. The reader should be able to
 * tell at a glance where the report came from AND get there in one click; the
 * agent can't write it itself ("brief" is banned vocabulary in the body), so the
 * adapters append it.
 */
export const BRIEF_ATTRIBUTION = `Reported with [Brief](${BRIEF_URL})`;

/**
 * Put the attribution at the very END of the description, under a divider -
 * after the Evidence section, so it never comes between the reader and the
 * report. Idempotent: a body that already ends with it is returned untouched.
 */
export function withBriefAttribution(body: string): string {
  const trimmed = (body ?? "").replace(/\s+$/, "");
  if (trimmed.endsWith(BRIEF_ATTRIBUTION)) return trimmed;
  if (!trimmed) return BRIEF_ATTRIBUTION;
  return `${trimmed}\n\n---\n\n${BRIEF_ATTRIBUTION}`;
}
