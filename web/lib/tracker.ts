// Provider-agnostic issue-tracker abstraction.
//
// Concrete implementations live one per file - linear.ts, jira.ts, github.ts,
// gitlab.ts, azure.ts, clickup.ts, notion.ts, trello.ts, asana.ts, monday.ts -
// and are wired together by trackers/registry.ts, which is the ONLY place that
// enumerates providers.
//
// The shape mirrors what a real tracker MCP server would expose (inspect
// metadata, create, update, read back) so the agent can verify and repair the
// issue until it matches the user's preferences - including provider-specific
// extras like Jira custom fields or Notion database properties - without any
// preference-specific code here.
//
// Providers differ enormously in what a "ticket" even is (a GitHub issue has no
// priority; a Trello card's LIST is its status; a Notion page's fields are
// entirely user-defined). Rather than branch on provider name, each adapter
// declares `capabilities` and the agent's tool schema is built from those - so
// every provider gets exactly the parameters it can actually honour instead of
// a lowest-common-denominator subset.

/** Every tracker Brief can file into. The registry maps these to adapters. */
export type ProviderKey =
  | "linear"
  | "jira"
  | "github"
  | "gitlab"
  | "azure"
  | "clickup"
  | "notion"
  | "trello"
  | "asana"
  | "monday";

/**
 * One workspace, org or group a tracker token can see (an Azure DevOps
 * organization, a ClickUp workspace, a GitLab group...). The workspace a user
 * picks is their org identity, and for some trackers also where they file.
 */
export type Workspace = {
  id: string;
  name: string;
  avatarUrl?: string;
  /** The workspace's own address, where it has one that calls are made against (a Jira site). */
  url?: string;
};

/**
 * What a provider can actually do. Drives the agent's tool schema (see
 * process-brief.ts): a false flag means the parameter is never offered, so the
 * model can't waste a turn setting something the tracker has no concept of.
 */
export interface TrackerCapabilities {
  /** A second grouping INSIDE a target (Linear projects, ADO area paths, Monday groups). */
  projects: boolean;
  /** A named workflow state can be set at creation (Trello: which list). */
  states: boolean;
  /** A normalized priority maps onto something native. */
  priority: boolean;
  labels: boolean;
  /** Arbitrary settable fields with ids/allowed values (Jira, ADO, ClickUp, Notion, GitLab, Asana, Monday). */
  customFields: boolean;
  /** The target offers a choice of work-item type (Jira, ADO). */
  issueTypes: boolean;
  /** A comment can be posted on the issue after creation. */
  comments: boolean;
  /**
   * Evidence is uploaded to the provider (false = embedded by public URL).
   * Notion is false although it uploads what it can: the URL is its fallback,
   * so the filing path has to keep the evidence and its share URL for it.
   */
  nativeAttachments: boolean;
}

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
  /**
   * The technical logs (network calls, console, pages) from the capture, one
   * section per video, as Markdown. Exact data, never the agent's: each
   * adapter appends them after the evidence, each folded under its own title
   * (GitHub <details>, Linear +++, Jira expand).
   */
  details?: Array<{ title: string; markdown: string }>;
  // Each evidence file, optionally with a one-line human caption the agent wrote
  // for it. The adapter renders the caption directly above the embedded image
  // (Linear) or in the body next to the attachment reference (Jira).
  //
  // `url` is a stable, permanent Brief-hosted URL for the same bytes (see
  // app/api/evidence/[shareId]). An adapter with no upload API (GitHub) embeds
  // THAT instead of uploading, and Notion embeds it for any file it could not
  // upload, which is why the bytes and the URL travel together rather than one
  // or the other.
  evidence: Array<{
    filename: string;
    contentType: string;
    bytes: Buffer;
    caption?: string;
    url?: string;
  }>;
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

/**
 * Live state of one already-filed issue, read back for the tickets feed. The
 * provider-agnostic replacement for the hand-written Linear/Jira branches the
 * sync loop used to carry.
 */
