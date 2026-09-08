import { describe, it, expect } from "vitest";
import { chunk, providerOf, ticketSnapshotPatch } from "./ticket-sync";

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

  it("defaults to linear for missing or unparseable urls", () => {
    expect(providerOf(null)).toBe("linear");
    expect(providerOf("not a url")).toBe("linear");
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
