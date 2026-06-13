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
