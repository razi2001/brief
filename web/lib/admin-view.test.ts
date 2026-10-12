import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  NO_ORG,
  filterRows,
  filtersToQuery,
  isAdminEmail,
  kindCounts,
  kindOf,
  orgOptions,
  parseFilters,
  personOptions,
  type AdminRow,
} from "./admin-view";

const verified = (emailAddress: string, strategy = "from_oauth_google") => ({
  emailAddress,
  verification: { status: "verified", strategy },
});

describe("isAdminEmail", () => {
  it("lets the owner in on a Clerk-verified address, any case", () => {
    expect(isAdminEmail([verified("Fezzani.Razi@gmail.com")])).toBe(true);
    expect(isAdminEmail([verified("someone@x.com"), verified("fezzani.razi@gmail.com", "email_code")])).toBe(true);
  });

  it("keeps everyone else out", () => {
    expect(isAdminEmail([verified("someone@x.com")])).toBe(false);
    expect(isAdminEmail([])).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("ignores an unverified owner address", () => {
    expect(
      isAdminEmail([{ emailAddress: "fezzani.razi@gmail.com", verification: { status: "unverified", strategy: "email_code" } }]),
    ).toBe(false);
    expect(isAdminEmail([{ emailAddress: "fezzani.razi@gmail.com", verification: null }])).toBe(false);
  });

  it("ignores an address our backend marked verified (adopted from a tracker account)", () => {
    expect(isAdminEmail([verified("fezzani.razi@gmail.com", "admin")])).toBe(false);
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
  title: "Checkout fails",
  createdAt: "2026-10-01T10:00:00Z",
  deleted: false,
  shareId: "abc",
  ticketUrl: "https://linear.app/x/issue/RAZ-1",
  ticketIdentifier: "RAZ-1",
  provider: "linear",
  stateName: "Todo",
  stateColor: "#888",
  userId: "u1",
  personName: "Razi Fezzani",
  personEmail: "fezzani.razi@gmail.com",
  personImage: null,
  orgKey: "linear:thunders",
  orgName: "Thunders",
  ...over,
});

const rows: AdminRow[] = [
  row({ id: "1" }),
  row({ id: "2", kind: "draft", status: "drafted", ticketIdentifier: null, title: "Login loops" }),
  row({ id: "3", userId: "u2", personName: "Alice", personEmail: "alice@acme.io", orgKey: "jira:acme", orgName: "Acme" }),
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
    expect(filterRows(rows, { ...DEFAULT_FILTERS, org: "jira:acme" }).map((r) => r.id)).toEqual(["3"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, org: NO_ORG }).map((r) => r.id)).toEqual(["4"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, person: "u1", kind: "ticket" }).map((r) => r.id)).toEqual(["1"]);
  });

  it("searches title, identifier, person, email and org", () => {
    const q = (s: string) => filterRows(rows, { ...DEFAULT_FILTERS, q: s }).map((r) => r.id);
    expect(q("login")).toEqual(["2"]);
    expect(q("raz-1")).toEqual(["1", "3", "4"]);
    expect(q("ALICE@")).toEqual(["3"]);
    expect(q("acme")).toEqual(["3"]);
    expect(q("  ")).toHaveLength(4);
  });
});

describe("kindCounts", () => {
  it("counts each side under the other filters", () => {
    expect(kindCounts(rows, DEFAULT_FILTERS)).toEqual({ all: 4, ticket: 3, draft: 1 });
    expect(kindCounts(rows, { ...DEFAULT_FILTERS, kind: "draft", org: "jira:acme" })).toEqual({ all: 1, ticket: 1, draft: 0 });
  });
});

describe("options", () => {
  it("lists orgs A-Z with No org last", () => {
    expect(orgOptions(rows, false)).toEqual([
      { value: "jira:acme", label: "Acme", count: 1 },
      { value: "linear:thunders", label: "Thunders", count: 2 },
      { value: NO_ORG, label: "No org", count: 1 },
    ]);
    expect(orgOptions(rows, true).find((o) => o.value === "linear:thunders")?.count).toBe(3);
  });

  it("narrows people to the picked org", () => {
    expect(personOptions(rows, "", false).map((o) => o.label)).toEqual(["Alice", "bob", "Razi Fezzani"]);
    expect(personOptions(rows, "jira:acme", false)).toEqual([{ value: "u2", label: "Alice", count: 1 }]);
  });
});

describe("URL round trip", () => {
  it("keeps only what differs from the defaults", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe("");
    const f = { kind: "draft" as const, org: "jira:acme", person: "u2", q: " login ", deleted: true };
    const qs = filtersToQuery(f);
    expect(qs).toBe("?kind=draft&org=jira%3Aacme&person=u2&q=login&deleted=1");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(qs)))).toEqual({ ...f, q: "login" });
  });

  it("falls back to defaults on junk", () => {
    expect(parseFilters({ kind: "everything", deleted: "yes", org: ["a", "b"] })).toEqual({ ...DEFAULT_FILTERS, org: "a" });
  });
});
