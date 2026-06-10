import { describe, it, expect } from "vitest";
import { markdownToAdf, type AdfNode } from "./jira";

const types = (n: AdfNode): string[] => [n.type, ...(n.content ?? []).flatMap(types)];

describe("markdownToAdf", () => {
  it("produces a valid doc envelope", () => {
    const doc = markdownToAdf("hello world");
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
    expect(doc.content?.[0]?.type).toBe("paragraph");
  });

  it("renders **bold** as a strong text node, not literal asterisks", () => {
    const doc = markdownToAdf("this is **important** text");
    const para = doc.content![0];
    const strong = para.content!.find((n) => n.marks?.some((m) => m.type === "strong"));
    expect(strong?.text).toBe("important");
    // no literal ** survives
    expect(JSON.stringify(doc)).not.toContain("**");
  });

  it("turns a whole-line **Section** into a heading", () => {
    const doc = markdownToAdf("**Steps to reproduce**");
    const h = doc.content![0];
    expect(h.type).toBe("heading");
    expect(h.attrs?.level).toBe(3);
    expect(h.content![0].text).toBe("Steps to reproduce");
  });

  it("parses ## markdown headings with their level", () => {
    const doc = markdownToAdf("## Evidence");
    expect(doc.content![0].type).toBe("heading");
    expect(doc.content![0].attrs?.level).toBe(2);
  });

  it("builds an ordered list from numbered lines", () => {
    const doc = markdownToAdf("1. Open the page\n2. Click Save");
    const list = doc.content![0];
    expect(list.type).toBe("orderedList");
    expect(list.content).toHaveLength(2);
    expect(types(list)).toContain("listItem");
    expect(list.content![0].content![0].content![0].text).toBe("Open the page");
  });

  it("builds a bullet list from - lines", () => {
    const doc = markdownToAdf("- one\n- two\n- three");
    const list = doc.content![0];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(3);
  });

  it("emits a codeBlock for fenced code with verbatim content", () => {
    const doc = markdownToAdf("**Console Error**\n\n```\nPATCH /api 504\n```");
    const code = doc.content!.find((n) => n.type === "codeBlock");
    expect(code).toBeTruthy();
    expect(code!.content![0].text).toBe("PATCH /api 504");
  });

  it("renders inline `code` with a code mark", () => {
    const doc = markdownToAdf("the key should be `KAN-2`");
    const codeNode = doc.content![0].content!.find((n) => n.marks?.some((m) => m.type === "code"));
    expect(codeNode?.text).toBe("KAN-2");
  });

  it("renders an image as a link (Jira attaches the file separately)", () => {
    const doc = markdownToAdf("![Screenshot 1](https://x/y.png)");
    const node = doc.content![0].content![0];
    expect(node.marks?.[0]?.type).toBe("link");
    expect(node.marks?.[0]?.attrs?.href).toBe("https://x/y.png");
    expect(node.text).toBe("Screenshot 1");
  });

  it("never emits an empty doc", () => {
    const doc = markdownToAdf("");
    expect(doc.content?.length).toBeGreaterThan(0);
  });

  it("handles a full ticket body: heading + paragraph + steps + expected/actual", () => {
    const md = [
      "The list shows the wrong key.",
      "",
      "**Steps to reproduce**",
      "",
      "1. Open the list",
      "2. Look at the key",
      "",
      "**Expected**",
      "It shows `KAN-2`.",
    ].join("\n");
    const doc = markdownToAdf(md);
    const kinds = doc.content!.map((n) => n.type);
    expect(kinds).toContain("paragraph");
    expect(kinds).toContain("heading");
    expect(kinds).toContain("orderedList");
    expect(JSON.stringify(doc)).not.toContain("**");
  });
});
