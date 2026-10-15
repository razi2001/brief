// @vitest-environment jsdom
// (for DOMParser: the well-formedness check parses the output as real XML)
import { describe, expect, it } from "vitest";
import { ASANA_TAGS, asanaHtml, asanaImage, asanaPlainText } from "@/lib/asana-html";
import { withBriefAttribution } from "@/lib/tracker";

// Everything the agent (and the adapter) can put in a ticket body at once.
const KITCHEN_SINK = [
  "# Checkout total is wrong",
  "",
  "The total shows **$0.00** after a *coupon* is applied & the page `reloads`.",
  "Tom said \"it's <broken>\".",
  "",
  "**Steps to reproduce**",
  "",
  "1. Open [the cart](https://shop.example.com/cart?a=1&b=2)",
  "2. Apply coupon `SAVE10`",
  "   - only on Safari",
  "3. Reload",
  "",
  "### Expected",
  "",
  "- The discounted total",
  "* ~~free shipping~~",
  "",
  "> Reported twice this week",
  "",
  "| Field | Value |",
  "|---|---|",
  "| total | 0.00 |",
  "",
  "```js",
  "if (a < b && c > d) console.log(\"x\");",
  "```",
  "",
  "See https://shop.example.com/help, or [ftp](ftp://example.com).",
  "![shot](https://example.com/a.png)",
  "",
  "## Evidence",
  "",
  "The total right after reload",
  asanaImage("1203456789"),
  "",
  "___",
  "",
  "<details><summary>raw html</summary></details>",
].join("\n");

const allowed = new Set<string>(ASANA_TAGS);

function tagNames(html: string): string[] {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase());
}

/** True when every tag closes in order (a self-closing tag counts as closed). */
function balanced(html: string): boolean {
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) return false;
  }
  return stack.length === 0;
}

/** Parse as XML, the way Asana's API does. */
function parsesAsXml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, "application/xml");
  return doc.getElementsByTagName("parsererror").length === 0 && doc.documentElement.nodeName === "body";
}

describe("asanaHtml output is something Asana accepts", () => {
  // Asana answers 400 to any tag outside its rich-text set, which would lose
  // the whole description. Every tag the converter can emit must be on it.
  it("only ever emits Asana's rich-text tags", () => {
    const html = asanaHtml(withBriefAttribution(KITCHEN_SINK));
    const tags = tagNames(html);
    expect(tags.length).toBeGreaterThan(10);
    expect(tags.filter((t) => !allowed.has(t))).toEqual([]);
  });

  it("is well-formed XML wrapped in <body>", () => {
    // The checks themselves must be able to fail.
    expect(balanced("<body><em></body>")).toBe(false);
    expect(parsesAsXml("<body>a & b</body>")).toBe(false);

    const html = asanaHtml(withBriefAttribution(KITCHEN_SINK));
    expect(html.startsWith("<body>")).toBe(true);
    expect(html.endsWith("</body>")).toBe(true);
    expect(balanced(html)).toBe(true);
    expect(parsesAsXml(html)).toBe(true);
  });

  it("stays well-formed for empty and hostile input", () => {
    for (const md of ["", "   ", "**", "<", "a & b", "`unclosed", "```\nnever closed", "[x](javascript:alert(1))", "\u0000\u0007ctl"]) {
      const html = asanaHtml(md);
      expect(balanced(html), md).toBe(true);
      expect(parsesAsXml(html), md).toBe(true);
    }
  });

  it("never emits a paragraph element, and keeps the blank line between paragraphs", () => {
    const html = asanaHtml("First paragraph.\n\nSecond paragraph.\nSame paragraph, next line.");
    expect(html).toBe("<body>First paragraph.\n\nSecond paragraph.\nSame paragraph, next line.</body>");
  });

  it("pads no block with newlines, whatever blank lines surround it", () => {
    expect(asanaHtml("Intro\n\n## Steps\n\nOpen it\n\n---\n\nEnd")).toBe(
      "<body>Intro<h2>Steps</h2>Open it<hr/>End</body>",
    );
  });

  it("turns lone surrogates into U+FFFD and drops characters XML forbids", () => {
    // Built from char codes so the source file itself stays plain ASCII.
    const lone = String.fromCharCode(0xd83d);
    const nonchars = String.fromCharCode(0xfffe, 0xffff);
    const html = asanaHtml(`half ${lone} emoji, nonchar ${nonchars}, bell ${String.fromCharCode(7)}.`);
    expect(html).toBe(`<body>half ${String.fromCharCode(0xfffd)} emoji, nonchar , bell .</body>`);
    expect(parsesAsXml(html)).toBe(true);
  });
});

