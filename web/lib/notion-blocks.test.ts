import { describe, expect, it } from "vitest";
import {
  BLOCKS_PER_REQUEST,
  CHILDREN_LIMIT,
  RICH_TEXT_LIMIT,
  URL_LIMIT,
  batchBlocks,
  block,
  codeLanguage,
  detailsToggles,
  flattenBlocks,
  isHttpUrl,
  markdownToBlocks,
  parseRichText,
  plainRichText,
  toggleBlock,
  type NotionBlock,
} from "@/lib/notion-blocks";

/** The block type sequence, which is what a reader actually perceives. */
const types = (blocks: NotionBlock[]) => blocks.map((b) => b.type);
const richText = (b: NotionBlock) =>
  ((b[b.type] as { rich_text?: Array<{ text: { content: string } }> }).rich_text ?? [])
    .map((t) => t.text.content)
    .join("");

describe("parseRichText", () => {
  it("marks bold, italic and inline code", () => {
    const rt = parseRichText("a **bold** and *soft* and `code` end");
    expect(rt.map((t) => [t.text.content, t.annotations])).toEqual([
      ["a ", undefined],
      ["bold", { bold: true }],
      [" and ", undefined],
      ["soft", { italic: true }],
      [" and ", undefined],
      ["code", { code: true }],
      [" end", undefined],
    ]);
  });

  it("turns a link into a real Notion link, keeping the label", () => {
    const [node] = parseRichText("[the docs](https://example.com/x)");
    expect(node.text).toEqual({ content: "the docs", link: { url: "https://example.com/x" } });
  });

  // Notion rejects the whole page for one link it can't take, and the agent
  // does write relative links and anchors.
  it("keeps a link Notion would refuse as plain text, label only", () => {
    for (const href of ["/settings/billing", "#steps", "mailto:a@b.test", "tel:+15550100", "localhost:3000/x"]) {
      const rt = parseRichText(`open [billing](${href}) now`);
      expect(rt.map((t) => t.text.content).join("")).toBe("open billing now");
      expect(rt.every((t) => !t.text.link)).toBe(true);
    }
  });

  it("refuses a link longer than Notion's url cap", () => {
    const [node] = parseRichText(`[long](https://x.test/${"a".repeat(URL_LIMIT)})`);
    expect(node.text).toEqual({ content: "long" });
  });
});

