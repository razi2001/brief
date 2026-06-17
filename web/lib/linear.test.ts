import { describe, it, expect } from "vitest";
import { mapLinearSearchIssue } from "./linear";

describe("mapLinearSearchIssue", () => {
  it("maps a Linear issue node to an enriched search result", () => {
    const result = mapLinearSearchIssue({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      priority: 2, // high
      state: { name: "Todo" },
      assignee: { displayName: "Sam", name: "sam@acme.com" },
      labels: { nodes: [{ name: "area/agent" }, { name: "type/bug" }] },
      team: { name: "AI" },
      project: { name: "Routing" },
    });
    expect(result).toEqual({
      identifier: "AI-12",
      title: "Agent picks wrong team",
      url: "https://linear.app/acme/issue/AI-12",
      target: "AI",
      state: "Todo",
      labels: ["area/agent", "type/bug"],
      assignee: "Sam",
      priority: "high",
      project: "Routing",
    });
  });

  it("tolerates missing fields and unknown priority", () => {
    const result = mapLinearSearchIssue({ identifier: "X-1", title: "t", url: "u", priority: 0 });
    expect(result.target).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.assignee).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.project).toBeUndefined();
  });
});
