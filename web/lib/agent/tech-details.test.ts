import { describe, it, expect } from "vitest";
import { techFromReplay, techFromRecording, renderTechDetails, techForAgent, rankCalls, isEmpty, isNoise, videoLogSections, videoLogsForAgent } from "./tech-details";

const T0 = 1_000_000;
const AT = Date.UTC(2026, 9, 9, 18, 36, 25, 0); // 2026-10-09 18:36:25.000 UTC
const custom = (dt: number, payload: Record<string, unknown>) => ({ type: 5, timestamp: T0 + dt, data: { tag: "brief", payload } });

// A replay of the Thunders app: load, click Test Cases, a slow call, polling,
// analytics, a reload, a failed call, the console.
const button = (id: number, label: string) => ({ id, type: 2, tagName: "button", attributes: {}, childNodes: [{ id: id + 1, type: 3, textContent: label }] });
const replay = {
  events: [
    { type: 4, timestamp: T0, data: { href: "https://app.thunders.ai/#/test-projects/0ed0?tab=envs", width: 1600, height: 712 } },
    { type: 2, timestamp: T0, data: { node: { id: 1, type: 0, childNodes: [button(10, "Test Cases"), button(20, "Run")] } } },
    custom(0, { kind: "nav", url: "https://app.thunders.ai/#/test-projects/0ed0?tab=envs", load: true, at: AT }),
    custom(500, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/notifications/unread-count", status: 200, ms: 238, at: AT + 500 }),
    custom(600, { kind: "network", method: "POST", url: "https://eu.i.posthog.com/s/", status: 200, ms: 719, at: AT + 600 }),
    custom(700, { kind: "network", method: "POST", url: "https://dc.services.visualstudio.com/v2/track", status: 200, ms: 184, at: AT + 700 }),
    { type: 3, timestamp: T0 + 3000, data: { source: 2, type: 2, id: 11 } }, // click "Test Cases"
    custom(3010, { kind: "nav", url: "https://app.thunders.ai/#/test-projects/0ed0/test-cases", at: AT + 3010 }),
    custom(3150, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/test-cases?projectId=0ed0", status: 200, ms: 7900, at: AT + 3150, trace: "x-request-id: 7f3a9c", request: "" }),
    custom(4000, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/notifications/unread-count", status: 200, ms: 98, at: AT + 4000 }),
    custom(10000, { kind: "network", method: "GET", url: "https://api.thunders.ai/api/notifications/unread-count", status: 200, ms: 228, at: AT + 10000 }),
    { type: 4, timestamp: T0 + 12000, data: { href: "https://app.thunders.ai/#/test-projects/0ed0/test-cases", width: 1600, height: 712 } },
    { type: 2, timestamp: T0 + 12000, data: { node: { id: 1, type: 0, childNodes: [button(20, "Run")] } } },
    custom(12000, { kind: "nav", url: "https://app.thunders.ai/#/test-projects/0ed0/test-cases", load: true, at: AT + 52000 }), // 40 s of idle cut before it
    { type: 3, timestamp: T0 + 13000, data: { source: 2, type: 2, id: 21 } }, // click "Run"
    custom(13100, {
      kind: "network", method: "POST", url: "https://api.thunders.ai/api/test-runner/run?token=***", status: 500, ms: 1200, reason: "Internal Server Error",
      at: AT + 53100, trace: "x-request-id: 9b2e", request: '{"testId":42,"password":"***"}', response: '{"error":"runner unavailable"}',
    }),
    custom(13500, { kind: "console-error", args: ["run failed"], at: AT + 53500 }),
  ],
};

describe("technical logs from a replay", () => {
  const td = techFromReplay(replay);

  it("reads what the user did, the calls, the console and the pages", () => {
    expect(td.actions.map((a) => `${a.kind} ${a.what}`)).toEqual([
      "open app.thunders.ai/#/test-projects/0ed0?tab=envs",
      'click "Test Cases"',
      "go to app.thunders.ai/#/test-projects/0ed0/test-cases",
      "reload app.thunders.ai/#/test-projects/0ed0/test-cases",
      'click "Run"',
    ]);
    expect(td.network).toHaveLength(7);
    expect(td.console).toHaveLength(1);
  });

  it("gives every line a clock time, borrowing a neighbour's when the capture had none", () => {
    // the click at 0:03 had no real time; its neighbour (the nav 10 ms later) has
    expect(td.actions.find((a) => a.what === '"Test Cases"')?.at).toBe(AT + 3000);
    // the reload sits after a 40 s cut: its own real time, not the video's
    expect(td.actions.find((a) => a.kind === "reload")?.at).toBe(AT + 52000);
  });

  it("knows analytics and telemetry from the app's own calls", () => {
    expect(isNoise("https://eu.i.posthog.com/s/")).toBe(true);
    expect(isNoise("https://dc.services.visualstudio.com/v2/track")).toBe(true);
    expect(isNoise("https://api.thunders.ai/api/me")).toBe(false);
  });

  it("puts failed calls first, then the slowest", () => {
    const ranked = rankCalls(td.network).map((c) => c.url.split("/api/")[1] ?? c.url);
    expect(ranked.slice(0, 2)).toEqual(["test-runner/run?token=***", "test-cases?projectId=0ed0"]);
  });
});

describe("the rendered logs", () => {
  const md = renderTechDetails(techFromReplay(replay));

  it("opens with what the times mean", () => {
    expect(md.startsWith("Times: into the video, then the clock in UTC (2026-10-09)")).toBe(true);
  });

  it("lists failed and slow calls with their trace id and bodies", () => {
    expect(md).toContain("**Failed and slow** (1 failed, 1 slow)");
    expect(md).toMatch(/0:13 {2}18:37:18\.100 {2}POST {4}api\.thunders\.ai\/api\/test-runner\/run\?token=\*\*\*\s+500\s+1\.2 s\n\s+trace {5}x-request-id: 9b2e\n\s+request {3}\{"testId":42,"password":"\*\*\*"\}\n\s+response {2}\{"error":"runner unavailable"\}/);
    expect(md).toMatch(/GET {5}api\.thunders\.ai\/api\/test-cases\?projectId=0ed0\s+200\s+7\.9 s\n\s+trace {5}x-request-id: 7f3a9c/);
  });

  it("shows one timeline: what the user did, the calls it set off, the console, in order", () => {
    const tl = md.slice(md.indexOf("**Timeline**"));
    const order = ["open ", 'click   "Test Cases"', "go to ", "api/test-cases", "reload ", 'click   "Run"', "api/test-runner/run", "error   run failed"].map((s) => tl.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("folds the same call repeated into one line, and counts analytics on one line", () => {
    expect(md).toMatch(/GET {5}api\.thunders\.ai\/api\/notifications\/unread-count\s+200\s+98 ms to 238 ms {2}x3 until 0:10/);
    expect(md).not.toMatch(/posthog\.com\/s\//);
    expect(md).toContain("+ 2 analytics/telemetry calls not listed: eu.i.posthog.com x1, dc.services.visualstudio.com x1");
  });

  it("lists everything; only the tracker's size limit cuts it, and says so", () => {
    const many = { events: [replay.events[0], ...Array.from({ length: 400 }, (_, i) => custom(i * 10, { kind: "network", method: "GET", url: `https://x.test/a${i}`, status: 200, ms: 20, at: AT + i * 10 }))] };
    const full = renderTechDetails(techFromReplay(many), { budget: 1_000_000 });
    expect(full).toContain("x.test/a399");
    expect(full).not.toContain("more lines");
    const capped = renderTechDetails(techFromReplay(many));
    expect(capped.length).toBeLessThan(15_000);
    expect(capped).toMatch(/… \d+ more lines \(the tracker's size limit\)/);
  });

  it("an older capture without clock times shows the video time only", () => {
    const old = { events: [replay.events[0], custom(100, { kind: "network", method: "GET", url: "https://a.test/x", status: 500, ms: 20 })] };
    const out = renderTechDetails(techFromReplay(old));
    expect(out.startsWith("Times: into the video.")).toBe(true);
    expect(out).not.toMatch(/\d\d:\d\d:\d\d\.\d{3}/);
  });
});

describe("technical logs from a recording", () => {
  it("reads loads, reloads, clicks and keys, and the calls", () => {
    const td = techFromRecording({
      events: [
        { type: "nav", tMs: 0, at: AT, url: "https://shop.test/cart", load: true },
        { type: "click", tMs: 500, at: AT + 500, url: "https://shop.test/cart", element: { tag: "button", selector: "button#pay", text: "Pay now" } },
        { type: "key", tMs: 600, at: AT + 600, url: "https://shop.test/cart", key: "Enter" },
        { type: "key", tMs: 650, at: AT + 650, url: "https://shop.test/cart", key: "<char>" },
        { type: "network", tMs: 900, at: AT + 900, url: "https://api.shop.test/pay", method: "POST", status: 502, ms: 1200, reason: "Bad Gateway" },
        { type: "network-error", tMs: 900, url: "https://api.shop.test/pay", method: "POST", status: 502 },
        { type: "nav", tMs: 3000, at: AT + 3000, url: "https://shop.test/cart", load: true },
        { type: "js-error", tMs: 3100, at: AT + 3100, url: "https://shop.test/cart", message: "x is undefined", filename: "https://shop.test/app.js", lineno: 12 },
      ],
    });
    expect(td.actions.map((a) => `${a.kind} ${a.what}`)).toEqual(["open shop.test/cart", 'click "Pay now"', "key Enter", "reload shop.test/cart"]);
    expect(td.network).toHaveLength(1);
    expect(td.console[0].text).toBe("x is undefined (app.js:12)");
  });

  it("falls back to failures alone from an older extension", () => {
    expect(techFromRecording({ events: [{ type: "network-error", tMs: 10, url: "https://a.test/x", method: "GET", status: 500 }] }).network).toHaveLength(1);
  });

  it("is empty when nothing was captured", () => {
    expect(isEmpty(techFromRecording({}))).toBe(true);
    expect(isEmpty(techFromReplay(null))).toBe(true);
    expect(renderTechDetails(techFromRecording({}))).toBe("");
  });
});

describe("for the agent and per video", () => {
  it("gives the agent the failed and slow calls, with what was sent and what came back", () => {
    const text = techForAgent(techFromReplay(replay));
    expect(text).toContain("POST api.thunders.ai/api/test-runner/run?token=*** -> 500 in 1.2 s (Internal Server Error)");
    expect(text).toContain('response: {"error":"runner unavailable"}');
    expect(text).toContain("GET api.thunders.ai/api/test-cases?projectId=0ed0 -> 200 in 7.9 s");
    expect(text).not.toContain("posthog");
  });

  it("each video gets its own section, titled after it", () => {
    const rec = techFromRecording({ events: [{ type: "network", tMs: 400, at: AT, url: "https://api.shop.test/pay", method: "POST", status: 502, ms: 900 }] });
    const sections = videoLogSections([{ label: "Screen recording", td: rec }, { label: "Replay", td: techFromReplay(replay) }]);
    expect(sections.map((s) => s.title)).toEqual(["Technical logs: Screen recording", "Technical logs: Replay"]);
    expect(sections[0].markdown).toContain("api.shop.test/pay");
    expect(sections[1].markdown).toContain("api/test-cases");
    expect(videoLogsForAgent([{ label: "Screen recording", td: rec }, { label: "Replay", td: techFromReplay(replay) }])).toContain("[Replay - times are into this video]");
    expect(videoLogSections([{ label: "Replay", td: techFromReplay(null) }])).toEqual([]);
  });
});
