// Provider-agnostic issue-tracker abstraction.
// Concrete implementations live in linear.ts (makeLinearTracker) and jira.ts (makeJiraTracker).

export interface TrackerTarget {
  id: string;
  key: string;
  name: string;
}

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
  fileIssue(input: {
    targetId: string;
    title: string;
    descriptionMarkdown: string;
    evidence: Array<{ filename: string; contentType: string; bytes: Buffer }>;
  }): Promise<IssueResult>;
}
