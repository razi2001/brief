import { describe, it, expect } from "vitest";
import { chunk, providerOf, shortIdentifier, ticketSnapshotPatch } from "./ticket-sync";

describe("providerOf", () => {
  it("detects Jira from the hostname", () => {
    expect(providerOf("https://acme.atlassian.net/browse/PROJ-42")).toBe("jira");
    expect(providerOf("https://jira.mycompany.com/browse/PROJ-42")).toBe("jira");
  });

  it("detects Linear from the hostname", () => {
    expect(providerOf("https://linear.app/acme/issue/RAZ-180/some-slug")).toBe("linear");
  });

  it("ignores 'jira' appearing in the ticket-title slug (RAZ-181 regression)", () => {
    expect(
      providerOf(
        "https://linear.app/acme/issue/RAZ-181/connections-page-still-shows-the-linear-card-after-switching-to-jira",
      ),
    ).toBe("linear");
  });

  it("detects GitHub from the hostname", () => {
    expect(providerOf("https://github.com/acme/web-app/issues/42")).toBe("github");
  });

  it("defaults to linear for missing or unparseable urls", () => {
    expect(providerOf(null)).toBe("linear");
    expect(providerOf("not a url")).toBe("linear");
  });

  // With seven providers a hostname guess is no longer safe (a self-hosted
  // instance can live anywhere), so the recorded column wins outright.
  it("trusts the recorded provider over the url", () => {
    expect(providerOf("https://linear.app/acme/issue/RAZ-1/x", "github")).toBe("github");
    expect(providerOf("https://tracker.internal.example/42", "jira")).toBe("jira");
  });

  it("falls back to the url when the recorded value is absent or unknown", () => {
    expect(providerOf("https://github.com/a/b/issues/1", null)).toBe("github");
    expect(providerOf("https://github.com/a/b/issues/1", "")).toBe("github");
    expect(providerOf("https://github.com/a/b/issues/1", "bogus")).toBe("github");
  });

  it("does not mistake a hostname that merely contains a provider name", () => {
    // Matching on a bare substring would read this as GitHub.
    expect(providerOf("https://github.com.evil.example/x")).toBe("linear");
    expect(providerOf("https://notgithub.com/x")).toBe("linear");
  });
});

describe("chunk", () => {
  it("splits a list into fixed-size chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns one chunk when the list fits", () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
  it("returns no chunks for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("ticketSnapshotPatch", () => {
  const row = {
    ticket_title: "Old title",
    ticket_state_name: "Todo",
    ticket_state_color: "#aaa",
  };

  it("returns null when the live info matches the stored snapshot", () => {
    expect(
      ticketSnapshotPatch(row, { title: "Old title", stateName: "Todo", stateColor: "#aaa" }),
    ).toBeNull();
  });

  it("returns only the changed fields", () => {
    expect(
      ticketSnapshotPatch(row, { title: "Old title", stateName: "In Progress", stateColor: "#ff0" }),
    ).toEqual({ ticket_state_name: "In Progress", ticket_state_color: "#ff0" });
  });

  it("fills a never-synced row completely", () => {
    expect(
      ticketSnapshotPatch(
        { ticket_title: null, ticket_state_name: null, ticket_state_color: null },
        { title: "Real ticket title", stateName: "Triage", stateColor: "#dd6936" },
      ),
    ).toEqual({
      ticket_title: "Real ticket title",
      ticket_state_name: "Triage",
      ticket_state_color: "#dd6936",
    });
  });

  it("never overwrites a stored value with an empty live one", () => {
    expect(
      ticketSnapshotPatch(row, { title: "", stateName: "", stateColor: "" }),
    ).toBeNull();
  });
});

describe("ticketSnapshotPatch - a ticket that moved teams", () => {
  const row = {
    ticket_title: "Same title",
    ticket_state_name: "Todo",
    ticket_state_color: "#aaa",
    ticket_identifier: "APP-5342",
    ticket_url: "https://linear.app/acme/issue/APP-5342/same-title",
  };

  it("follows the ticket to its new identifier and url", () => {
    expect(
      ticketSnapshotPatch(row, {
        title: "Same title",
        stateName: "Todo",
        stateColor: "#aaa",
        identifier: "AI-2652",
        url: "https://linear.app/acme/issue/AI-2652/same-title",
      }),
    ).toEqual({
      ticket_identifier: "AI-2652",
      ticket_url: "https://linear.app/acme/issue/AI-2652/same-title",
    });
  });

  it("leaves identifier and url alone when the live info doesn't carry them", () => {
    expect(ticketSnapshotPatch(row, { title: "Same title", stateName: "Todo", stateColor: "#aaa" })).toBeNull();
  });
});

describe("shortIdentifier", () => {
  // GitHub identifiers must be fully qualified (issue numbers are only unique
  // per repository), but "owner/repo#1" truncates to the owner in a narrow
  // column - so every ticket in a workspace reads identically.
  it("drops the owner from a GitHub identifier", () => {
    expect(shortIdentifier("acme/web-app#4212", "github")).toBe("web-app#4212");
  });

  // Plain CSS truncation clips the END, which is exactly the part that
  // identifies the ticket - "brief-marketing-website#1" became "brief-mar…"
  // and every row in the list read the same.
  it("keeps the issue number when the repo name is too long", () => {
    const out = shortIdentifier("Razi-fezzani_thndrc/brief-marketing-website#1", "github");
    expect(out).toBe("brief-marketing…#1");
    expect(out.endsWith("#1")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(18);
  });

  it("keeps the number even when it is long and the repo is not", () => {
    const out = shortIdentifier("acme/a-really-long-repository-name#12345", "github", 14);
    expect(out.endsWith("#12345")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(14);
  });

  it("leaves Linear and Jira identifiers alone - they are already short", () => {
    expect(shortIdentifier("ENG-42", "linear")).toBe("ENG-42");
    expect(shortIdentifier("PROJ-7", "jira")).toBe("PROJ-7");
  });

  it("only shortens what actually looks like a GitHub ref", () => {
    // A malformed value is shown as-is rather than silently mangled.
    expect(shortIdentifier("just-a-thing", "github")).toBe("just-a-thing");
    expect(shortIdentifier("owner/repo", "github")).toBe("owner/repo");
  });

  it("does not shorten a GitHub-shaped id attributed to another provider", () => {
    expect(shortIdentifier("acme/web-app#4212", "linear")).toBe("acme/web-app#4212");
  });

  it("handles missing values", () => {
    expect(shortIdentifier(null, "github")).toBe("");
    expect(shortIdentifier(undefined, "github")).toBe("");
    expect(shortIdentifier("  ", "github")).toBe("");
  });
});