describe("asanaHtml headings", () => {
  it("maps # to h1 and ## to h2", () => {
    expect(asanaHtml("# Title\n\n## Section")).toBe("<body><h1>Title</h1><h2>Section</h2></body>");
  });

  // Asana has no h3, so deeper headings keep their structure as h2.
  it("flattens ### and deeper to h2", () => {
    expect(asanaHtml("### Expected\n#### Actual")).toBe("<body><h2>Expected</h2><h2>Actual</h2></body>");
  });

  it("promotes a whole-line bold label to h2, like the GitHub adapter", () => {
    expect(asanaHtml("**Steps to reproduce**\n1. Open it")).toBe(
      "<body><h2>Steps to reproduce</h2><ol><li>Open it</li></ol></body>",
    );
  });

  it("leaves a bold lead-in to a sentence inline", () => {
    expect(asanaHtml("**Expected** the full name is visible")).toBe(
      "<body><strong>Expected</strong> the full name is visible</body>",
    );
  });

  it("keeps heading text plain", () => {
    expect(asanaHtml("## The `save` button **fails**")).toBe("<body><h2>The save button fails</h2></body>");
  });

  it("drops italics markers in headings too", () => {
    expect(asanaHtml("## The *save* _button_ in user_settings")).toBe(
      "<body><h2>The save button in user_settings</h2></body>",
    );
  });
});

describe("asanaHtml lists", () => {
  it("renders ordered and unordered lists", () => {
    expect(asanaHtml("1. one\n2. two\n\n- a\n* b")).toBe(
      "<body><ol><li>one</li><li>two</li></ol><ul><li>a</li><li>b</li></ul></body>",
    );
  });

  it("nests an indented list inside its item", () => {
    expect(asanaHtml("1. Open the cart\n   - on Safari\n2. Reload")).toBe(
      "<body><ol><li>Open the cart<ul><li>on Safari</li></ul></li><li>Reload</li></ol></body>",
    );
  });

  it("keeps a loose list (blank lines between items) as one list", () => {
    expect(asanaHtml("1. one\n\n2. two")).toBe("<body><ol><li>one</li><li>two</li></ol></body>");
  });

  it("joins a wrapped line onto its item", () => {
    expect(asanaHtml("- a long item\n  that wraps")).toBe("<body><ul><li>a long item that wraps</li></ul></body>");
  });

  it("reads --- as a rule, not a list item", () => {
    expect(asanaHtml("above\n\n---\n\nbelow")).toBe("<body>above<hr/>below</body>");
  });
});

describe("asanaHtml code", () => {
  it("turns a fenced block into an escaped <pre>", () => {
    expect(asanaHtml("```ts\nif (a < b && c) {\n  go();\n}\n```")).toBe(
      "<body><pre>if (a &lt; b &amp;&amp; c) {\n  go();\n}</pre></body>",
    );
  });

  it("renders inline code, bold, italics and strikethrough", () => {
    expect(asanaHtml("Run `npm test` **now**, *please*, not ~~later~~")).toBe(
      "<body>Run <code>npm test</code> <strong>now</strong>, <em>please</em>, not <s>later</s></body>",
    );
  });

  it("does not read snake_case as italics", () => {
    expect(asanaHtml("the user_id_field is empty")).toBe("<body>the user_id_field is empty</body>");
  });
});

