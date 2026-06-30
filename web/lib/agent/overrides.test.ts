import { describe, it, expect } from "vitest";
import { mergeBriefOverrides, captionForScreenshot } from "./overrides";

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
    expect(merged.screenshots[0].description).toBe("note");
    expect((merged as any).events).toEqual([{ a: 1 }]); // untouched capture data
  });

  it("ignores absent/blank overrides and does not mutate the input", () => {
    const json = { transcript: "kept", description: "kept" };
    const merged = mergeBriefOverrides(json, { transcript: "   " });
    expect(merged.transcript).toBe("kept");
    expect(merged.description).toBe("kept");
    expect(json).toEqual({ transcript: "kept", description: "kept" });
  });

  it("treats null/garbage overrides as no-op", () => {
    expect(mergeBriefOverrides({ a: 1 }, undefined as any)).toEqual({ a: 1 });
    expect(mergeBriefOverrides({ a: 1 }, null as any)).toEqual({ a: 1 });
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
