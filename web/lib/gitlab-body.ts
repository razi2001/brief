// Pure helpers for GitLab tickets: the body around the uploaded evidence, and
// the label conventions that stand in for status and priority. Split out of
// gitlab.ts to keep the adapter itself about the API.

import { placeEvidence, promoteSectionHeadings, type EvidenceKind } from "./ticket-body";
import { STATUS_COLOR, matchPriorityLabel, type TrackerPriority } from "./tracker";

/** One uploaded evidence file, as the `markdown` GitLab returned for it. */
export type GitlabEmbed = { kind: EvidenceKind; markdown: string; caption?: string };

/**
 * Build the ticket body around the uploaded evidence.
 *
 * Unlike GitHub, GitLab has a real upload API, and the `markdown` it hands back
 * renders an image inline and plays a video inline, so the evidence lives in
 * the ticket rather than behind a link to Brief. The rest follows github.ts:
 * section labels become headings, the evidence goes at the end of the agent's
 * own Evidence section rather than under a second heading, and each caption
 * sits directly above its image.
 */
export function buildGitlabBody(descriptionMarkdown: string, embeds: GitlabEmbed[]): string {
  const body = promoteSectionHeadings(descriptionMarkdown ?? "").replace(/\s+$/, "");
  const parts = embeds.map((e) => {
    if (e.kind === "recording") return `**Screen recording:**\n\n${e.markdown}`;
    const cap = e.caption?.trim() ? `${e.caption.trim()}\n\n` : "";
    return `${cap}${e.markdown}`;
  });
  if (!parts.length) return body;
  return placeEvidence(body, parts.join("\n\n"));
}

// ---------------------------------------------------------------------------
// Status and priority, which GitLab keeps in labels
// ---------------------------------------------------------------------------

/**
 * GitLab issues are only opened or closed. Teams express the workflow in
 * between with scoped labels ("workflow::In review"), and a scoped label is
 * exclusive within its scope on paid tiers, which is exactly a status field.
 */
const STATUS_LABEL = /^(workflow|status|state)::/i;

export function statusLabels(labels: string[]): string[] {
  return labels.filter((l) => STATUS_LABEL.test(l));
}

/** The scope of a scoped label is everything before its LAST "::". */
export function labelScope(label: string): string | null {
  const i = label.lastIndexOf("::");
  return i > 0 ? label.slice(0, i).toLowerCase() : null;
}

/** Every state the agent can ask for: the two native ones around the team's status labels. */
export function statesOf(labels: string[]): string[] {
  return ["Open", ...statusLabels(labels), "Closed"];
}

/** The value of the issue's status label ("workflow::In review" is "In review"), or "" without one. */
function statusValue(labels: string[]): string {
  const status = statusLabels(labels)[0] ?? "";
  return status.slice(status.lastIndexOf("::") + 2).trim();
}

/**
 * What the tickets feed shows: Closed, else the status label's value, else
 * Open. The agent's getIssue keeps the full label instead, since that is the
 * form it picked from statesOf and compares against.
 */
export function liveStateName(closed: boolean, labels: string[]): string {
  if (closed) return "Closed";
  return statusValue(labels) || "Open";
}

/** A status that says the work is finished, though the issue is still open. */
const DONE_STATUS = /\b(done|complete|completed|closed|shipped|resolved|released)\b/i;
/** A status that says the work has not started. */
const WAITING_STATUS = /\b(backlog|to ?do|triage|new|open|planning)\b/i;

/**
 * The feed's color for an issue. A closed issue is done. An open one is
 * active, as an open GitHub issue is, unless its status label says the work
 * is finished or has not started: "workflow::Done" on an open issue is still
 * done, and "workflow::Backlog" is nobody's work in progress.
 */
export function gitlabStateColor(closed: boolean, labels: string[]): string {
  if (closed) return STATUS_COLOR.done;
  const value = statusValue(labels);
  if (!value) return STATUS_COLOR.active;
  if (DONE_STATUS.test(value)) return STATUS_COLOR.done;
  if (WAITING_STATUS.test(value)) return STATUS_COLOR.neutral;
  return STATUS_COLOR.active;
}

const PRIORITIES: TrackerPriority[] = ["urgent", "high", "medium", "low"];

/**
 * GitLab's own docs suggest scoped numeric priorities, priority::1 (most
 * urgent) to priority::4. The shared alias matcher cannot read those, and must
 * not: a bare "P1" means high there, while priority::1 means urgent here.
 */
const NUMERIC_PRIORITY: Record<TrackerPriority, string> = { urgent: "1", high: "2", medium: "3", low: "4" };

/** The project's label for this priority: GitLab's numeric convention first, then the shared aliases. */
export function gitlabPriorityLabel(priority: TrackerPriority, labels: string[]): string | undefined {
  const numeric = labels.find((l) => /^priority::\s*(\d+)\s*$/i.exec(l)?.[1] === NUMERIC_PRIORITY[priority]);
  return numeric ?? matchPriorityLabel(priority, labels);
}

export function priorityOf(labels: string[]): TrackerPriority | undefined {
  return PRIORITIES.find((p) => gitlabPriorityLabel(p, labels) !== undefined);
}

/** True when this label alone would be read as SOME priority. */
function isPriorityLabel(label: string): boolean {
  return PRIORITIES.some((p) => gitlabPriorityLabel(p, [label]) === label);
}

/** "priority: high" -> "priority", "sev-1" -> "sev"; null for a single word. */
function labelPrefix(label: string): string | null {
  const m = /^(.+?)[\s:_-]+[^\s:_-]+$/.exec(label.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Whether `other` is an alternative to the chosen priority label, so choosing
 * one replaces it. Teams keep severity, "blocker" or "minor" labels beside
 * their priority, and a priority change must leave those alone: a scoped label
 * replaces its own scope, "P1" other P-numbers, "priority: high" other
 * "priority: ..." labels, and a bare "High" only the other bare priority words.
 */
export function samePriorityFamily(chosen: string, other: string): boolean {
  if (other === chosen) return false;
  const scope = labelScope(chosen);
  if (scope) return labelScope(other) === scope;
  if (/^p\d+$/i.test(chosen.trim())) return /^p\d+$/i.test(other.trim());
  const prefix = labelPrefix(chosen);
  if (prefix) return labelPrefix(other) === prefix && isPriorityLabel(other);
  return (PRIORITIES as string[]).includes(other.trim().toLowerCase());
}
