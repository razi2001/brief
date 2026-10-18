import { describe, expect, it } from "vitest";
import { agentReportMarkdown } from "./agent-report";

const base = {
  title: "Pay button spins forever",
  evidence: [],
} as const;

describe("agentReportMarkdown", () => {
  it("gives a written draft as the report, with its facts and evidence", () => {
    const md = agentReportMarkdown({
      ...base,
      state: "written",
      body: "**Summary**\nPaying never finishes.\n\n**Steps**\n1. Open checkout",
      page: { url: "https://shop.test/checkout", title: "Checkout" },
      reported: "Oct 17, 2026",
      evidence: [
        { kind: "screenshot", url: "https://app.test/api/evidence/s/screenshots/a.png", caption: "the spinner\nnever stops" },
        { kind: "screenshot", url: "https://app.test/api/evidence/s/screenshots/b.png" },
        { kind: "recording", url: "https://app.test/api/evidence/s/recording.webm" },
      ],
    });
    expect(md.startsWith("# Pay button spins forever\n")).toBe(true);
    expect(md).toContain("- Status: Draft, not filed in a tracker");
    expect(md).toContain("- Page: https://shop.test/checkout (Checkout)");
    expect(md).toContain("- Reported: Oct 17, 2026");
    expect(md).toContain("Paying never finishes.");
    expect(md).toContain("- Screenshot 1: https://app.test/api/evidence/s/screenshots/a.png (the spinner never stops)");
    expect(md).toContain("- Screenshot 2: https://app.test/api/evidence/s/screenshots/b.png\n");
    expect(md).toContain("- Screen recording: https://app.test/api/evidence/s/recording.webm");
    expect(md).not.toContain("still being written");
  });

  it("says where a filed ticket lives", () => {
    const md = agentReportMarkdown({
      ...base,
      state: "written",
      body: "Body",
      filed: { tracker: "Linear", identifier: "APP-12", url: "https://linear.app/x/issue/APP-12" },
    });
    expect(md).toContain("- Status: Filed in Linear as APP-12 (https://linear.app/x/issue/APP-12)");
    expect(agentReportMarkdown({ ...base, state: "written", body: "B", filed: { tracker: "Notion" } })).toContain(
      "- Status: Filed in Notion\n",
    );
  });

  it("falls back to the reporter's words while it's written, or when it failed", () => {
    const writing = agentReportMarkdown({ ...base, state: "writing", description: "Clicking Pay does nothing" });
    expect(writing).toContain("still being written");
    expect(writing).toContain("## What the reporter said\n\nClicking Pay does nothing");
    const failed = agentReportMarkdown({ ...base, state: "failed", body: null, description: "" });
    expect(failed).toContain("write-up of this report failed");
    expect(failed).not.toContain("What the reporter said");
  });

  it("shows a filed ticket with no stored write-up as the reporter's words, not as being written", () => {
    const md = agentReportMarkdown({ ...base, state: "written", body: null, filed: { tracker: "Jira", identifier: "BUG-1" }, description: "Login loops" });
    expect(md).not.toContain("still being written");
    expect(md).toContain("## What the reporter said\n\nLogin loops");
  });

  it("never prints an empty title or an empty evidence section", () => {
    const md = agentReportMarkdown({ title: "  ", state: "written", body: "B", evidence: [] });
    expect(md.startsWith("# Bug report\n")).toBe(true);
    expect(md).not.toContain("## Evidence");
    expect(md).toContain("Captured with Brief");
  });
});
