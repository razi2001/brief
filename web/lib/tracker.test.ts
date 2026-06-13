import { describe, it, expect } from "vitest";
import { resolveName } from "./tracker";

describe("resolveName", () => {
  const states = ["Backlog", "Todo", "In Progress", "In Review", "Done", "Triage"];

  it("matches exactly, case-insensitively", () => {
    expect(resolveName("triage", states)).toBe("Triage");
    expect(resolveName("IN PROGRESS", states)).toBe("In Progress");
  });

  it("prefers an exact match over a prefix match", () => {
    expect(resolveName("in review", states)).toBe("In Review");
  });

  it("falls back to a prefix match", () => {
    expect(resolveName("back", states)).toBe("Backlog");
  });

  it("falls back to a substring match", () => {
    expect(resolveName("progress", states)).toBe("In Progress");
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveName("Blocked", states)).toBeUndefined();
  });

  it("handles empty input", () => {
    expect(resolveName("", states)).toBeUndefined();
    expect(resolveName("  ", states)).toBeUndefined();
  });
});
