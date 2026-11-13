import type { DashboardBrief } from "@/lib/brief-types";

/**
 * Where a brief stands: still a draft, or, once it is a ticket, one of four
 * plain words. Every tracker names its own
 * states ("In Dev Testing", "À faire", "Won't do") and Brief only keeps the
 * name, so the group is read from it. An unknown name is Open: a ticket nobody
 * can place is one somebody still has to look at.
 */
export const STATUS_GROUPS = ["draft", "open", "progress", "done", "closed"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const GROUP_LABEL: Record<StatusGroup, string> = {
  draft: "Drafts",
  open: "Open",
  progress: "In progress",
  done: "Done",
  closed: "Closed",
};

export const GROUP_COLOR: Record<StatusGroup, string> = {
  draft: "#8a8378",
  open: "#3b6fb6",
  progress: "#dd6936",
  done: "#2e7d32",
  closed: "#c9c3b5",
};

// Dropped without being fixed. Checked first: "Canceled" must not read as done.
const CLOSED = /cancel|duplicat|delet|won'?t|invalid|reject|declin|obsolete|abandon|annul|supprim|doublon/i;
const DONE = /done|complete|closed|resolv|fixed|shipped|released|merged|termin|fini|livr|\bfait/i;
const PROGRESS = /progress|doing|review|\btest|\bqa\b|\bdev\b|ready|staging|started|working|blocked|en cours|valid/i;

/** The group a tracker state name belongs to. */
export function groupOfState(stateName: string | null | undefined): StatusGroup {
  const s = (stateName ?? "").trim();
  if (!s) return "open";
  if (CLOSED.test(s)) return "closed";
  if (DONE.test(s)) return "done";
  if (PROGRESS.test(s)) return "progress";
  return "open";
}

/**
 * The group a row in the Tickets list belongs to. A draft (written up or
 * being written, never filed) is a Draft. A ticket still filing or that
 * didn't file is Open: it has not reached anyone yet.
 */
export function groupOfBrief(b: Pick<DashboardBrief, "status" | "ticket" | "draft">): StatusGroup {
  if (b.draft || b.status === "drafted") return "draft";
  if (b.status !== "filed") return "open";
  if (b.ticket?.deleted) return "closed";
  return groupOfState(b.ticket?.stateName);
}

/** How many rows sit in each group. */
export function countGroups(briefs: Pick<DashboardBrief, "status" | "ticket" | "draft">[]): Record<StatusGroup, number> {
  const counts: Record<StatusGroup, number> = { draft: 0, open: 0, progress: 0, done: 0, closed: 0 };
  for (const b of briefs) counts[groupOfBrief(b)] += 1;
  return counts;
}