export interface LiveIssue {
  /** The tracker's CURRENT identifier - differs once an issue is moved. */
  identifier?: string;
  title: string;
  url: string;
  stateName: string;
  /** A brand status color; adapters map their own palette onto it. */
  stateColor: string;
  createdAt: string;
  assignee?: { name: string; avatarUrl?: string };
}

/** Result of a batch live read: what was found, and what the tracker no longer has. */
export interface LiveIssueLookup {
  issues: Record<string, LiveIssue>;
  /** Identifiers the provider CONFIRMED are gone (deleted there). Never a guess. */
  gone: string[];
}

/** Brand status colors, so every adapter's stateColor comes from one palette. */
export const STATUS_COLOR = {
  neutral: "#8a8378",
  active: "#dd6936",
  done: "#2e7d32",
} as const;

export interface Tracker {
  kind: ProviderKey;
  /** The noun the model should use for a filing destination: "team" (Linear), "project" (Jira, Azure DevOps, GitLab, Asana), "repository" (GitHub), "list" (ClickUp), "board" (Trello, Monday), "database" (Notion). */
  targetNoun: string;
  /** What this provider supports. The agent's tool schema is built from it. */
  capabilities: TrackerCapabilities;
  /**
   * One or two sentences telling the model how THIS provider renders a body,
   * injected into the prompt. E.g. Azure DevOps puts a bug's body in the Repro
   * Steps field; Notion turns it into page blocks. Empty for plain markdown.
   */
  bodyGuidance?: string;
  /**
   * The address of the one site this tracker reads and files into, where a
   * provider has several (a Jira site). Ticket keys are only unique per site,
   * so the live sync asks it about tickets filed there and nowhere else.
   */
  site?: string;
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
  /**
   * Batch live read for the tickets feed. Best-effort: any failure returns what
   * it has (a tracker outage must never break the dashboard render), and `gone`
   * lists ONLY identifiers the provider positively reported as missing - a
   * failed lookup must never be mistaken for a deleted ticket.
   */
  getLiveIssues(identifiers: string[]): Promise<LiveIssueLookup>;
}

/** Sensible default capabilities; adapters override only what differs. */
export const NO_CAPABILITIES: TrackerCapabilities = {
  projects: false,
  states: false,
  priority: false,
  labels: false,
  customFields: false,
  issueTypes: false,
  comments: false,
  nativeAttachments: false,
};

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


// ---------------------------------------------------------------------------
// Priority on trackers that have no priority field
// ---------------------------------------------------------------------------

/**
 * GitHub issues have no priority field. Teams encode it as a label instead, and
 * the conventions vary wildly ("P1", "priority: high",
 * "high priority", "sev-1"). This matches a wanted priority against the labels
 * that ALREADY exist on the repo, so we adopt the team's own convention
 * rather than inventing one - and returns undefined when nothing matches, which
 * is the right outcome: better no priority than a label that means something
 * else to the people reading the ticket.
 */
const PRIORITY_ALIASES: Record<TrackerPriority, string[]> = {
  urgent: ["urgent", "p0", "critical", "sev-1", "sev1", "highest", "blocker"],
  high: ["high", "p1", "sev-2", "sev2", "important"],
  medium: ["medium", "p2", "normal", "moderate", "sev-3", "sev3"],
  low: ["low", "p3", "p4", "minor", "trivial", "sev-4", "sev4"],
};

export function matchPriorityLabel(
  priority: TrackerPriority,
  labels: string[],
): string | undefined {
  const aliases = PRIORITY_ALIASES[priority] ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-");
  // Prefer a label that LOOKS like a priority label ("priority: high", "P1")
  // over a topic label that merely happens to contain the word.
  const scored = labels
    .map((name) => {
      const n = norm(name);
      const hit = aliases.find((a) => n === a || n.endsWith(`-${a}`) || n.endsWith(`:${a}`));
      if (!hit) return null;
      const looksLikePriority = /^(priority|prio|p|sev|severity)|[:-]/.test(n);
      return { name, score: (looksLikePriority ? 2 : 0) + (n === hit ? 1 : 0) };
    })
    .filter((x): x is { name: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.name;
}
