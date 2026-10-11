import { describe, it, expect } from "vitest";
import { trimEvents, mergeBriefOverrides, captionForScreenshot } from "./overrides";

describe("mergeBriefOverrides", () => {
  it("overlays a non-empty transcript, description, extra, and screenshots", () => {
    const json = { transcript: null, description: "old", events: [{ a: 1 }] };
    const merged = mergeBriefOverrides(json, {
      transcript: "corrected words",
      description: "new",
      extra: [{ key: "env", value: "prod" }],
      screenshots: [{ file: "screenshots/a.png", description: "note", annotated: true }],
    });
    expect(merged.transcript).toBe("corrected words");
    expect(merged.description).toBe("new");
    expect(merged.extra).toEqual([{ key: "env", value: "prod" }]);
    expect(merged.screenshots?.[0].description).toBe("note");
    expect(merged.events).toEqual([{ a: 1 }]); // untouched capture data
  });

  it("ignores absent/blank overrides and does not mutate the input", () => {
    const json = { transcript: "kept", description: "kept" };
    const merged = mergeBriefOverrides(json, { transcript: "   " });
    expect(merged.transcript).toBe("kept");
    expect(merged.description).toBe("kept");
    expect(json).toEqual({ transcript: "kept", description: "kept" });
  });

  it("treats null/garbage overrides as no-op", () => {
    expect(mergeBriefOverrides({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeBriefOverrides({ a: 1 }, null)).toEqual({ a: 1 });
  });
});

describe("captionForScreenshot", () => {
  const shots = [
    { file: "screenshots/a.png", description: "first" },
    { file: "b.png", description: "second" },
  ];
  it("matches by basename in either direction", () => {
    expect(captionForScreenshot("screenshots/a.png", shots)).toBe("first");
    expect(captionForScreenshot("a.png", shots)).toBe("first");
    expect(captionForScreenshot("screenshots/b.png", shots)).toBe("second");
  });
  it("returns undefined when unmatched or no shots", () => {
    expect(captionForScreenshot("z.png", shots)).toBeUndefined();
    expect(captionForScreenshot("a.png", undefined)).toBeUndefined();
  });
});

describe("mergeBriefOverrides: replay", () => {
  it("carries the attach choice and the note", () => {
    const m = mergeBriefOverrides({ a: 1 }, { includeReplay: false, replayNote: "watch the second tab" });
    expect(m.includeReplay).toBe(false);
    expect(m.replayNote).toBe("watch the second tab");
    expect(mergeBriefOverrides({}, {}).includeReplay).toBeUndefined();
  });
});

describe("a trimmed recording's event log", () => {
  const events = [
    { type: "click", tMs: 500, url: "https://a.test/" },
    { type: "network", tMs: 4000, url: "https://api.a.test/x", status: 500 },
    { type: "nav", tMs: 9000, url: "https://a.test/b" },
    { type: "meta" },
  ];

  it("keeps what happened in the kept part, on the trimmed video's clock", () => {
    const j = mergeBriefOverrides({ events }, { recordingTrim: { a: 3000, b: 8000 } });
    expect(j.events).toEqual([{ type: "network", tMs: 1000, url: "https://api.a.test/x", status: 500 }, { type: "meta" }]);
  });

  it("an untrimmed recording, or a nonsense trim, leaves the log alone", () => {
    expect(mergeBriefOverrides({ events }, {}).events).toEqual(events);
    expect(mergeBriefOverrides({ events }, { recordingTrim: { a: 5000, b: 1000 } }).events).toEqual(events);
    expect(trimEvents(events, { a: 0, b: 1e9 })).toEqual(events);
  });
});

describe("autoReport override", () => {
  it("marks a one-click report, and only when set", () => {
    expect(mergeBriefOverrides({}, { autoReport: true }).autoReport).toBe(true);
    expect(mergeBriefOverrides({}, {}).autoReport).toBeUndefined();
  });
});
