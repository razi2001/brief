import { describe, expect, it } from "vitest";
import { parseAssistantStream, splitTicketMd, stripPartialClose } from "./chat-stream";

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
