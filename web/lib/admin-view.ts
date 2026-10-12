/**
 * The owner's monitoring view (/admin): who may open it, and the pure
 * filtering behind it. Server loading lives in admin-server.ts.
 */

/** The accounts allowed to see every ticket and draft, across all users. */
export const ADMIN_EMAILS = ["fezzani.razi@gmail.com"];

/** The parts of a Clerk email address the admin check reads. */
export type EmailLike = {
  emailAddress: string;
  verification: { status: string; strategy?: string | null } | null;
};

/**
 * True when one of the user's emails is on the admin list AND Clerk verified
 * it itself (Google sign-in, an emailed code...). "admin"-strategy emails are
 * set from our own backend - /api/account/link-email adopts a tracker
 * account's address that way - so they never count here: holding a tracker
 * account must not be enough to open everyone's tickets.
 */
export function isAdminEmail(emails: EmailLike[] | null | undefined): boolean {
  return (emails ?? []).some(
    (e) =>
      ADMIN_EMAILS.includes(e.emailAddress.trim().toLowerCase()) &&
      e.verification?.status === "verified" &&
      e.verification.strategy !== "admin",
  );
}

export type AdminKind = "ticket" | "draft";

/**
 * Tickets vs Drafts, by the same rule as the Tickets and Drafts tabs: a draft
 * being written up is "processing" with no filing claim and no body yet.
 */
export function kindOf(b: {
  status: string;
  filing_started_at?: string | null;
  ticket_body?: string | null;
}): AdminKind {
  if (b.status === "drafted") return "draft";
  if (b.status === "processing" && !b.filing_started_at && !b.ticket_body) return "draft";
  return "ticket";
}

export type AdminRow = {
  id: string;
  kind: AdminKind;
  status: string;
  title: string;
  createdAt: string | null;
  deleted: boolean;
  shareId: string | null;
  ticketUrl: string | null;
  ticketIdentifier: string | null;
  provider: string | null;
  stateName: string | null;
  stateColor: string | null;
  userId: string;
  personName: string;
  personEmail: string | null;
  personImage: string | null;
  orgKey: string;
  orgName: string;
};

/** The org key for people Brief couldn't place in a tracker workspace. */
export const NO_ORG = "__none";

export type KindFilter = "all" | AdminKind;

export type AdminFilters = {
  kind: KindFilter;
  /** An org key, or "" for every org. */
  org: string;
  /** A user id, or "" for everyone. */
  person: string;
  q: string;
  deleted: boolean;
};

export const DEFAULT_FILTERS: AdminFilters = { kind: "all", org: "", person: "", q: "", deleted: false };

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Filters from the page URL, so a filtered view can be bookmarked. */
export function parseFilters(params: Params): AdminFilters {
  const kind = first(params.kind);
  return {
    kind: kind === "ticket" || kind === "draft" ? kind : "all",
    org: first(params.org),
    person: first(params.person),
    q: first(params.q),
    deleted: first(params.deleted) === "1",
  };
}

/** The inverse of parseFilters: only what differs from the defaults. */
export function filtersToQuery(f: AdminFilters): string {
  const p = new URLSearchParams();
  if (f.kind !== "all") p.set("kind", f.kind);
  if (f.org) p.set("org", f.org);
  if (f.person) p.set("person", f.person);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.deleted) p.set("deleted", "1");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Everything but the kind toggle, so the toggle can count what each side holds. */
function matchesExceptKind(r: AdminRow, f: AdminFilters): boolean {
  if (!f.deleted && r.deleted) return false;
  if (f.org && r.orgKey !== f.org) return false;
  if (f.person && r.userId !== f.person) return false;
  const q = f.q.trim().toLowerCase();
  if (q) {
    const hay = [r.title, r.ticketIdentifier, r.personName, r.personEmail, r.orgName, r.shareId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function filterRows(rows: AdminRow[], f: AdminFilters): AdminRow[] {
  return rows.filter((r) => (f.kind === "all" || r.kind === f.kind) && matchesExceptKind(r, f));
}

/** How many rows each side of the kind toggle would show under the other filters. */
export function kindCounts(rows: AdminRow[], f: AdminFilters): Record<KindFilter, number> {
  const counts = { all: 0, ticket: 0, draft: 0 };
  for (const r of rows) {
    if (!matchesExceptKind(r, f)) continue;
    counts.all++;
    counts[r.kind]++;
  }
  return counts;
}

export type Option = { value: string; label: string; count: number };

/** Orgs present in the rows, A-Z, with "No org" last. Counts ignore deleted rows unless shown. */
export function orgOptions(rows: AdminRow[], includeDeleted: boolean): Option[] {
  const map = new Map<string, Option>();
  for (const r of rows) {
    if (!includeDeleted && r.deleted) continue;
    const o = map.get(r.orgKey) ?? { value: r.orgKey, label: r.orgName, count: 0 };
    o.count++;
    map.set(r.orgKey, o);
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(a.value === NO_ORG) - Number(b.value === NO_ORG) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}

/** People present in the rows - only those in `org` when one is picked - A-Z. */
export function personOptions(rows: AdminRow[], org: string, includeDeleted: boolean): Option[] {
  const map = new Map<string, Option>();
  for (const r of rows) {
    if (!includeDeleted && r.deleted) continue;
    if (org && r.orgKey !== org) continue;
    const o = map.get(r.userId) ?? { value: r.userId, label: r.personName, count: 0 };
    o.count++;
    map.set(r.userId, o);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
