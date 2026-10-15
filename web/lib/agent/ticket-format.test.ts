import { describe, it, expect } from "vitest";
import { normalizeSectionLabels, withReplayLink } from "./process-brief";
import { promoteSectionHeadings } from "@/lib/ticket-body";

describe("section labels", () => {
  it("turns a bare label line into a bold label, which GitHub then makes a heading", () => {
    const md = "The headline is wrong.\n\nSteps to reproduce\n\n1. Open it\n\nExpected\nThe right copy.\n\nActual:\nThe wrong copy.\n\nContext\nPage URL: https://x.test";
    const out = normalizeSectionLabels(md);
    expect(out).toContain("**Steps to reproduce**");
    expect(out).toContain("**Expected**");
    expect(out).toContain("**Actual**");
    expect(out).toContain("**Context**");
    expect(promoteSectionHeadings(out)).toContain("### Steps to reproduce");
  });

  it("leaves sentences and bold lead-ins alone", () => {
    const md = "Expected the full name to show.\n**Expected** the full name is visible\nThe context menu is broken.";
    expect(normalizeSectionLabels(md)).toBe(md);
  });

  it("keeps an already-bold label as it is", () => {
    expect(normalizeSectionLabels("**Steps to reproduce**")).toBe("**Steps to reproduce**");
  });
});

describe("replay link", () => {
  it("adds one line linking the brief page, only when there is a replay", () => {
    expect(withReplayLink("Body.\n\n", "https://app.test/b/abc")).toBe(
      "Body.\n\n**Replay:** [Watch the minute before the report](https://app.test/b/abc)",
    );
    expect(withReplayLink("Body.", undefined)).toBe("Body.");
  });
});
