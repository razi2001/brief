import { describe, it, expect } from "vitest";
import { BRIEF_ATTRIBUTION, BRIEF_SITE_URL, BRIEF_URL, resolveName, withBriefAttribution } from "./tracker";

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

describe("withBriefAttribution", () => {
  it("appends the attribution under a divider at the very end", () => {
    expect(withBriefAttribution("The save button does nothing.")).toBe(
      "The save button does nothing.\n\n---\n\nReported with [Brief](https://get-brief.app/?utm_source=ticket)",
    );
  });

  it("links Brief to the site, tagged so those visits can be counted", () => {
    expect(BRIEF_SITE_URL).toBe("https://get-brief.app/?utm_source=ticket");
    expect(BRIEF_ATTRIBUTION).toBe(`Reported with [Brief](${BRIEF_SITE_URL})`);
    // Evidence links still fall back to the app.
    expect(BRIEF_URL).toBe("https://cloud.get-brief.app/");
  });

  it("sits below the Evidence section, not above it", () => {
    const body = withBriefAttribution("Summary.\n\n## Evidence\n\n![Screenshot 1](https://x/y.png)");
    expect(body.indexOf("## Evidence")).toBeLessThan(body.indexOf(BRIEF_ATTRIBUTION));
    expect(body.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("adds it once, even if the body already ends with it", () => {
    const once = withBriefAttribution("Summary.");
    expect(withBriefAttribution(once)).toBe(once);
  });

  it("trims trailing whitespace so the divider never floats", () => {
    expect(withBriefAttribution("Summary.\n\n\n")).toBe(
      `Summary.\n\n---\n\n${BRIEF_ATTRIBUTION}`,
    );
  });

  it("still attributes an empty body", () => {
    expect(withBriefAttribution("")).toBe(BRIEF_ATTRIBUTION);
    expect(withBriefAttribution("   ")).toBe(BRIEF_ATTRIBUTION);
  });
});
