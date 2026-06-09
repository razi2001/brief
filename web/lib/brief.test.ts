import { describe, it, expect } from "vitest";
import { detectSourceKind } from "./brief";

describe("detectSourceKind", () => {
  it("recording when keyframes/transcript present", () => {
    expect(detectSourceKind({ transcript: "hi", keyframeCount: 12 })).toBe("recording");
  });
  it("screenshot when only screenshot", () => {
    expect(detectSourceKind({ hasScreenshot: true })).toBe("screenshot");
  });
  it("text when only description", () => {
    expect(detectSourceKind({ description: "button broken" })).toBe("text");
  });
  it("mix when recording + screenshot", () => {
    expect(detectSourceKind({ keyframeCount: 5, hasScreenshot: true })).toBe("mix");
  });
});
