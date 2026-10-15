import { describe, expect, it } from "vitest";
import { mdToHtml } from "@/lib/md-html";

describe("mdToHtml escaping", () => {
  // The rendered body is set as innerHTML on the public /b/<shareId> page, so a
  // quote in a link URL must not be able to close the href and add attributes.
  it("keeps a quote in a link URL inside the href", () => {
    const html = mdToHtml('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"\s*onmouseover=/);
    expect(html).toContain('href="https://a.com/&quot;onmouseover=&quot;alert(1"');
  });

  it("escapes quotes and apostrophes in text", () => {
    expect(mdToHtml(`He said "hi" and it's fine`)).toContain("He said &quot;hi&quot; and it&#39;s fine");
  });

  it("still renders links, bold and code", () => {
    const html = mdToHtml("See [the docs](https://example.com/a?b=1&c=2), **bold**, `code`");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });
});
