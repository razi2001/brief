import { describe, expect, it } from "vitest";
import {
  describeRepo,
  evidenceExtension,
  evidenceFileName,
  evidenceIndexes,
  evidenceKind,
  evidenceLabel,
  hasEvidenceHeading,
  isPubliclyFetchable,
  joinBlocks,
  placeEvidence,
  promoteSectionHeadings,
  splitAtEvidenceEnd,
  technicalLogsFile,
  withDetailsFolds,
} from "@/lib/ticket-body";
import { mdToHtml } from "@/lib/md-html";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Every line that reads as an Evidence heading or label, whatever its form. */
const EVIDENCE_LINES = /^(#{1,6}[ \t]*evidence[ \t]*:?|\*\*evidence:?\*\*)[ \t]*$/gim;

describe("hasEvidenceHeading", () => {
  it("matches an Evidence heading at levels one to four, with or without a colon", () => {
    for (const md of ["# Evidence", "## Evidence", "### evidence", "#### EVIDENCE", "## Evidence:", "### Evidence :", "## Evidence  "]) {
      expect(hasEvidenceHeading(`Intro\n\n${md}\n\nx`), md).toBe(true);
    }
  });

  // A trailing colon is how the agent often writes a label, and missing it
  // gave tickets a second Evidence heading under the agent's own.
  it("matches a whole-line bold Evidence label, with or without a colon", () => {
    for (const md of ["**Evidence**", "**Evidence:**", "**evidence**", "  **Evidence**  "]) {
      expect(hasEvidenceHeading(`Intro\n\n${md}\n\nx`), md).toBe(true);
    }
  });

  // mdToHtml renders a heading only for one to four "#" at the very start of
  // the line, then whitespace. Taking anything else for the agent's heading
  // would suppress ours over a line that shows up as a plain paragraph.
  it("does not match a line mdToHtml renders as a paragraph", () => {
    for (const md of ["##Evidence", "  ## Evidence", "\t## Evidence", "##### Evidence", "###### Evidence"]) {
      expect(hasEvidenceHeading(md), md).toBe(false);
      expect(mdToHtml(md), md).not.toMatch(/<h\d>/);
    }
    for (const md of ["## Evidence", "#### Evidence:"]) {
      expect(mdToHtml(md), md).toMatch(/^<h\d>/);
    }
  });

  it("does not match a line that merely mentions evidence", () => {
    for (const md of ["See the evidence below", "## Evidence gathered", "## The evidence", "**Evidence** of a crash", "- **Evidence**", "Evidence"]) {
      expect(hasEvidenceHeading(md), md).toBe(false);
    }
  });

  it("ignores a heading inside a fenced code block", () => {
    expect(hasEvidenceHeading("```\n## Evidence\n```")).toBe(false);
    expect(hasEvidenceHeading("~~~md\n## Evidence\n~~~")).toBe(false);
    // A fence indented under a list item is still a fence.
    expect(hasEvidenceHeading("- step\n  ```\n# Evidence\n  ```")).toBe(false);
    // A "~~~" line inside a backtick block does not close it.
    expect(hasEvidenceHeading("```\n~~~\n## Evidence\n```")).toBe(false);
    // After the block closes, a real heading counts again.
    expect(hasEvidenceHeading("```\ncode\n```\n\n## Evidence")).toBe(true);
  });

  it("is false for an empty or missing body", () => {
    expect(hasEvidenceHeading("")).toBe(false);
    expect(hasEvidenceHeading(undefined as unknown as string)).toBe(false);
  });
});

describe("placeEvidence", () => {
  const EV = "Caption\n\n![Screenshot 1](https://b.test/a.png)";

  it("appends a new Evidence section when the body has none", () => {
    expect(placeEvidence("Saving fails.", EV)).toBe(`Saving fails.\n\n## Evidence\n\n${EV}`);
  });

  it("gives an empty body just the Evidence section", () => {
    expect(placeEvidence("", EV)).toBe(`## Evidence\n\n${EV}`);
    expect(placeEvidence("  \n", EV)).toBe(`## Evidence\n\n${EV}`);
  });

  it("drops trailing whitespace before the new section", () => {
    expect(placeEvidence("Saving fails.\n\n\n", EV)).toBe(`Saving fails.\n\n## Evidence\n\n${EV}`);
  });

  it("leaves the body alone when there is no evidence to place", () => {
    expect(placeEvidence("Saving fails.\n", "")).toBe("Saving fails.\n");
    expect(placeEvidence("Saving fails.", "  \n")).toBe("Saving fails.");
  });

  it("puts the evidence at the end of the agent's Evidence section when it is the last one", () => {
    expect(placeEvidence("Intro\n\n## Evidence\n\nThe toast.", EV)).toBe(
      `Intro\n\n## Evidence\n\nThe toast.\n\n${EV}`,
    );
  });

  // Appending after the whole body put the screenshots under whatever section
  // the agent happened to write after its Evidence section.
  it("puts the evidence before the next section when Evidence is not the last one", () => {
    const out = placeEvidence("Intro\n\n## Evidence\n\nThe toast.\n\n## Environment\n\nChrome 141", EV);
    expect(out).toBe(`Intro\n\n## Evidence\n\nThe toast.\n\n${EV}\n\n## Environment\n\nChrome 141`);
  });

  it("ends the section at a heading of a higher level too", () => {
    const out = placeEvidence("## Evidence\n\nThe toast.\n\n# Appendix\n\nx", EV);
    expect(out).toBe(`## Evidence\n\nThe toast.\n\n${EV}\n\n# Appendix\n\nx`);
  });

  it("keeps a deeper heading inside the Evidence section", () => {
    const out = placeEvidence("## Evidence\n\n### Detail\n\nd\n\n## Next\n\nn", EV);
    expect(out).toBe(`## Evidence\n\n### Detail\n\nd\n\n${EV}\n\n## Next\n\nn`);
  });

  it("ends the section at a bold section label, at any depth", () => {
    const out = placeEvidence("## Evidence\n\nThe toast.\n\n**Environment**\n\nChrome 141", EV);
    expect(out).toBe(`## Evidence\n\nThe toast.\n\n${EV}\n\n**Environment**\n\nChrome 141`);
  });

  it("does not end the section at a bold lead-in or a bold sentence", () => {
    const md = "## Evidence\n\n**Note** the toast is red.\n\n**The toast is red.**";
    expect(placeEvidence(md, EV)).toBe(`${md}\n\n${EV}`);
  });

  it("reuses a heading written with a colon instead of adding a second one", () => {
    for (const heading of ["## Evidence:", "**Evidence:**", "**Evidence**", "### Evidence"]) {
      const out = placeEvidence(`Intro\n\n${heading}\n\nThe toast.\n\n## Environment\n\nChrome 141`, EV);
      expect(count(out, EVIDENCE_LINES), heading).toBe(1);
      expect(out.indexOf("The toast."), heading).toBeLessThan(out.indexOf(EV));
      expect(out.indexOf(EV), heading).toBeLessThan(out.indexOf("## Environment"));
    }
  });

  // A bold label stands for the "###" promoteSectionHeadings makes of it, so
  // the section ends at the same place whether the body was promoted or not.
  it("treats a bold Evidence label as the level-3 heading it becomes", () => {
    const raw = "**Evidence**\n\nThe toast.\n\n#### Detail\n\nd\n\n### Next\n\nn";
    const out = placeEvidence(raw, EV);
    expect(out).toBe(`**Evidence**\n\nThe toast.\n\n#### Detail\n\nd\n\n${EV}\n\n### Next\n\nn`);
    expect(placeEvidence(promoteSectionHeadings(raw), EV)).toBe(promoteSectionHeadings(out));
  });

  // A line that is not a heading where the ticket is rendered must not stand
  // in for one: the screenshots would end up under no heading at all.
  it("adds its own heading when the agent's line would not render as one", () => {
    for (const line of ["##Evidence", "  ## Evidence", "##### Evidence"]) {
      const out = placeEvidence(`Broken.\n\n${line}`, EV);
      expect(out, line).toBe(`Broken.\n\n${line}\n\n## Evidence\n\n${EV}`);
    }
  });

  it("ignores headings inside code blocks, both as the Evidence heading and as a section end", () => {
    const md = [
      "Steps:",
      "",
      "```bash",
      "# Evidence",
      "npm run dev",
      "```",
      "",
      "## Evidence",
      "",
      "Toast after Save.",
      "",
      "```text",
      "# not a section",
      "## not one either",
      "```",
      "",
      "## Environment",
      "",
      "Chrome 141",
    ].join("\n");
    const out = placeEvidence(md, EV);
    expect(count(out, /^## Evidence$/gm)).toBe(1);
    expect(out.indexOf(EV)).toBeGreaterThan(out.indexOf("## not one either"));
    expect(out.indexOf(EV)).toBeLessThan(out.indexOf("## Environment"));
    expect(out).toContain("```bash\n# Evidence\nnpm run dev\n```");
  });

  it("appends a new section when the only Evidence heading is inside a code block", () => {
    const out = placeEvidence("```\n## Evidence\n```", EV);
    expect(out).toBe(`\`\`\`\n## Evidence\n\`\`\`\n\n## Evidence\n\n${EV}`);
  });

  it("fills the first Evidence section when the agent wrote two", () => {
    const out = placeEvidence("## Evidence\n\na\n\n## Notes\n\n## Evidence\n\nb", EV);
    expect(out).toBe(`## Evidence\n\na\n\n${EV}\n\n## Notes\n\n## Evidence\n\nb`);
  });

  // Asana flattens every heading level to h1/h2, so a deeper heading after
  // Evidence reads as the next section there.
  it("can end the section at the next heading of any level", () => {
    const md = "## Evidence\n\nThe toast.\n\n### Notes\n\nn";
    expect(placeEvidence(md, EV)).toBe(`${md}\n\n${EV}`);
    expect(placeEvidence(md, EV, { endAtAnyHeading: true })).toBe(
      `## Evidence\n\nThe toast.\n\n${EV}\n\n### Notes\n\nn`,
    );
    expect(placeEvidence("## Evidence\n\nx\n\n##### Deep\n\ny", EV, { endAtAnyHeading: true })).toBe(
      `## Evidence\n\nx\n\n${EV}\n\n##### Deep\n\ny`,
    );
  });
});

describe("splitAtEvidenceEnd", () => {
  it("splits at the line that starts the next section", () => {
    expect(splitAtEvidenceEnd("Intro\n\n## Evidence\n\nThe dialog.\n\n## Notes\n\nMore.")).toEqual({
      head: "Intro\n\n## Evidence\n\nThe dialog.\n",
      tail: "## Notes\n\nMore.",
    });
  });

  it("keeps the whole body as the head when Evidence is the last section", () => {
    expect(splitAtEvidenceEnd("## Evidence:\n\nx")).toEqual({ head: "## Evidence:\n\nx", tail: "" });
    expect(splitAtEvidenceEnd("**Evidence**\n\nx")).toEqual({ head: "**Evidence**\n\nx", tail: "" });
  });

  it("is null when the body has no Evidence heading", () => {
    expect(splitAtEvidenceEnd("No evidence heading here")).toBeNull();
    expect(splitAtEvidenceEnd("```\n## Evidence\n```")).toBeNull();
    expect(splitAtEvidenceEnd("")).toBeNull();
  });
});

describe("promoteSectionHeadings", () => {
  it("turns a whole-line bold label into a heading", () => {
    expect(promoteSectionHeadings("**Steps to reproduce**\n1. Open")).toBe("### Steps to reproduce\n1. Open");
    expect(promoteSectionHeadings("  **Evidence:**  ")).toBe("### Evidence:");
  });

  it("leaves a bold lead-in, a bold sentence and a long bold line alone", () => {
    for (const line of [
      "**Expected** the full name is visible",
      "**The page crashed.**",
      `**${"x".repeat(61)}**`,
      "- **Screenshot 1**",
      "****",
    ]) {
      expect(promoteSectionHeadings(line), line).toBe(line);
    }
  });

  it("tolerates a missing body", () => {
    expect(promoteSectionHeadings(undefined as unknown as string)).toBe("");
  });
});

describe("isPubliclyFetchable", () => {
  it("accepts a public origin and rejects one only this machine or network can reach", () => {
    expect(isPubliclyFetchable("https://cloud.get-brief.app/api/evidence/x/y.png")).toBe(true);
    expect(isPubliclyFetchable("http://172.32.0.1/x.png")).toBe(true);
    for (const url of ["http://localhost:3100/x.png", "http://app.localhost/x.png", "http://172.31.0.1/x.png", "http://[::1]:3000/x.png", "nope"]) {
      expect(isPubliclyFetchable(url), url).toBe(false);
    }
  });
});

describe("withDetailsFolds", () => {
  it("folds each non-empty section under its own title, after the body", () => {
    const out = withDetailsFolds("Body\n\n", [
      { title: "Video 1 logs", markdown: "GET /a 500\n" },
      { title: "Video 2 logs", markdown: "  " },
    ]);
    expect(out).toBe("Body\n\n<details>\n<summary>Video 1 logs</summary>\n\nGET /a 500\n\n</details>");
  });

  it("returns the body untouched when there is nothing to fold", () => {
    expect(withDetailsFolds("Body\n", undefined)).toBe("Body\n");
    expect(withDetailsFolds("Body\n", [{ title: "t", markdown: "" }])).toBe("Body\n");
  });
});

describe("joinBlocks", () => {
  it("puts one blank line between the blocks that have something in them", () => {
    expect(joinBlocks("a", "", "  \n", "b")).toBe("a\n\nb");
    expect(joinBlocks()).toBe("");
  });
});

describe("evidence files", () => {
  it("tells a screenshot from a recording by its media type", () => {
    expect(evidenceKind("image/png")).toBe("image");
    expect(evidenceKind(" IMAGE/JPEG; q=1")).toBe("image");
    expect(evidenceKind("video/webm;codecs=vp9")).toBe("recording");
    // Nothing else is ever attached, so anything that is not an image is a recording.
    expect(evidenceKind("application/octet-stream")).toBe("recording");
  });

  it("keeps an extension the file still opens with", () => {
    expect(evidenceExtension("image/png")).toBe("png");
    expect(evidenceExtension("image/jpeg")).toBe("jpg");
    expect(evidenceExtension("image/jpg")).toBe("jpg");
    expect(evidenceExtension("video/webm;codecs=vp9")).toBe("webm");
    expect(evidenceExtension("video/quicktime")).toBe("mov");
    expect(evidenceExtension("image/avif")).toBe("avif");
    // A subtype that is no extension is never made into one.
    expect(evidenceExtension("application/octet-stream")).toBe("bin");
    expect(evidenceExtension("image/svg+xml")).toBe("bin");
    expect(evidenceExtension("")).toBe("bin");
  });

  it("numbers screenshots, and a recording only when there is more than one", () => {
    expect(evidenceLabel("image/png", 2)).toBe("Screenshot 2");
    expect(evidenceLabel("video/webm", 1)).toBe("Screen recording");
    expect(evidenceLabel("video/mp4", 2)).toBe("Screen recording 2");
  });

  // The upload name shows up in the ticket, so it must not say how the
  // report was captured.
  it("names files by what they are, never by where they came from", () => {
    expect(evidenceFileName("image/png", 1)).toBe("screenshot-1.png");
    expect(evidenceFileName("image/jpeg", 2)).toBe("screenshot-2.jpg");
    expect(evidenceFileName("video/webm;codecs=vp9", 1)).toBe("screen-recording.webm");
    expect(evidenceFileName("video/mp4", 2)).toBe("screen-recording-2.mp4");
  });

  it("counts screenshots and recordings apart", () => {
    expect(
      evidenceIndexes([
        { contentType: "image/png" },
        { contentType: "video/webm" },
        { contentType: "image/jpeg" },
        { contentType: "video/mp4" },
      ]),
    ).toEqual([1, 1, 2, 2]);
    expect(evidenceIndexes([])).toEqual([]);
  });
});

describe("technicalLogsFile", () => {
  it("joins one section per video under its own title, as a Markdown file", () => {
    const file = technicalLogsFile([
      { title: "Video 1 logs", markdown: "GET /api/save 500\n" },
      { title: "Video 2 logs", markdown: "   " },
      { title: "Video 3 logs", markdown: "console: TypeError" },
    ]);
    expect(file?.filename).toBe("technical-logs.md");
    expect(file?.contentType).toBe("text/markdown");
    expect(file?.bytes.toString("utf8")).toBe(
      "## Video 1 logs\n\nGET /api/save 500\n\n## Video 3 logs\n\nconsole: TypeError\n",
    );
  });

  it("is null when no section has anything in it", () => {
    expect(technicalLogsFile([{ title: "Video 1 logs", markdown: "  \n" }])).toBeNull();
    expect(technicalLogsFile([])).toBeNull();
    expect(technicalLogsFile(undefined)).toBeNull();
  });
});

describe("describeRepo", () => {
  it("joins what the forge knows about a repo, homepage first after the description", () => {
    expect(
      describeRepo({ description: " Web app ", homepage: "https://x.test", topics: ["a", "b"], language: "Go" }),
    ).toBe("Web app. Serves: https://x.test. Topics: a, b. Language: Go");
    expect(describeRepo({ description: "  " })).toBeUndefined();
  });
});
