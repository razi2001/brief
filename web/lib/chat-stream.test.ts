import { describe, expect, it } from "vitest";
import {
  applyEdit,
  applyEdits,
  parseAssistantStream,
  splitTicketMd,
  stripPartialClose,
} from "./chat-stream";

const FULL =
  "<note>Tightened it up.</note>\n<ticket>\n# Checkout 500 on WELCOME10\n\nApplying the coupon fails.\n\n## Steps\n\n1. Apply `WELCOME10`\n</ticket>";

describe("stripPartialClose", () => {
  it("removes a partial closing tag at the end", () => {
    expect(stripPartialClose("body text\n</tick")).toBe("body text\n");
    expect(stripPartialClose("body text\n<")).toBe("body text\n");
  });
  it("leaves complete text alone", () => {
    expect(stripPartialClose("body text")).toBe("body text");
    // A COMPLETE close tag is the caller's job to split on - not stripped here.
    expect(stripPartialClose("body</ticket>")).toBe("body</ticket>");
  });
});

describe("splitTicketMd", () => {
  it("splits the # title from the body", () => {
    expect(splitTicketMd("# Title here\n\nBody line.")).toEqual({
      title: "Title here",
      body: "Body line.",
    });
  });
  it("handles a missing title", () => {
    expect(splitTicketMd("Just a body.")).toEqual({ title: null, body: "Just a body." });
  });
});

describe("parseAssistantStream", () => {
  it("parses a complete reply with a ticket", () => {
    const p = parseAssistantStream(FULL);
    expect(p.note).toBe("Tightened it up.");
    expect(p.ticketComplete).toBe(true);
    expect(p.ticket?.title).toBe("Checkout 500 on WELCOME10");
    expect(p.ticket?.body).toContain("## Steps");
    expect(p.ticket?.body).not.toContain("</ticket>");
  });

  it("parses a note-only reply (question turn)", () => {
    const p = parseAssistantStream("<note>It already covers that in Steps.</note>");
    expect(p.note).toBe("It already covers that in Steps.");
    expect(p.ticket).toBeNull();
  });

  it("shows the note while it is still streaming", () => {
    expect(parseAssistantStream("<note>Working on").note).toBe("Working on");
  });

  it("hides a partial closing </note> tag mid-stream", () => {
    expect(parseAssistantStream("<note>Done.</no").note).toBe("Done.");
  });

  it("parses targeted edits (completed blocks only)", () => {
    const s =
      "<note>Two tweaks.</note>\n" +
      "<edit><find>old line</find><replace>new line</replace></edit>\n" +
      "<edit><find>gone</find><replace></replace></edit>\n" +
      "<edit><find>still stream";
    const p = parseAssistantStream(s);
    expect(p.edits).toEqual([
      { find: "old line", replace: "new line" },
      { find: "gone", replace: "" },
    ]);
    expect(p.ticket).toBeNull();
  });

  it("parses a title-only change", () => {
    const p = parseAssistantStream("<note>Renamed.</note><title>Sharper title</title>");
    expect(p.title).toBe("Sharper title");
    expect(p.edits).toEqual([]);
  });

  it("hides a partial <edit>/<title> opener at the end of a streaming note", () => {
    expect(parseAssistantStream("<note>Done. <ed").note).toBe("Done.");
    expect(parseAssistantStream("<note>Done. <tit").note).toBe("Done.");
  });

  it("keeps multi-line find/replace content intact", () => {
    const s =
      "<note>ok</note><edit><find>\n## Steps\n\n1. one\n</find><replace>\n## Steps to reproduce\n\n1. one\n2. two\n</replace></edit>";
    const p = parseAssistantStream(s);
    expect(p.edits[0].find).toBe("## Steps\n\n1. one");
    expect(p.edits[0].replace).toBe("## Steps to reproduce\n\n1. one\n2. two");
  });

  it("streams the ticket body incrementally without partial close tags", () => {
    // Simulate every prefix of the full stream - no prefix may ever leak a
    // tag fragment into the doc body.
    for (let i = 1; i <= FULL.length; i++) {
      const p = parseAssistantStream(FULL.slice(0, i));
      if (p.ticket) {
        expect(p.ticket.body).not.toMatch(/<\/?tick/);
        expect(p.note).toBe("Tightened it up.");
      }
    }
    // And the final prefix parses identically to the one-shot parse.
    const last = parseAssistantStream(FULL);
    expect(last.ticket?.body.endsWith("`WELCOME10`")).toBe(true);
  });
});

describe("applyEdit / applyEdits", () => {
  const DOC = "Intro line.\n\n## Steps\n\n1. one\n2. two\n\n## Expected\n\nIt works.";

  it("replaces the first exact match", () => {
    const r = applyEdit(DOC, { find: "## Expected\n\nIt works.", replace: "## Expected\n\nThe discount applies." });
    expect(r.ok).toBe(true);
    expect(r.md).toContain("The discount applies.");
    expect(r.md).toContain("## Steps");
  });

  it("falls back to the trimmed needle", () => {
    const r = applyEdit(DOC, { find: "  Intro line.  ", replace: "Better intro." });
    expect(r.ok).toBe(true);
    expect(r.md.startsWith("Better intro.")).toBe(true);
  });

  it("deletes when replace is empty", () => {
    const r = applyEdit(DOC, { find: "\n2. two", replace: "" });
    expect(r.ok).toBe(true);
    expect(r.md).not.toContain("2. two");
  });

  it("reports an unmatched find without altering the doc", () => {
    const r = applyEdit(DOC, { find: "not in the doc", replace: "x" });
    expect(r.ok).toBe(false);
    expect(r.md).toBe(DOC);
  });

  it("applies a sequence and counts failures", () => {
    const r = applyEdits(DOC, [
      { find: "1. one", replace: "1. Add an item" },
      { find: "missing", replace: "x" },
      { find: "It works.", replace: "Order completes." },
    ]);
    expect(r.applied).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.md).toContain("1. Add an item");
    expect(r.md).toContain("Order completes.");
  });
});
