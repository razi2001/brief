import { describe, it, expect } from "vitest";
import { techFromReplay, techFromRecording, renderTechDetails, techForAgent, rankCalls, isEmpty } from "./tech-details";

const T0 = 1_000_000;
const custom = (dt: number, payload: Record<string, unknown>) => ({ type: 5, timestamp: T0 + dt, data: { tag: "brief", payload } });

// APP-6453: Test Cases sat on placeholders because one call took ~8s
const replay = {
  events: [
    { type: 4, timestamp: T0, data: { href: "https://app.thunders.ai/#/test-projects/0ed0?tab=envs", width: 1600, height: 712 } },
    { type: 2, timestamp: T0, data: {} },
    custom(3000, { kind: "nav", url: "https://app.thunders.ai/#/test-projects/0ed0/test-cases" }),
    custom(3100, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/me", status: 200, ms: 85 }),
    custom(3150, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/test-cases?projectId=0ed0", status: 200, ms: 7900 }),
    custom(3200, { kind: "network", method: "POST", url: "https://api.thunders.ai/api/telemetry", status: 0, ms: 30, reason: "network error" }),
    custom(5000, { kind: "console-error", args: ["Failed to load resource: 504"] }),
    custom(6000, { kind: "console-warn", args: ["each child in a list should have a unique key"] }),
    { type: 3, timestamp: T0 + 6500, data: { source: 2 } },
  ],
};

describe("technical details from a replay", () => {
  it("reads pages, every call with its time, and the console, on the replay's clock", () => {
    const td = techFromReplay(replay);
    expect(td.pages).toEqual([
      { t: 0, url: "https://app.thunders.ai/#/test-projects/0ed0?tab=envs" },
      { t: 3000, url: "https://app.thunders.ai/#/test-projects/0ed0/test-cases" },
    ]);
    expect(td.network).toHaveLength(3);
    expect(td.console.map((c) => c.level)).toEqual(["error", "warn"]);
  });

  it("puts failed calls first, then the slowest, then the rest", () => {
    const ranked = rankCalls(techFromReplay(replay).network).map((c) => c.url.split("/api/")[1]);
    expect(ranked).toEqual(["telemetry", "test-cases?projectId=0ed0", "me"]);
  });

  it("renders a section a developer can scan: times, methods, statuses, durations", () => {
    const md = renderTechDetails(techFromReplay(replay));
    expect(md).toContain("**Pages**");
    expect(md).toContain("0:03  app.thunders.ai/#/test-projects/0ed0/test-cases");
    expect(md).toContain("**Network** (3 requests, 1 failed, 1 slow; failed and slowest first)");
    expect(md).toMatch(/0:03 {2}GET {4}api\.thunders\.ai\/api\/test-cases\?projectId=0ed0\s+200\s+7\.9 s/);
    expect(md).toMatch(/POST\s+api\.thunders\.ai\/api\/telemetry\s+failed\s+30 ms {2}network error/);
    expect(md).toContain("0:05  error  Failed to load resource: 504");
  });

  it("gives the agent the slow call, so the write-up can name it", () => {
    const text = techForAgent(techFromReplay(replay));
    expect(text).toContain("GET api.thunders.ai/api/test-cases?projectId=0ed0 -> 200 in 7.9 s");
    expect(text).not.toContain("/api/me");
  });

  it("caps long lists but never drops a notable call", () => {
    const many = { events: [replay.events[0], ...Array.from({ length: 80 }, (_, i) => custom(i * 10, { kind: "network", method: "GET", url: `https://x.test/a${i}`, status: 200, ms: 20 })), custom(900, { kind: "network", method: "GET", url: "https://x.test/slow", status: 200, ms: 4000 })] };
    const md = renderTechDetails(techFromReplay(many));
    expect(md).toContain("x.test/slow");
    expect(md).toContain("… 41 more");
  });
});

describe("technical details from a recording", () => {
  it("uses each event's page url for the pages, and the request url for calls", () => {
    const td = techFromRecording({
      events: [
        { type: "click", tMs: 500, url: "https://shop.test/cart" },
        { type: "network", tMs: 900, url: "https://api.shop.test/pay", method: "POST", status: 502, ms: 1200, reason: "Bad Gateway" },
        { type: "network-error", tMs: 900, url: "https://api.shop.test/pay", method: "POST", status: 502 },
        { type: "nav", tMs: 1500, url: "https://shop.test/error" },
        { type: "js-error", tMs: 1600, url: "https://shop.test/error", message: "x is undefined", filename: "https://shop.test/app.js", lineno: 12 },
      ],
    });
    expect(td.pages.map((p) => p.url)).toEqual(["https://shop.test/cart", "https://shop.test/error"]);
    expect(td.network).toEqual([{ t: 900, method: "POST", url: "https://api.shop.test/pay", status: 502, ms: 1200, reason: "Bad Gateway" }]);
    expect(td.console[0].text).toBe("x is undefined (app.js:12)");
  });

  it("falls back to failures alone from an older extension", () => {
    const td = techFromRecording({ events: [{ type: "network-error", tMs: 10, url: "https://a.test/x", method: "GET", status: 500 }] });
    expect(td.network).toHaveLength(1);
  });

  it("is empty when nothing was captured", () => {
    expect(isEmpty(techFromRecording({}))).toBe(true);
    expect(isEmpty(techFromReplay(null))).toBe(true);
    expect(renderTechDetails(techFromRecording({}))).toBe("");
  });
});
