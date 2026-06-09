import { describe, it, expect } from "vitest";
import { markdownToAdf } from "./jira";

describe("markdownToAdf", () => {
  it("produces a valid doc envelope", () => {
    const doc = markdownToAdf("Hello world");
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(Array.isArray(doc.content)).toBe(true);
  });

  it("splits blank-line-separated blocks into paragraphs", () => {
    const doc = markdownToAdf("First para.\n\nSecond para.");
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "First para." }],
    });
    expect(doc.content![1].content![0].text).toBe("Second para.");
  });

  it("collapses extra blank lines and trims whitespace", () => {
    const doc = markdownToAdf("\n\n  A  \n\n\n\n  B  \n\n");
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0].content![0].text).toBe("A");
    expect(doc.content![1].content![0].text).toBe("B");
  });

  it("renders a standalone image line as a text note, not media", () => {
    const doc = markdownToAdf("![screenshot](https://uploads.example.com/x.png)");
    expect(doc.content).toHaveLength(1);
    const p = doc.content![0];
    expect(p.type).toBe("paragraph");
    expect(p.content![0].type).toBe("text");
    expect(p.content![0].text).toContain("[image: screenshot]");
    expect(p.content![0].text).toContain("Attachments");
    // No media node should appear.
    expect(JSON.stringify(doc)).not.toContain('"type":"media"');
  });

  it("inlines an image reference within mixed text as a note", () => {
    const doc = markdownToAdf("See this ![bug](http://x/y.png) here.");
    expect(doc.content).toHaveLength(1);
    expect(doc.content![0].content![0].text).toBe("See this [image: bug] here.");
  });

  it("handles multiple stacked image lines in one block", () => {
    const doc = markdownToAdf("![a](u1)\n![b](u2)");
    // Single block (no blank line), both images become note paragraphs.
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0].content![0].text).toContain("[image: a]");
    expect(doc.content![1].content![0].text).toContain("[image: b]");
  });

  it("never produces an empty content array", () => {
    const doc = markdownToAdf("");
    expect(doc.content!.length).toBeGreaterThan(0);
    const doc2 = markdownToAdf("   \n\n   ");
    expect(doc2.content!.length).toBeGreaterThan(0);
  });

  it("uses a fallback alt when image alt text is empty", () => {
    const doc = markdownToAdf("![](http://x/y.png)");
    expect(doc.content![0].content![0].text).toContain("[image: image]");
  });
});