describe("isHttpUrl", () => {
  it("is true only for absolute http(s) urls", () => {
    expect(isHttpUrl("https://brief.test/a.png")).toBe(true);
    expect(isHttpUrl("http://brief.test/a.png")).toBe(true);
    expect(isHttpUrl("/a.png")).toBe(false);
    expect(isHttpUrl("ftp://brief.test/a.png")).toBe(false);
    expect(isHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });

  it("splits text over Notion's per-item cap instead of losing it", () => {
    const long = "x".repeat(RICH_TEXT_LIMIT + 500);
    const rt = parseRichText(long);
    expect(rt).toHaveLength(2);
    expect(rt.map((t) => t.text.content).join("")).toBe(long);
    // Every item has to be within the cap or Notion rejects the whole request.
    expect(rt.every((t) => t.text.content.length <= RICH_TEXT_LIMIT)).toBe(true);
  });
});

describe("markdownToBlocks", () => {
  it("renders the ticket shape the agent writes", () => {
    const md = [
      "The save button does nothing on checkout.",
      "",
      "**Steps to reproduce**",
      "",
      "1. Open the cart",
      "2. Press Save",
      "",
      "**Expected**",
      "",
      "- The cart persists",
      "",
      "## Context",
      "",
      "> Reported on production",
      "",
      "```js",
      "throw new Error('boom')",
      "```",
      "",
      "---",
    ].join("\n");

    expect(types(markdownToBlocks(md))).toEqual([
      "paragraph",
      "heading_3",
      "numbered_list_item",
      "numbered_list_item",
      "heading_3",
      "bulleted_list_item",
      "heading_2",
      "quote",
      "code",
      "divider",
    ]);
  });

  it("promotes a whole-bold line to a heading, like the Jira renderer does", () => {
    const [block] = markdownToBlocks("**Steps to reproduce**");
    expect(block.type).toBe("heading_3");
    expect(richText(block)).toBe("Steps to reproduce");
  });

  it("clamps markdown headings deeper than Notion's three levels", () => {
    expect(types(markdownToBlocks("#### Deep\n\n##### Deeper"))).toEqual([
      "heading_3",
      "heading_3",
    ]);
  });

  it("makes a standalone image a real image block, with its caption", () => {
    const [block] = markdownToBlocks("![The cart shows zero items](https://brief.test/e/a.png)");
    expect(block.type).toBe("image");
    expect(block.image).toMatchObject({
      type: "external",
      external: { url: "https://brief.test/e/a.png" },
    });
    const caption = (block.image as { caption: Array<{ text: { content: string } }> }).caption;
    expect(caption.map((c) => c.text.content).join("")).toBe("The cart shows zero items");
  });

  it("keeps an INLINE image as a link, so it doesn't break the paragraph", () => {
    const [block] = markdownToBlocks("see ![shot](https://brief.test/a.png) here");
    expect(block.type).toBe("paragraph");
  });

  it("builds an image block only for an absolute http(s) url, else plain text", () => {
    // An image block Notion can't fetch rejects the whole page.
    const blocks = markdownToBlocks("![The cart](/evidence/a.png)\n\n![The form](data:image/png;base64,AAAA)");
    expect(types(blocks)).toEqual(["paragraph", "paragraph"]);
    expect(blocks.map(richText)).toEqual(["The cart", "The form"]);
    expect(JSON.stringify(blocks)).not.toContain('"link"');
  });

  it("reads task list items as to_do blocks with their checked state", () => {
    const blocks = markdownToBlocks("- [x] done thing\n- [ ] pending thing");
    expect(types(blocks)).toEqual(["to_do", "to_do"]);
    expect((blocks[0].to_do as { checked: boolean }).checked).toBe(true);
    expect((blocks[1].to_do as { checked: boolean }).checked).toBe(false);
  });

  it("joins wrapped plain lines into one paragraph", () => {
    const blocks = markdownToBlocks("first line\nsecond line");
    expect(blocks).toHaveLength(1);
    expect(richText(blocks[0])).toBe("first line second line");
  });

  it("keeps code block content verbatim, fences excluded", () => {
    const [block] = markdownToBlocks("```\nline one\n  line two\n```");
    expect(block.type).toBe("code");
    expect(richText(block)).toBe("line one\n  line two");
  });

  it("survives empty input", () => {
    expect(markdownToBlocks("")).toEqual([]);
  });
});

describe("codeLanguage", () => {
  it("passes through what Notion accepts and maps common shorthands", () => {
    expect(codeLanguage("typescript")).toBe("typescript");
    expect(codeLanguage("ts")).toBe("typescript");
    expect(codeLanguage("JS")).toBe("javascript");
    expect(codeLanguage("yml")).toBe("yaml");
  });

  it("falls back to plain text rather than sending a language Notion rejects", () => {
    expect(codeLanguage("brainfuck")).toBe("plain text");
    expect(codeLanguage(undefined)).toBe("plain text");
  });
});

describe("batchBlocks", () => {
  it("splits into create/append-sized batches", () => {
    const blocks = Array.from({ length: CHILDREN_LIMIT * 2 + 3 }, () => ({
      object: "block" as const,
      type: "paragraph",
      paragraph: { rich_text: [] },
    }));
    const batches = batchBlocks(blocks);
    expect(batches.map((b) => b.length)).toEqual([CHILDREN_LIMIT, CHILDREN_LIMIT, 3]);
  });

  it("returns nothing for an empty body, so no pointless append call is made", () => {
    expect(batchBlocks([])).toEqual([]);
  });

  it("counts the blocks inside toggles toward Notion's 1000-per-request cap", () => {
    // Twelve full toggles are only 12 top-level children but 1212 block
    // elements, which Notion would reject as one request.
    const para = () => block("paragraph", { rich_text: [] });
    const full = () => toggleBlock("logs", Array.from({ length: CHILDREN_LIMIT }, para));
    const batches = batchBlocks(Array.from({ length: 12 }, full));
    expect(batches.map((b) => b.length)).toEqual([9, 3]);
    const weight = (bs: NotionBlock[]) =>
      bs.reduce((n, b) => n + 1 + ((b.toggle as { children: unknown[] }).children.length), 0);
    expect(batches.every((b) => weight(b) <= BLOCKS_PER_REQUEST)).toBe(true);
  });
});

describe("plainRichText", () => {
  it("reads nothing into the text and still respects the per-item cap", () => {
    expect(plainRichText("a **b** [c](https://x.test)")).toEqual([
      { type: "text", text: { content: "a **b** [c](https://x.test)" } },
    ]);
    expect(plainRichText("x".repeat(RICH_TEXT_LIMIT + 1))).toHaveLength(2);
    expect(plainRichText("")).toEqual([]);
  });
});

describe("toggles for the technical logs", () => {
  const details = [
    {
      title: "Technical logs: Screen recording",
      markdown:
        "Times: into the video.\n\n**Timeline** (1 call; in order)\n\n```text\n0:01  GET  api/a  200  12 ms\n```",
    },
  ];

  it("folds each section under its own title, with its markdown as the content", () => {
    const [t] = detailsToggles(details);
    expect(t.type).toBe("toggle");
    const toggle = t.toggle as { rich_text: Array<{ type: string; text: { content: string } }>; children: NotionBlock[] };
    expect(toggle.rich_text).toEqual([{ type: "text", text: { content: "Technical logs: Screen recording" } }]);
    expect(types(toggle.children)).toEqual(["paragraph", "paragraph", "code"]);
    expect(richText(toggle.children[2])).toBe("0:01  GET  api/a  200  12 ms");
    expect((toggle.children[2].code as { language: string }).language).toBe("plain text");
  });

  it("skips a section with nothing in it", () => {
    expect(detailsToggles([{ title: "Technical logs: Replay", markdown: "  \n" }])).toEqual([]);
    expect(detailsToggles(undefined)).toEqual([]);
  });

  it("keeps a toggle's content flat, since Notion takes two levels of nesting per request", () => {
    const nested = block("bulleted_list_item", {
      rich_text: [],
      children: [block("paragraph", { rich_text: [] })],
    });
    const t = toggleBlock("logs", [nested]);
    const kids = (t.toggle as { children: NotionBlock[] }).children;
    expect(types(kids)).toEqual(["bulleted_list_item", "paragraph"]);
    expect(kids.every((k) => !("children" in (k[k.type] as object)))).toBe(true);
  });

  it("caps a toggle at Notion's 100 children per array", () => {
    const many = Array.from({ length: CHILDREN_LIMIT + 20 }, () => block("paragraph", { rich_text: [] }));
    expect((toggleBlock("logs", many).toggle as { children: unknown[] }).children).toHaveLength(CHILDREN_LIMIT);
  });

  it("flattens in reading order and leaves flat blocks alone", () => {
    const flat = [block("paragraph", { rich_text: [] })];
    expect(flattenBlocks(flat)).toEqual(flat);
  });
});
