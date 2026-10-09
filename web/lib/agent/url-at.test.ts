import { describe, it, expect } from "vitest";
import { nearestFrame, urlAt } from "./run-processing";

describe("urlAt", () => {
  const json = {
    pageUrl: "https://app.test/start",
    events: [
      { type: "click", tMs: 1000, url: "https://app.test/start" },
      { type: "click", tMs: 4000, url: "https://app.test/checkout" },
      { type: "console-error", tMs: 4500 },
      { type: "key", tMs: 9000, url: "https://app.test/pay" },
    ],
  };
  it("gives the page the recording was on at that moment", () => {
    expect(urlAt(json, 500)).toBe("https://app.test/start"); // before any event: the brief's page
    expect(urlAt(json, 4200)).toBe("https://app.test/checkout");
    expect(urlAt(json, 6000)).toBe("https://app.test/checkout"); // events without a url don't count
    expect(urlAt(json, 12000)).toBe("https://app.test/pay");
  });
  it("is safe without events or a time", () => {
    expect(urlAt({ pageUrl: "https://x.test/" }, 100)).toBe("https://x.test/");
    expect(urlAt({}, undefined)).toBeUndefined();
    expect(urlAt(null, 5)).toBeUndefined();
  });
});

describe("nearestFrame", () => {
  it("picks the frame closest to a mark, ignoring frames without a time", () => {
    const frames = [{ name: "a", timestampMs: 0 }, { name: "b", timestampMs: 2000 }, { name: "c" }, { name: "d", timestampMs: 6000 }];
    expect(nearestFrame(frames, 2600)?.name).toBe("b");
    expect(nearestFrame(frames, 4500)?.name).toBe("d");
    expect(nearestFrame([], 10)).toBeUndefined();
  });
});
