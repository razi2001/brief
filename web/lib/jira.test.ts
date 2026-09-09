import { describe, it, expect } from "vitest";
import { markdownToAdf, buildSearchJql, mapJiraSearchIssue, normalizeJiraPriority, type AdfNode } from "./jira";

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

// ---------------------------------------------------------------------------
// pickTransition - choosing the workflow transition that reaches a wanted status
// ---------------------------------------------------------------------------
import { pickTransition } from "./jira";

describe("pickTransition", () => {
  const transitions = [
    { id: "11", name: "Start work", to: { name: "In Progress" } },
    { id: "21", name: "Send to triage", to: { name: "Triage" } },
    { id: "31", name: "Done", to: { name: "Done" } },
  ];

  it("matches the destination status name, case-insensitively", () => {
    expect(pickTransition("triage", transitions)?.id).toBe("21");
    expect(pickTransition("IN PROGRESS", transitions)?.id).toBe("11");
  });

  it("falls back to the transition name itself", () => {
    expect(pickTransition("send to triage", transitions)?.id).toBe("21");
  });

  it("supports fuzzy (prefix/substring) matching on the destination", () => {
    expect(pickTransition("progress", transitions)?.id).toBe("11");
  });

  it("returns undefined when nothing matches", () => {
    expect(pickTransition("Blocked", transitions)).toBeUndefined();
  });
});

describe("buildSearchJql", () => {
  it("builds a text search over summary and description, newest first", () => {
    expect(buildSearchJql("checkout coupon 500")).toBe(
      '(summary ~ "checkout coupon 500" OR description ~ "checkout coupon 500") ORDER BY updated DESC',
    );
  });

  it("strips quotes and backslashes to keep the JQL valid", () => {
    expect(buildSearchJql('a "b" \\c')).toBe(
      '(summary ~ "a b c" OR description ~ "a b c") ORDER BY updated DESC',
    );
  });

  it("falls back to a bare order-by when the query is empty", () => {
    expect(buildSearchJql("   ")).toBe("ORDER BY updated DESC");
  });

  it("strips Lucene operator characters that would 400 the text search", () => {
    expect(buildSearchJql("checkout (coupon) 500?")).toBe(
      '(summary ~ "checkout coupon 500" OR description ~ "checkout coupon 500") ORDER BY updated DESC',
    );
  });
});

describe("mapJiraSearchIssue", () => {
  it("maps a Jira issue to an enriched search result", () => {
    const result = mapJiraSearchIssue(
      {
        key: "PAY-42",
        fields: {
          summary: "Coupon validation 500s",
          status: { name: "In Progress" },
          assignee: { displayName: "Jane Doe" },
          labels: ["area/billing", "type/bug"],
          priority: { name: "High" },
          project: { name: "Payments" },
          issuetype: { name: "Bug" },
        },
      },
      "https://acme.atlassian.net",
    );
    expect(result).toEqual({
      identifier: "PAY-42",
      title: "Coupon validation 500s",
      url: "https://acme.atlassian.net/browse/PAY-42",
      target: "Payments",
      state: "In Progress",
      labels: ["area/billing", "type/bug"],
      assignee: "Jane Doe",
      priority: "high",
      issueType: "Bug",
    });
  });

  it("tolerates missing fields", () => {
    const result = mapJiraSearchIssue({ key: "X-1", fields: {} }, "https://s.atlassian.net");
    expect(result.identifier).toBe("X-1");
    expect(result.title).toBe("");
    expect(result.target).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.state).toBeUndefined();
  });

  it("tolerates a completely absent fields property", () => {
    const result = mapJiraSearchIssue({ key: "Y-9" }, "https://s.atlassian.net");
    expect(result.identifier).toBe("Y-9");
    expect(result.title).toBe("");
    expect(result.labels).toEqual([]);
  });
});

describe("normalizeJiraPriority", () => {
  it("maps Jira priority names to our vocabulary", () => {
    expect(normalizeJiraPriority("Highest")).toBe("urgent");
    expect(normalizeJiraPriority("High")).toBe("high");
    expect(normalizeJiraPriority("Medium")).toBe("medium");
    expect(normalizeJiraPriority("Low")).toBe("low");
    expect(normalizeJiraPriority("Lowest")).toBe("low");
    expect(normalizeJiraPriority(undefined)).toBeUndefined();
  });
});

describe("markdownToAdf horizontal rule", () => {
  it("renders --- as an ADF rule, not a literal paragraph", () => {
    const doc = markdownToAdf("Summary.\n\n---\n\nReported with Brief");
    expect(types(doc)).toEqual(["doc", "paragraph", "text", "rule", "paragraph", "text"]);
    expect(JSON.stringify(doc)).not.toContain("---");
  });

  it("does not mistake a bullet or a setext-looking line for a rule", () => {
    expect(types(markdownToAdf("- one"))).toContain("bulletList");
    expect(types(markdownToAdf("- one"))).not.toContain("rule");
  });
});
