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
  it("lists a screen recording's steps after the page they were on", () => {
    const block = buildContextBlock({
      events: [
        { type: "nav", load: true, tMs: 0, url: "https://app.x/cases/42" },
        { type: "click", tMs: 3200, url: "https://app.x/cases/42", element: { text: "Save" } },
        { type: "key", tMs: 4100, url: "https://app.x/cases/42", key: "Enter" },
      ],
    });
    expect(block).toContain("RECORDING TIMELINE (what the reporter did");
    expect(block).toContain('0:00 on https://app.x/cases/42\n0:03 clicked "Save"\n0:04 pressed Enter');
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

describe("buildContextBlock - where it happened", () => {
  const events = [
    { type: "click", tMs: 1000, url: "https://app.x/dashboard", element: { text: "Settings" } },
    { type: "nav", tMs: 1400, url: "https://app.x/settings", title: "Settings - Acme" },
    { type: "click", tMs: 6000, url: "https://app.x/settings", element: { text: "Save" } },
    { type: "nav", tMs: 9000, url: "https://app.x/projects", title: "Projects - Acme" },
  ];

  it("lists every page a recording went through, and says the first is only where it started", () => {
    const block = buildContextBlock({ pageUrl: "https://app.x/dashboard", pageTitle: "Dashboard - Acme", events, recordingMarks: [{ t: 7000 }] });
    expect(block).toContain("PAGES (the capture went through several pages");
    expect(block).toContain("often NOT the first page");
    expect(block).toContain("- 0:00 Dashboard - Acme (https://app.x/dashboard) - the recording started here");
    expect(block).toContain("- 0:01 Settings - Acme (https://app.x/settings)\n");
    expect(block).toContain("- 0:09 Projects - Acme (https://app.x/projects) - the recording ended here");
    expect(block).toContain("The reporter marked the problem on: Settings - Acme (https://app.x/settings)");
    expect(block).not.toContain("PAGE (where this happened");
  });

  it("keeps the single-page block when the capture stayed on one page", () => {
    const block = buildContextBlock({ pageUrl: "https://app.x/settings", pageTitle: "Settings", events: events.slice(2, 3) });
    expect(block).toContain("PAGE (where this happened - link it in the ticket's Context):\n- Page URL: https://app.x/settings\n- Page title: Settings");
    expect(block).not.toContain("PAGES (");
  });

  it("an uploaded video has no known page and no event log of ours", () => {
    const block = buildContextBlock({ pageUrl: "https://app.x/dashboard", recording: { source: "upload" }, events });
    expect(block).toContain("PAGE: not known");
    expect(block).not.toContain("https://app.x/dashboard");
    expect(block).not.toContain("RECORDING TIMELINE");
  });

  it("lines up what the reporter said with the pages and clicks", () => {
    const block = buildContextBlock({
      pageUrl: "https://app.x/dashboard",
      transcript: "I go to settings, I click save, see it is still the old name",
      narrationTimed: [{ t: 500, text: "I go to settings." }, { t: 7200, text: "See, it is still the old name." }],
      events,
    });
    expect(block).toMatch(/RECORDING TIMELINE \(the screen recording moment by moment[^]*A "says" line is the reporter's voice/);
    const at = (s: string) => block.indexOf(s);
    expect(at('0:01 says: "I go to settings."')).toBeGreaterThan(-1);
    expect(at('0:06 clicked "Save"')).toBeLessThan(at('0:07 says: "See, it is still the old name."'));
    expect(at('0:07 says: "See')).toBeLessThan(at("0:09 now on Projects - Acme"));
  });
});

describe("buildContextBlock - the reporter's spoken words", () => {
  it("with nothing typed, what they say is the report", () => {
    const block = buildContextBlock({ transcript: "the total should be 120 but it shows 100" });
    expect(block).toContain("WHAT THE REPORTER SAYS (while recording the screen, transcribed audio - they typed nothing, so this is the report");
    expect(block).not.toContain("SPOKEN NARRATION");
  });

  it("with a description, the narration fleshes it out and still counts", () => {
    const block = buildContextBlock({ description: "Wrong total", transcript: "it should be 120" });
    expect(block).toContain("SPOKEN NARRATION (while recording the screen, transcribed audio - said while showing it");
    expect(block.indexOf("REPORTER'S DESCRIPTION")).toBeLessThan(block.indexOf("SPOKEN NARRATION"));
  });

  it("a replay voice-over is the report too when nothing was typed", () => {
    const block = buildContextBlock({ replay: { steps: [], narration: "nothing happens when I click pay" } });
    expect(block).toContain("WHAT THE REPORTER SAYS (their voice-over on the replay");
    const typed = buildContextBlock({ description: "Pay", replay: { steps: [], narration: "nothing happens" } });
    expect(typed).toContain("REPLAY NARRATION (their voice-over on the replay");
  });
});
