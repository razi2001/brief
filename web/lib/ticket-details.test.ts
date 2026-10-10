import { describe, it, expect } from "vitest";
import { withGithubDetails } from "./github";
import { withLinearDetails } from "./linear";
import { jiraDescription } from "./jira";
import { withBriefAttribution } from "./tracker";

const details = { title: "Technical details", markdown: "**Network**\n\n```text\n0:03  GET  api/x  200  7.9 s\n```" };

describe("the technical details, folded at the bottom", () => {
  it("GitHub: a <details> block after the evidence, attribution still last", () => {
    const body = withBriefAttribution(withGithubDetails("It hangs.\n\n## Evidence\n\nimg", details));
    expect(body).toMatch(/## Evidence\n\nimg\n\n<details>\n<summary>Technical details<\/summary>\n\n\*\*Network\*\*/);
    expect(body.indexOf("</details>")).toBeLessThan(body.indexOf("Reported with"));
  });

  it("Linear: a +++ collapsible section", () => {
    const body = withLinearDetails("It hangs.", details);
    expect(body).toBe("It hangs.\n\n+++ Technical details\n\n" + details.markdown + "\n\n+++");
  });

  it("Jira: an expand node, before the attribution's divider", () => {
    const doc = jiraDescription("It hangs.", details);
    const types = (doc.content ?? []).map((n) => n.type);
    const expand = types.indexOf("expand");
    expect(expand).toBeGreaterThan(-1);
    expect(types.lastIndexOf("rule")).toBeGreaterThan(expand);
    const node = (doc.content ?? [])[expand];
    expect(node.attrs).toEqual({ title: "Technical details" });
    expect((node.content ?? []).some((n) => n.type === "codeBlock")).toBe(true);
  });

  it("nothing captured: no section anywhere", () => {
    expect(withGithubDetails("Body", undefined)).toBe("Body");
    expect(withLinearDetails("Body", { title: "x", markdown: "  " })).toBe("Body");
    expect((jiraDescription("Body").content ?? []).some((n) => n.type === "expand")).toBe(false);
  });
});
