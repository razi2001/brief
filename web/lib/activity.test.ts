import { describe, expect, it } from "vitest";
import { ago, funnelCounts, funnelOf, lineOf, siteSummary, sourceLine, timelineOf, type PersonFacts } from "./activity";

const person = (over: Partial<PersonFacts> = {}): PersonFacts => ({
  id: "user_1",
  name: "Ada",
  email: "ada@example.com",
  image: null,
  createdAt: "2026-10-20T16:00:00Z",
  signup: null,
  role: "",
  source: "",
  trackers: 0,
  extension: false,
  briefs: 0,
  filed: 0,
  lastSeen: null,
  ...over,
});

describe("funnelOf / funnelCounts", () => {
  it("reads each step from what the account has now", () => {
    expect(funnelOf(person({ role: "QA / Tester", extension: true }))).toEqual({
      about: true,
      tracker: false,
      extension: true,
      brief: false,
      filed: false,
    });
  });

  it("counts people per step", () => {
    const counts = funnelCounts([person({ role: "PM", trackers: 1, briefs: 2, filed: 1 }), person({ source: "LinkedIn" })]);
    expect(counts).toEqual({ about: 2, tracker: 1, extension: 0, brief: 1, filed: 1 });
  });
});

describe("ago", () => {
  it("reads short, then falls back to a date", () => {
    const now = Date.parse("2026-10-20T16:00:00Z");
    expect(ago("2026-10-20T15:59:30Z", now)).toBe("now");
    expect(ago("2026-10-20T15:10:00Z", now)).toBe("50m");
    expect(ago("2026-10-20T10:00:00Z", now)).toBe("6h");
    expect(ago("2026-10-18T16:00:00Z", now)).toBe("2d");
    expect(ago("2026-06-01T16:00:00Z", now)).toBe("Jun 1, 2026");
    expect(ago(null, now)).toBe("");
  });
});

describe("sourceLine", () => {
  it("names the button, the site and the campaign", () => {
    expect(sourceLine({ src: "hero", ref: "www.linkedin.com", utm_source: "linkedin" })).toBe(
      "hero button · from www.linkedin.com · utm linkedin",
    );
    expect(sourceLine(null)).toBe("");
  });
});

describe("lineOf", () => {
  it("writes one plain line per event", () => {
    expect(lineOf({ name: "tracker.connected", props: { provider: "linear" } })?.text).toBe("Connected Linear");
    expect(lineOf({ name: "page.view", props: { path: "/tickets" } })?.text).toBe("Opened /tickets");
    expect(lineOf({ name: "onboarding.step", props: { step: "tracker" } })?.text).toBe("Onboarding: tracker step");
    expect(lineOf({ name: "brief.failed", props: { stage: "file", error: "boom" } })).toEqual({
      kind: "brief",
      text: "Filing failed: boom",
      bad: true,
    });
    expect(lineOf({ name: "unknown.thing", props: {} })).toBeNull();
  });
});

describe("timelineOf", () => {
  it("puts the newest first, ends with the sign-up, and folds repeats", () => {
    const items = timelineOf({
      createdAt: "2026-10-20T16:00:00Z",
      signup: { src: "hero" },
      events: [
        { at: "2026-10-20T16:00:43Z", name: "onboarding.about", props: { role: "QA / Tester", source: "LinkedIn" } },
        { at: "2026-10-20T16:01:35Z", name: "extension.opened", props: {} },
        { at: "2026-10-20T16:02:00Z", name: "extension.opened", props: {} },
      ],
      tokens: [],
      briefs: [],
      since: "2026-10-20T00:00:00Z",
    });
    expect(items.map((i) => [i.text, i.count ?? 1])).toEqual([
      ["Opened the extension popup", 2],
      ["About you: QA / Tester, heard from LinkedIn", 1],
      ["Signed up · hero button", 1],
    ]);
    expect(items[0].at).toBe("2026-10-20T16:02:00Z");
  });

  it("fills history from the tables only before tracking started", () => {
    const items = timelineOf({
      createdAt: "2026-10-01T10:00:00Z",
      signup: null,
      events: [{ at: "2026-10-20T10:00:00Z", name: "brief.created", props: { kind: "screenshot" } }],
      tokens: [{ created_at: "2026-10-01T10:05:00Z" }],
      briefs: [
        { created_at: "2026-10-02T09:00:00Z", ticket_url: "https://x/1", ticket_provider: "jira", updated_at: "2026-10-02T09:01:00Z" },
        // After `since`: already an event, not repeated from the table.
        { created_at: "2026-10-20T10:00:00Z", ticket_url: null, ticket_provider: null, updated_at: null },
      ],
      since: "2026-10-15T00:00:00Z",
    });
    expect(items.map((i) => i.text)).toEqual([
      "Created a brief (screenshot)",
      "Filed a ticket to Jira",
      "Created a brief",
      "Paired the extension",
      "Signed up",
    ]);
  });
});

describe("siteSummary", () => {
  const ev = (name: string, props: Record<string, unknown>, at = "2026-10-20T12:00:00Z") => ({ at, name, props });

  it("counts views, sources, clicks and how far the demo got", () => {
    const s = siteSummary(
      [
        ev("site.view", { path: "/", ref: "www.linkedin.com", utm_source: "linkedin", device: "mobile", pv: "a" }),
        ev("site.view", { path: "/", ref: "", pv: "b", device: "desktop" }),
        ev("site.view", { path: "/privacy", ref: "", pv: "c", device: "desktop" }),
        ev("site.click", { target: "signup", where: "hero", pv: "a" }),
        ev("site.demo", { act: "start", pv: "a" }),
        ev("site.demo", { act: "brief", pv: "a" }),
        ev("site.demo", { act: "start", pv: "b" }),
        ev("site.view", { path: "/", pv: "old" }, "2026-09-01T00:00:00Z"),
      ],
      Date.parse("2026-10-13T00:00:00Z"),
    );
    expect(s.views).toBe(3);
    expect(s.mobile).toBe(1);
    expect(s.pages).toEqual([["/", 2], ["/privacy", 1]]);
    expect(s.referrers).toEqual([["direct", 2], ["www.linkedin.com", 1]]);
    expect(s.sources).toEqual([["linkedin", 1]]);
    expect(s.clicks).toEqual([["signup · hero", 1]]);
    expect(s.demo).toEqual([["start", 2], ["brief", 1]]);
  });
});