describe("asanaHtml links", () => {
  it("links http(s) and escapes the URL", () => {
    expect(asanaHtml("[the cart](https://shop.example.com/cart?a=1&b=2)")).toBe(
      '<body><a href="https://shop.example.com/cart?a=1&amp;b=2">the cart</a></body>',
    );
  });

  it("keeps only the text of a non-http link", () => {
    expect(asanaHtml("[click](javascript:alert(1)) and [mail](mailto:a@b.co)")).toBe(
      "<body>click and mail</body>",
    );
  });

  it("links a bare URL without its trailing punctuation", () => {
    expect(asanaHtml("See https://example.com/a.")).toBe(
      '<body>See <a href="https://example.com/a">https://example.com/a</a>.</body>',
    );
  });

  it("keeps a balanced paren in a bare URL, and leaves the prose's paren outside", () => {
    expect(asanaHtml("See https://en.wikipedia.org/wiki/Foo_(bar).")).toBe(
      '<body>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">https://en.wikipedia.org/wiki/Foo_(bar)</a>.</body>',
    );
    expect(asanaHtml("(see https://example.com/a)")).toBe(
      '<body>(see <a href="https://example.com/a">https://example.com/a</a>)</body>',
    );
  });

  it("never nests a link inside a link", () => {
    const html = asanaHtml("[see https://a.example](https://b.example)");
    expect(html).toBe('<body><a href="https://b.example">see https://a.example</a></body>');
  });
});

describe("asanaHtml tables", () => {
  it("keeps a GFM table as its raw text in <pre>", () => {
    expect(asanaHtml("| Field | Value |\n|---|---|\n| a&b | <1> |")).toBe(
      "<body><pre>| Field | Value |\n|---|---|\n| a&amp;b | &lt;1&gt; |</pre></body>",
    );
  });
});

describe("asanaHtml escaping", () => {
  it("escapes & < > and quotes in text", () => {
    expect(asanaHtml('Tom & Jerry said "<hi>"')).toBe("<body>Tom &amp; Jerry said &quot;&lt;hi&gt;&quot;</body>");
  });

  it("renders raw HTML in the markdown as text, never as tags", () => {
    expect(asanaHtml("<details><summary>x</summary></details>")).toBe(
      "<body>&lt;details&gt;&lt;summary&gt;x&lt;/summary&gt;&lt;/details&gt;</body>",
    );
  });
});

describe("asanaHtml images", () => {
  // An image is a block in Asana's rich text: no newline around it.
  it("embeds a task attachment by gid as a block, caption directly above", () => {
    expect(asanaHtml(`The error toast\n${asanaImage("1203456789")}\n\nThe next one`)).toBe(
      '<body>The error toast<img data-asana-gid="1203456789"/>The next one</body>',
    );
  });

  it("does not let anything but digits into the gid attribute", () => {
    const html = asanaHtml('![](asana-attachment:1" onerror="x)');
    expect(html).not.toContain("<img");
    expect(parsesAsXml(html)).toBe(true);
  });

  it("turns an external image into a link, since Asana only inlines its own attachments", () => {
    expect(asanaHtml("![shot](https://example.com/a.png)")).toBe(
      '<body><a href="https://example.com/a.png">shot</a></body>',
    );
  });
});

describe("asanaHtml attribution", () => {
  it("renders the attribution under a rule, linked", () => {
    expect(asanaHtml(withBriefAttribution("Body"))).toBe(
      '<body>Body<hr/>Reported with <a href="https://cloud.get-brief.app/">Brief</a></body>',
    );
  });
});

describe("asanaPlainText (the fallback when rich text is refused)", () => {
  it("leaves no markdown markers for the reader to squint past", () => {
    const md = withBriefAttribution(
      [
        "Saving fails.",
        "",
        "**Steps to reproduce**",
        "1. Open [settings](https://app.example.com/settings)",
        "2. Click **Save**, *twice*",
        "",
        "### Expected",
        "> The name is saved",
        "",
        "```",
        "POST /api/save **500**",
        "```",
        asanaImage("1203456789"),
      ].join("\n"),
    );
    expect(asanaPlainText(md)).toBe(
      [
        "Saving fails.",
        "",
        "Steps to reproduce",
        "1. Open settings (https://app.example.com/settings)",
        "2. Click Save, twice",
        "",
        "Expected",
        "The name is saved",
        "",
        // Code is kept exactly as written.
        "POST /api/save **500**",
        "",
        "Reported with Brief (https://cloud.get-brief.app/)",
      ].join("\n"),
    );
  });
});
