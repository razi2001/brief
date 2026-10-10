import { describe, it, expect } from "vitest";
import { withGithubDetails } from "./github";
import { withLinearDetails } from "./linear";
import { jiraDescription } from "./jira";
import { withBriefAttribution } from "./tracker";

const details = [
  { title: "Technical logs: Screen recording", markdown: "**Timeline**\n\n```text\n0:01  GET  api/a  200  12 ms\n```" },
  { title: "Technical logs: Replay", markdown: "**Timeline**\n\n```text\n0:03  GET  api/x  200  7.9 s\n```" },
];

describe("the technical logs, one folded section per video, at the bottom", () => {
  it("GitHub: a <details> block per video after the evidence, attribution still last", () => {
    const body = withBriefAttribution(withGithubDetails("It hangs.\n\n## Evidence\n\nimg", details));
    expect(body).toContain("## Evidence\n\nimg\n\n<details>\n<summary>Technical logs: Screen recording</summary>\n\n**Timeline**");
    expect(body.indexOf("<summary>Technical logs: Screen recording</summary>")).toBeLessThan(body.indexOf("<summary>Technical logs: Replay</summary>"));
    expect(body.lastIndexOf("</details>")).toBeLessThan(body.indexOf("Reported with"));
  });

  it("Linear: a +++ collapsible section per video", () => {
    const body = withLinearDetails("It hangs.", details);
    expect(body).toBe(
      "It hangs.\n\n+++ Technical logs: Screen recording\n\n" + details[0].markdown + "\n\n+++\n\n" +
        "+++ Technical logs: Replay\n\n" + details[1].markdown + "\n\n+++",
    );
  });

  it("Jira: an expand per video, before the attribution's divider", () => {
    const doc = jiraDescription("It hangs.", details);
    const nodes = doc.content ?? [];
    const types = nodes.map((n) => n.type);
    expect(types.filter((t) => t === "expand")).toHaveLength(2);
    expect(types.lastIndexOf("rule")).toBeGreaterThan(types.lastIndexOf("expand"));
    const expands = nodes.filter((n) => n.type === "expand");
    expect(expands.map((n) => n.attrs)).toEqual([{ title: "Technical logs: Screen recording" }, { title: "Technical logs: Replay" }]);
    expect((expands[0].content ?? []).some((n) => n.type === "codeBlock")).toBe(true);
  });

  it("nothing captured: no section anywhere", () => {
    expect(withGithubDetails("Body", undefined)).toBe("Body");
    expect(withLinearDetails("Body", [{ title: "x", markdown: "  " }])).toBe("Body");
    expect((jiraDescription("Body").content ?? []).some((n) => n.type === "expand")).toBe(false);
  });
});
