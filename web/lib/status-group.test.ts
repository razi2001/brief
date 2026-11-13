import { describe, expect, it } from "vitest";
import { countGroups, groupOfBrief, groupOfState } from "./status-group";

describe("groupOfState", () => {
  // Real state names from the trackers people file into.
  it.each([
    ["Todo", "open"],
    ["to do", "open"],
    ["Triage", "open"],
    ["Backlog", "open"],
    ["Open", "open"],
    ["À faire", "open"],
    ["Ticket Preparation", "open"],
    ["In Progress", "progress"],
    ["In Dev Testing", "progress"],
    ["In Review", "progress"],
    ["Production Ready", "progress"],
    ["En cours", "progress"],
    ["Done", "done"],
    ["Terminé(e)", "done"],
    ["Closed", "done"],
    ["Resolved", "done"],
    ["Canceled", "closed"],
    ["Cancelled", "closed"],
    ["Duplicate", "closed"],
    ["Deleted", "closed"],
    ["Won't do", "closed"],
    ["Invalid", "closed"],
  ] as const)("%s is %s", (name, group) => {
    expect(groupOfState(name)).toBe(group);
  });

  it("is Open for a name nobody can place, or none", () => {
    expect(groupOfState("Icebox")).toBe("open");
    expect(groupOfState("")).toBe("open");
    expect(groupOfState(null)).toBe("open");
    expect(groupOfState(undefined)).toBe("open");
  });

  it("does not take a word that only contains 'test' for testing", () => {
    expect(groupOfState("Latest")).toBe("open");
  });
});

const ticket = (stateName: string, deleted = false) => ({ title: "", url: "", stateName, stateColor: "", createdAt: "", deleted });

describe("groupOfBrief", () => {
  it("reads a filed ticket's group from its state", () => {
    expect(groupOfBrief({ status: "filed", ticket: ticket("Done") })).toBe("done");
    expect(groupOfBrief({ status: "filed", ticket: null })).toBe("open");
  });
  it("is Open while filing and when it didn't file", () => {
    expect(groupOfBrief({ status: "processing", ticket: null })).toBe("open");
    expect(groupOfBrief({ status: "failed", ticket: null })).toBe("open");
  });
  it("is a Draft while it is written up and not filed", () => {
    expect(groupOfBrief({ status: "drafted", ticket: null })).toBe("draft");
    expect(groupOfBrief({ status: "processing", ticket: null, draft: true })).toBe("draft");
  });
  it("is Closed once the tracker no longer has the ticket", () => {
    expect(groupOfBrief({ status: "filed", ticket: ticket("In Progress", true) })).toBe("closed");
  });
});

describe("countGroups", () => {
  it("counts every row in exactly one group", () => {
    const rows = [
      { status: "filed", ticket: ticket("Todo") },
      { status: "filed", ticket: ticket("Done") },
      { status: "filed", ticket: ticket("Done") },
      { status: "filed", ticket: ticket("Duplicate") },
      { status: "failed", ticket: null },
    ];
    expect(countGroups(rows)).toEqual({ draft: 0, open: 2, progress: 0, done: 2, closed: 1 });
  });
  it("counts drafts on their own, never as open tickets", () => {
    const rows = [
      { status: "drafted", ticket: null },
      // being written up: listed as a draft before it has a body
      { status: "processing", ticket: null, draft: true },
      // being filed: a ticket on its way
      { status: "processing", ticket: null },
      { status: "filed", ticket: ticket("Todo") },
    ];
    expect(countGroups(rows)).toEqual({ draft: 2, open: 2, progress: 0, done: 0, closed: 0 });
  });
});
