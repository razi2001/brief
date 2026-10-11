import { describe, it, expect } from "vitest";
import { buildContextBlock } from "./context-block";

describe("buildContextBlock - network errors", () => {
  it("formats a failed fetch as 'METHOD url → status reason', not a JSON blob", () => {
    const block = buildContextBlock({
      events: [
        { type: "network-error", tMs: 1200, method: "GET", url: "https://api.example.com/users/42", status: 404, reason: "Not Found" },
      ],
    });
    expect(block).toContain("GET https://api.example.com/users/42 → 404 Not Found");
    expect(block).not.toContain("network-error");
    expect(block).not.toContain("tMs");
  });

  it("shows only the reason for a transport failure (status 0)", () => {
    const block = buildContextBlock({
      events: [
        { type: "network-error", method: "POST", url: "https://api.example.com/save", status: 0, reason: "network error" },
      ],
    });
    expect(block).toContain("POST https://api.example.com/save network error");
    expect(block).not.toContain("→ 0");
  });

  it("still surfaces console-error / js-error verbatim", () => {
    const block = buildContextBlock({
      events: [
        { type: "console-error", args: ["Uncaught TypeError: x is not a function"] },
        { type: "js-error", message: "ReferenceError: foo is not defined" },
      ],
    });
    expect(block).toContain("Uncaught TypeError: x is not a function");
    expect(block).toContain("ReferenceError: foo is not defined");
  });

  it("de-dupes repeated identical network failures", () => {
    const ev = { type: "network-error", method: "GET", url: "https://api.example.com/ping", status: 500, reason: "Internal Server Error" };
    const block = buildContextBlock({ events: [ev, { ...ev }, { ...ev }] });
    const occurrences = block.split("GET https://api.example.com/ping").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("buildContextBlock - reporter description (primary signal)", () => {
  it("surfaces the typed description first, as the primary signal", () => {
    const block = buildContextBlock({
      description: "The Save button does nothing when I click it",
      pageUrl: "https://app.example.com/settings",
      transcript: "uh the save thing is broke",
      events: [{ type: "console-error", args: ["TypeError: save is not a function"] }],
    });
    expect(block).toContain("REPORTER'S DESCRIPTION");
    expect(block).toContain("The Save button does nothing when I click it");
    // primary signal leads; narration and supporting errors come after it
    expect(block.indexOf("REPORTER'S DESCRIPTION")).toBeLessThan(block.indexOf("SPOKEN NARRATION"));
    expect(block.indexOf("SPOKEN NARRATION")).toBeLessThan(block.indexOf("SUPPORTING TECHNICAL CONTEXT"));
  });

  it("omits the description block when there is no typed description", () => {
    const block = buildContextBlock({ pageUrl: "https://example.com" });
    expect(block).not.toContain("REPORTER'S DESCRIPTION");
  });
});

describe("buildContextBlock - errors demoted to supporting context", () => {
  it("labels console/network errors as supporting context, not the headline", () => {
    const block = buildContextBlock({
      events: [{ type: "console-error", args: ["Boom"] }],
    });
    expect(block).toContain("SUPPORTING TECHNICAL CONTEXT");
    expect(block).not.toContain("CONSOLE / RUNTIME ERRORS");
  });
});

describe("buildContextBlock - narration", () => {
  it("surfaces the transcript under a 'transcribed audio' label and includes the text", () => {
    const block = buildContextBlock({ transcript: "the save button does nothing" });
    expect(block).toContain("transcribed audio");
    expect(block).toContain("the save button does nothing");
    expect(block).not.toContain("rough draft");
  });

  it("omits the narration block when there is no transcript", () => {
    const block = buildContextBlock({ pageUrl: "https://example.com" });
    expect(block).not.toContain("SPOKEN NARRATION");
  });
});

describe("buildContextBlock - screenshots", () => {
  it("surfaces screenshot captions as a labeled block", () => {
    const block = buildContextBlock({
      screenshots: [
        { file: "screenshots/a.png", description: "Total ignores the promo code" },
        { file: "screenshots/b.png", description: "" },
        { file: "screenshots/c.png", description: "Error toast on submit" },
      ],
    });
    expect(block).toContain("SCREENSHOTS");
    expect(block).toContain("Total ignores the promo code");
    expect(block).toContain("Error toast on submit");
  });

  it("omits the screenshots block when no caption has text", () => {
    const block = buildContextBlock({ screenshots: [{ file: "x.png", description: "" }] });
    expect(block).not.toContain("SCREENSHOTS");
  });
});

describe("buildContextBlock: key moments", () => {
  it("lists the reporter's marks in the recording and the replay", () => {
    const out = buildContextBlock({
      recordingMarks: [{ t: 12000, note: "button does nothing" }],
      replay: { steps: ["0:00 Opened https://x.test/"], marks: [{ t: 4000, note: "" }] },
    });
    expect(out).toContain("KEY MOMENTS");
    expect(out).toContain("- 0:12 into the recording: button does nothing");
    expect(out).toContain("- 0:04 into the replay");
  });
});

describe("one-click reports", () => {
  const replay = {
    steps: ["Opened Checkout", "Clicked Pay"],
    marks: [
      { t: 4200, note: "POST /api/orders failed (500)", auto: true },
      { t: 9000, note: "the total is wrong" },
    ],
  };

  it("lists what Brief noticed as SUSPECTS, apart from the reporter's own marks", () => {
    const block = buildContextBlock({ replay });
    expect(block).toContain("SUSPECTS");
    expect(block).toContain("0:04 into the replay: POST /api/orders failed (500)");
    expect(block).toMatch(/KEY MOMENTS[^]*0:09 into the replay: the total is wrong/);
    expect(block.split("POST /api/orders failed").length - 1).toBe(1);
  });

  it("tells the agent to find the bug, and never invent one, when nothing was typed", () => {
    const block = buildContextBlock({ autoReport: true, replay });
    expect(block).toContain("ONE-CLICK REPORT");
    expect(block).toMatch(/do NOT invent a bug/);
  });

  it("a typed description wins: no one-click instruction then", () => {
    const block = buildContextBlock({ autoReport: true, description: "Pay button does nothing", replay });
    expect(block).not.toContain("ONE-CLICK REPORT");
  });
});

describe("buildContextBlock - what only the raw json had", () => {
  it("lists a screen recording's steps, each click with the page it was on", () => {
    const block = buildContextBlock({
      events: [
        { type: "nav", load: true, tMs: 0, url: "https://app.x/cases/42" },
        { type: "click", tMs: 3200, url: "https://app.x/cases/42", element: { text: "Save" } },
        { type: "key", tMs: 4100, url: "https://app.x/cases/42", key: "Enter" },
      ],
    });
    expect(block).toContain("RECORDING STEPS");
    expect(block).toContain("- 0:00 Opened app.x/cases/42");
    expect(block).toContain('- 0:03 Clicked "Save" (on https://app.x/cases/42)');
    expect(block).toContain("- 0:04 Pressed Enter (on https://app.x/cases/42)");
  });

  it("shows the reporter's own title", () => {
    expect(buildContextBlock({ name: "Checkout broken" })).toContain("REPORTER'S TITLE (their working title for the report):\nCheckout broken");
  });

  it("a one-click report puts the explaining suspect in Technical notes, and says plainly when nothing showed up", () => {
    const block = buildContextBlock({ autoReport: true });
    expect(block).toContain("goes in Technical notes");
    expect(block).toContain("no error showed up");
    expect(block).not.toMatch(/captured\b/);
  });

  it("a replay says its asterisks are typed text hidden for privacy, not the app", () => {
    const block = buildContextBlock({ replay: { steps: ["0:01 Typed into \"Email\""], frames: [], marks: [] } });
    expect(block).toMatch(/asterisks/);
    expect(block).toMatch(/privacy/);
  });
});
