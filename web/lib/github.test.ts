import { describe, expect, it } from "vitest";
import { buildGithubBody, issueRef, parseIssueRef, parseRepo } from "@/lib/github";
import {
  describeRepo,
  hasEvidenceHeading,
  isPubliclyFetchable,
  promoteSectionHeadings,
} from "@/lib/ticket-body";
import { matchPriorityLabel } from "@/lib/tracker";

describe("parseIssueRef", () => {
  // An issue number is only unique within a repository, so Brief's identifier
  // has to carry the repo or a live sync can't tell APP#1 from WEB#1.
  it("reads the fully qualified owner/repo#number form", () => {
    expect(parseIssueRef("acme/web-app#42")).toEqual({
      owner: "acme",
      repo: "web-app",
      number: 42,
    });
  });

  it("rejects a bare number, which cannot address an issue", () => {
    expect(parseIssueRef("#42")).toBeNull();
    expect(parseIssueRef("42")).toBeNull();
    expect(parseIssueRef("acme/web-app")).toBeNull();
    expect(parseIssueRef("")).toBeNull();
  });

  it("round-trips with issueRef", () => {
    expect(parseIssueRef(issueRef("acme", "web-app", 7))).toEqual({
      owner: "acme",
      repo: "web-app",
      number: 7,
    });
  });
});

describe("parseRepo", () => {
  it("splits a target id", () => {
    expect(parseRepo("acme/web-app")).toEqual({ owner: "acme", repo: "web-app" });
  });

  it("rejects anything that isn't exactly owner/repo", () => {
    expect(parseRepo("acme")).toBeNull();
    expect(parseRepo("acme/web/app")).toBeNull();
  });
});

describe("matchPriorityLabel", () => {
  // GitHub has no priority field, so priority is only expressible through a
  // label the repo ALREADY has - inventing one would pollute the repo.
  it("adopts the repo's own priority convention", () => {
    expect(matchPriorityLabel("high", ["bug", "priority: high", "docs"])).toBe("priority: high");
    expect(matchPriorityLabel("urgent", ["P0", "P1", "P2"])).toBe("P0");
    expect(matchPriorityLabel("low", ["prio-low", "enhancement"])).toBe("prio-low");
  });

  it("prefers a real priority label over a topic label containing the word", () => {
    expect(matchPriorityLabel("high", ["high-contrast-ui", "priority: high"])).toBe(
      "priority: high",
    );
  });

  it("returns undefined when the repo has no matching label", () => {
    // Better no priority than a label that means something else to the team.
    expect(matchPriorityLabel("high", ["bug", "docs"])).toBeUndefined();
    expect(matchPriorityLabel("urgent", [])).toBeUndefined();
  });
});

