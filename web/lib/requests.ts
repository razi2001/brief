/**
 * Feature requests (the Requests tab): what a request is, how a status reads,
 * and the pure rules behind the list. Loading and writing live in
 * requests-server.ts.
 */

export const STATUSES = ["open", "planned", "in_progress", "shipped", "declined"] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  declined: "Declined",
};

/** One dot colour per status, the same palette the rest of the app uses. */
export const STATUS_COLOR: Record<RequestStatus, string> = {
  open: "#8a8378",
  planned: "#3b6fb6",
  in_progress: "#dd6936",
  shipped: "#2e7d32",
  declined: "#c62828",
};

export const MIN_TITLE = 3;
export const MAX_TITLE = 120;
export const MAX_BODY = 1000;
/** Requests one person may send in a day. */
export const DAILY_LIMIT = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request id from a URL, checked before it reaches the database. */
export function isRequestId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function isStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** The title as stored, or null when it isn't one. */
export function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE).trim();
  return t.length >= MIN_TITLE ? t : null;
}

export function cleanBody(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_BODY).trim() : "";
}

/**
 * One request, as the page draws it. Requests are anonymous: nothing here says
 * who sent one, not even to the owner. `mine` is only ever true for the person
 * looking at their own.
 */
export type RequestItem = {
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  createdAt: string;
  votes: number;
  voted: boolean;
  mine: boolean;
};

export type RequestSort = "top" | "new";

const time = (iso: string) => new Date(iso).getTime() || 0;

export function sortRequests(items: RequestItem[], sort: RequestSort): RequestItem[] {
  const byNew = (a: RequestItem, b: RequestItem) => time(b.createdAt) - time(a.createdAt);
  return [...items].sort(sort === "new" ? byNew : (a, b) => b.votes - a.votes || byNew(a, b));
}

export type StatusFilter = RequestStatus | "all";

export function filterRequests(items: RequestItem[], filter: StatusFilter): RequestItem[] {
  return filter === "all" ? items : items.filter((i) => i.status === filter);
}

export function statusCounts(items: RequestItem[]): Record<StatusFilter, number> {
  const counts = { all: items.length, open: 0, planned: 0, in_progress: 0, shipped: 0, declined: 0 };
  for (const i of items) counts[i.status] += 1;
  return counts;
}
