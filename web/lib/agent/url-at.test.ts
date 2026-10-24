import { describe, it, expect } from "vitest";
import { nearestFrame, urlAt } from "./run-processing";
import { keyMomentFrames } from "./load-brief-input";

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
  it("never takes a network call's address for the page", () => {
    const withCall = { ...json, events: [...json.events, { type: "network", tMs: 5000, url: "https://app.test/api/pay", status: 500 }] };
    expect(urlAt(withCall, 6000)).toBe("https://app.test/checkout");
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

describe("keyMomentFrames", () => {
  it("keeps the first frame on each new page and the first after a click or a failure", () => {
    const json = {
      pageUrl: "https://app.test/a",
      events: [
        { type: "click", tMs: 2500, url: "https://app.test/a", element: { text: "Go" } },
        { type: "nav", tMs: 2700, url: "https://app.test/b" },
        { type: "network", tMs: 9100, url: "https://app.test/api/x", status: 500, ms: 300 },
      ],
    };
    const frames = [0, 2000, 4000, 6000, 8000, 10000, 12000].map((t) => ({ name: String(t), timestampMs: t }));
    // 4000: on /b now, and just after the click; 10000: just after the failed call returned
    expect([...keyMomentFrames(frames, json)].map((f) => f.name)).toEqual(["4000", "10000"]);
  });
});