describe("buildGithubBody", () => {
  const shot = (over = {}) => ({
    filename: "a.png",
    contentType: "image/png",
    url: "https://brief.test/api/evidence/s1/screenshots/a.png",
    ...over,
  });

  it("embeds images inline by URL, with the agent's caption above each", () => {
    const md = buildGithubBody("The save button does nothing.", [
      shot({ caption: "The cart shows zero items" }),
    ]);
    expect(md).toContain("## Evidence");
    expect(md).toContain(
      "The cart shows zero items\n\n![Screenshot 1](https://brief.test/api/evidence/s1/screenshots/a.png)",
    );
  });

  // The agent is told not to write its own Evidence section, but it sometimes
  // does anyway - and appending a second one produced a ticket with the heading
  // twice and the caption repeated under it.
  it("reuses the agent's own Evidence heading instead of adding a second", () => {
    const written = [
      "Something broke.",
      "",
      "## Evidence",
      "",
      "- The Plan section shows the badge clipped.",
    ].join("\n");
    const md = buildGithubBody(written, [shot()]);
    expect(md.match(/## Evidence/g)).toHaveLength(1);
    // The image still lands, under that heading.
    expect(md).toContain("![Screenshot 1](");
    expect(md.indexOf("## Evidence")).toBeLessThan(md.indexOf("![Screenshot 1]("));
  });

  // Appending after the whole body put the screenshots under whatever section
  // the agent wrote after its Evidence section.
  it("puts the images inside the agent's Evidence section, not under a later one", () => {
    const md = buildGithubBody("Broken.\n\n## Evidence:\n\nThe toast.\n\n## Environment\n\nChrome 141", [shot()]);
    // "Evidence:" is the agent's heading too, so no second one is added.
    expect(md.match(/^#+ evidence/gim)).toHaveLength(1);
    expect(md.indexOf("The toast.")).toBeLessThan(md.indexOf("![Screenshot 1]("));
    expect(md.indexOf("![Screenshot 1](")).toBeLessThan(md.indexOf("## Environment"));
  });

  it("matches an Evidence heading at any level, and none that merely mentions it", () => {
    expect(hasEvidenceHeading("### Evidence")).toBe(true);
    expect(hasEvidenceHeading("# evidence")).toBe(true);
    expect(hasEvidenceHeading("See the evidence below")).toBe(false);
    expect(hasEvidenceHeading("## Evidence gathered")).toBe(false);
  });

  it("links a recording rather than embedding it, and never by file name", () => {
    // GitHub renders a player only for files on its own CDN, so an external
    // recording can only be a link - and the ticket must not leak the file
    // name, which would say how the report was captured.
    const md = buildGithubBody("x", [
      shot({ filename: "recording.webm", contentType: "video/webm", url: "https://brief.test/r.webm" }),
    ]);
    expect(md).toContain("[Watch the screen recording](https://brief.test/r.webm)");
    expect(md).not.toContain("recording.webm");
    expect(md).not.toContain("![");
  });

  it("skips a file with no hosted URL instead of emitting a link that would 404", () => {
    // Keyframes are deleted right after filing, so they have no stable URL.
    expect(buildGithubBody("body", [{ filename: "kf.png", contentType: "image/png" }])).toBe("body");
  });

  // GitHub fetches every image server-side, so a localhost URL renders broken
  // forever. A clean ticket beats one carrying a permanently broken image.
  it("does not embed URLs GitHub could never fetch", () => {
    const md = buildGithubBody("body", [
      shot({ url: "http://localhost:3100/api/evidence/s1/screenshots/a.png" }),
    ]);
    expect(md).toBe("body");
    expect(md).not.toContain("## Evidence");
  });

  it("leaves the body untouched when there is nothing to show", () => {
    expect(buildGithubBody("just text", [])).toBe("just text");
  });

  it("numbers screenshots in order", () => {
    const md = buildGithubBody("x", [
      shot({ url: "https://b.test/a.png" }),
      shot({ url: "https://b.test/b.png" }),
    ]);
    expect(md).toContain("![Screenshot 1](https://b.test/a.png)");
    expect(md).toContain("![Screenshot 2](https://b.test/b.png)");
  });
});

describe("isPubliclyFetchable", () => {
  it("accepts a real public origin", () => {
    expect(isPubliclyFetchable("https://cloud.get-brief.app/api/evidence/x/y.png")).toBe(true);
  });

  it("rejects everything only reachable from this machine or network", () => {
    for (const url of [
      "http://localhost:3100/x.png",
      "http://127.0.0.1:3000/x.png",
      "http://0.0.0.0/x.png",
      "http://10.1.2.3/x.png",
      "http://192.168.1.10/x.png",
      "http://172.16.0.5/x.png",
      "http://169.254.1.1/x.png",
      "not a url",
    ]) {
      expect(isPubliclyFetchable(url), url).toBe(false);
    }
  });

  it("does not mistake a public host for a private one", () => {
    // 172.32.x is outside the RFC1918 range, and the name merely contains "10.".
    expect(isPubliclyFetchable("http://172.32.0.1/x.png")).toBe(true);
    expect(isPubliclyFetchable("https://v10.example.com/x.png")).toBe(true);
  });
});

describe("describeRepo", () => {
  // A bare repo name can't distinguish "brief-marketing-website" from
  // "brief-cloud" for a bug in the app - the homepage is what maps the page a
  // reporter was on to the repo that ships it.
  it("leads with the homepage, which is the routing signal that matters", () => {
    expect(
      describeRepo({ description: "The Brief web app", homepage: "https://cloud.get-brief.app" }),
    ).toBe("The Brief web app. Serves: https://cloud.get-brief.app");
  });

  it("includes topics and language when there is no description", () => {
    expect(describeRepo({ topics: ["marketing", "astro"], language: "TypeScript" })).toBe(
      "Topics: marketing, astro. Language: TypeScript",
    );
  });

  it("returns undefined when GitHub told us nothing", () => {
    expect(describeRepo({})).toBeUndefined();
    expect(describeRepo({ description: "  ", homepage: "" })).toBeUndefined();
  });

  it("caps topics so one busy repo can't flood the target list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const out = describeRepo({ topics: many })!;
    expect(out).toContain("t7");
    expect(out).not.toContain("t8");
  });
});

describe("promoteSectionHeadings", () => {
  // The agent writes section labels as "**Steps to reproduce**", which Jira and
  // Notion already turn into headings. GitHub rendered them as bold paragraphs,
  // leaving the issue with no outline and nothing to anchor to.
  it("turns a whole-line label into a heading", () => {
    expect(promoteSectionHeadings("**Steps to reproduce**")).toBe("### Steps to reproduce");
    expect(promoteSectionHeadings("**Expected**")).toBe("### Expected");
  });

  it("leaves a bold lead-in to a sentence alone", () => {
    // Promoting this would push its own text onto the next line.
    const line = "**Expected** The full subscription name is visible in the badge.";
    expect(promoteSectionHeadings(line)).toBe(line);
  });

  it("leaves a fully bolded sentence alone", () => {
    const line = "**This whole thing is emphasis, not a section label.**";
    expect(promoteSectionHeadings(line)).toBe(line);
  });

  it("ignores bold that is too long to be a label", () => {
    const long = `**${"a".repeat(80)}**`;
    expect(promoteSectionHeadings(long)).toBe(long);
  });

  it("promotes each label in a full body and leaves everything else untouched", () => {
    const body = [
      "The save button does nothing.",
      "",
      "**Steps to reproduce**",
      "",
      "1. Open the cart",
      "",
      "**Actual** Nothing happens.",
    ].join("\n");
    expect(promoteSectionHeadings(body)).toBe(
      [
        "The save button does nothing.",
        "",
        "### Steps to reproduce",
        "",
        "1. Open the cart",
        "",
        "**Actual** Nothing happens.",
      ].join("\n"),
    );
  });

  it("survives empty input", () => {
    expect(promoteSectionHeadings("")).toBe("");
  });
});
