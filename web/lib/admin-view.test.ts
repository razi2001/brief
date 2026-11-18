import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  NO_ORG,
  OWNER_FIELDS,
  filterRows,
  filtersToQuery,
  isAdminEmail,
  kindCounts,
  kindOf,
  orgOptions,
  ownerEmails,
  parseFilters,
  personOptions,
  type AdminRow,
} from "./admin-view";

const OWNERS = ["owner@example.com"];

const verified = (emailAddress: string, strategy = "from_oauth_google") => ({
  emailAddress,
  verification: { status: "verified", strategy },
});

describe("ownerEmails", () => {
  it("reads a comma separated list, trimmed and lowercased", () => {
    expect(ownerEmails(" A@x.com, b@y.io ,,")).toEqual(["a@x.com", "b@y.io"]);
  });

  it("is empty when unset, so nobody is an owner", () => {
    expect(ownerEmails(undefined)).toEqual([]);
    expect(ownerEmails("")).toEqual([]);
  });
});

describe("isAdminEmail", () => {
  it("lets the owner in on a Clerk-verified address, any case", () => {
    expect(isAdminEmail([verified("Owner@Example.com")], OWNERS)).toBe(true);
    expect(isAdminEmail([verified("someone@x.com"), verified("owner@example.com", "email_code")], OWNERS)).toBe(true);
  });

  it("keeps everyone else out", () => {
    expect(isAdminEmail([verified("someone@x.com")], OWNERS)).toBe(false);
    expect(isAdminEmail([], OWNERS)).toBe(false);
    expect(isAdminEmail(null, OWNERS)).toBe(false);
  });

  it("lets nobody in when no owner is configured", () => {
    expect(isAdminEmail([verified("owner@example.com")], [])).toBe(false);
  });

  it("ignores an unverified owner address", () => {
    expect(
      isAdminEmail([{ emailAddress: "owner@example.com", verification: { status: "unverified", strategy: "email_code" } }], OWNERS),
    ).toBe(false);
    expect(isAdminEmail([{ emailAddress: "owner@example.com", verification: null }], OWNERS)).toBe(false);
  });

  it("ignores an address our backend marked verified (adopted from a tracker account)", () => {
    expect(isAdminEmail([verified("owner@example.com", "admin")], OWNERS)).toBe(false);
  });
});

describe("kindOf", () => {
  it("matches the Tickets / Drafts tabs", () => {
    expect(kindOf({ status: "drafted" })).toBe("draft");
    expect(kindOf({ status: "processing" })).toBe("draft");
    expect(kindOf({ status: "processing", filing_started_at: "2026-10-01" })).toBe("ticket");
    expect(kindOf({ status: "processing", ticket_body: "body" })).toBe("ticket");
    expect(kindOf({ status: "filed" })).toBe("ticket");
    expect(kindOf({ status: "failed" })).toBe("ticket");
  });
});

const row = (over: Partial<AdminRow>): AdminRow => ({
  id: over.id ?? "id",
  kind: "ticket",
  status: "filed",
  createdAt: "2026-10-01T10:00:00Z",
  deleted: false,
  provider: "linear",
  userId: "u1",
  personName: "Sam Rivera",
  personEmail: "sam@example.com",
  personImage: null,
  orgKey: "linear:acme",
  orgName: "Acme",
  ...over,
});

const rows: AdminRow[] = [
  row({ id: "1" }),
  row({ id: "2", kind: "draft", status: "drafted" }),
  row({ id: "3", userId: "u2", personName: "Alice", personEmail: "alice@globex.io", orgKey: "jira:globex", orgName: "Globex", provider: "jira" }),
  row({ id: "4", userId: "u3", personName: "bob", personEmail: null, orgKey: NO_ORG, orgName: "No org" }),
  row({ id: "5", deleted: true }),
];

describe("filterRows", () => {
  it("hides deleted rows unless asked", () => {
    expect(filterRows(rows, DEFAULT_FILTERS).map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, deleted: true })).toHaveLength(5);
  });

  it("filters by kind, org and person together", () => {
    expect(filterRows(rows, { ...DEFAULT_FILTERS, kind: "draft" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, org: "jira:globex" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, org: NO_ORG }).map((r) => r.id)).toEqual(["4"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, person: "u1", kind: "ticket" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("searches person, email, org and tracker", () => {
    const q = (s: string) => filterRows(rows, { ...DEFAULT_FILTERS, q: s }).map((r) => r.id);
    expect(q("sam riv")).toEqual(["1", "2"]);
    expect(q("ALICE@")).toEqual(["3"]);
    expect(q("globex")).toEqual(["3"]);
    expect(q("jira")).toEqual(["3"]);
    expect(q("  ")).toHaveLength(4);
  });
});

describe("kindCounts", () => {
  it("counts each side under the other filters", () => {
    expect(kindCounts(rows, DEFAULT_FILTERS)).toEqual({ all: 4, ticket: 3, draft: 1 });
    expect(kindCounts(rows, { ...DEFAULT_FILTERS, kind: "draft", org: "jira:globex" })).toEqual({ all: 1, ticket: 1, draft: 0 });
  });
});

describe("options", () => {
  it("lists orgs A-Z with No org last", () => {
    expect(orgOptions(rows, false)).toEqual([
      { value: "linear:acme", label: "Acme", count: 2 },
      { value: "jira:globex", label: "Globex", count: 1 },
      { value: NO_ORG, label: "No org", count: 1 },
    ]);
    expect(orgOptions(rows, true).find((o) => o.value === "linear:acme")?.count).toBe(3);
  });

  it("narrows people to the picked org", () => {
    expect(personOptions(rows, "", false).map((o) => o.label)).toEqual(["Alice", "bob", "Sam Rivera"]);
    expect(personOptions(rows, "jira:globex", false)).toEqual([{ value: "u2", label: "Alice", count: 1 }]);
  });
});

describe("URL round trip", () => {
  it("keeps only what differs from the defaults", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    const f = { kind: "draft" as const, org: "jira:globex", person: "u2", q: " alice ", deleted: true };
    const qs = filtersToQuery(f);
    expect(qs).toBe("?kind=draft&org=jira%3Aglobex&person=u2&q=alice&deleted=1");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual({ ...f, q: "alice" });
  });

  it("falls back to defaults on junk", () => {
    expect(parseFilters({ kind: "everything", deleted: "yes", org: ["a", "b"] })).toEqual({ ...DEFAULT_FILTERS, org: "a" });
  });
});

describe("OWNER_FIELDS", () => {
  // The owner view promises it can't read tickets. Adding a field here is a
  // privacy change: update PRIVACY.md and the privacy page with it.
  it("is status and identity only, never ticket content", () => {
    expect([...OWNER_FIELDS].sort()).toEqual([
      "createdAt",
      "deleted",
      "id",
      "kind",
      "orgKey",
      "orgName",
      "personEmail",
      "personImage",
      "personName",
      "provider",
      "status",
      "userId",
    ]);
    expect(Object.keys(row({})).sort()).toEqual([...OWNER_FIELDS].sort());
  });
});

describe("OWNER_COLUMNS", () => {
  // The database columns the owner view reads. No title, ticket text, share
  // id or tracker link may ever be added here.
  it("reads status and timing only", async () => {
    const { OWNER_COLUMNS } = await import("./admin-view");
    expect([...OWNER_COLUMNS].sort()).toEqual(
      ["archived_at", "created_at", "filing_started_at", "id", "status", "ticket_provider", "user_id"],
    );
  });
});
