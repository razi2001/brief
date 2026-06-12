// Provider-agnostic issue-tracker abstraction.
// Concrete implementations live in linear.ts (makeLinearTracker) and jira.ts (makeJiraTracker).

export interface TrackerTarget {
  id: string;
  key: string;
  name: string;
  /** Label names usable when filing into this target (Linear: workspace + team labels). */
  labels?: string[];
  /** Workflow state names available in this target (Linear teams only). */
  states?: string[];
}

/** Normalized priority the agent can set; adapters map it to provider values. */
export type TrackerPriority = "urgent" | "high" | "medium" | "low";

export interface IssueResult {
  id: string;
  identifier: string;
  url: string;
  title: string;
}

export interface Tracker {
  kind: "linear" | "jira";
  /** The noun the model should use for a filing destination: "team" (Linear) or "project" (Jira). */
  targetNoun: string;
  listTargets(): Promise<TrackerTarget[]>;
  // File one issue. The tracker handles evidence its own way:
  //  - Linear: uploads images, embeds ![](assetUrl) inline in description.
  //  - Jira: creates the issue, then attaches the files (Attachments panel), and notes them in the body.
  // labels/priority/state are optional and best-effort: unknown names are
  // resolved (or created) where the provider allows, and silently skipped
  // otherwise — they must never fail the filing itself.
  fileIssue(input: {
    targetId: string;
    title: string;
    descriptionMarkdown: string;
    labels?: string[];
    priority?: TrackerPriority;
    /** Workflow state name (e.g. "Backlog", "Todo") — Linear only. */
    state?: string;
    evidence: Array<{ filename: string; contentType: string; bytes: Buffer }>;
  }): Promise<IssueResult>;
}
