import { describe, expect, it } from "vitest";
import {
  ago,
  funnelCounts,
  funnelOf,
  lineOf,
  nudgeSummary,
  siteSummary,
  sourceLine,
  timelineOf,
  type PersonFacts,
} from "./activity";

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
  admin: false,
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
    expect(sourceLine({ src: "hero", ref: "com.linkedin.android" })).toBe("hero button · from LinkedIn");
    expect(sourceLine({ src: "nav", utm_source: "ticket", utm_campaign: "fall" })).toBe(
      "nav button · from Brief tickets · utm fall",
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

  it("says when the extension's card brought a brief", () => {
    expect(lineOf({ name: "brief.created", props: { kind: "text", via: "nudge" } })?.text).toBe(
      "Created a brief (text) from the reminder",
    );
    expect(lineOf({ name: "brief.created", props: { kind: "text" } })?.text).toBe("Created a brief (text)");
  });

  it("writes what people did with the reminder popup", () => {
    expect(lineOf({ name: "nudge.shown", props: { replay: true } })).toEqual({
      kind: "extension",
      text: "Brief's popup reminded them (on a Replay site)",
    });
    expect(lineOf({ name: "nudge.shown", props: { replay: false } })?.text).toBe("Brief's popup reminded them");
    expect(lineOf({ name: "nudge.brief_it", props: {} })?.text).toBe("Started a brief from the reminder");
    expect(lineOf({ name: "nudge.closed", props: {} })?.text).toBe("Closed the reminder");
  });
});

describe("nudgeSummary", () => {
  const ev = (at: string, name: string, user_id = "u1", props: Record<string, unknown> = {}) => ({ at, name, user_id, props });
  const SINCE = Date.parse("2026-10-01T00:00:00Z");

  it("ends each showing one way: Brief it, closed, or no action", () => {
    const s = nudgeSummary(
      [
        // u1: shown, Brief it, a brief from it; a week later shown and closed
        ev("2026-10-02T10:00:00Z", "nudge.shown", "u1", { replay: true }),
        ev("2026-10-02T10:01:00Z", "nudge.brief_it"),
        ev("2026-10-02T10:02:00Z", "brief.created", "u1", { kind: "text", via: "nudge" }),
        ev("2026-10-09T10:00:00Z", "nudge.shown"),
        ev("2026-10-09T10:00:05Z", "nudge.closed"),
        // u2: shown twice with no click (the first ends at the second), u3: shown, nothing yet
        ev("2026-10-03T10:00:00Z", "nudge.shown", "u2"),
        ev("2026-10-10T10:00:00Z", "nudge.shown", "u2"),
        ev("2026-10-20T10:00:00Z", "nudge.shown", "u3"),
        // not the reminder's: a brief made another way
        ev("2026-10-05T10:00:00Z", "brief.created", "u2", { kind: "text" }),
      ],
      SINCE,
    );
    expect(s).toEqual({ shown: 5, briefIt: 1, closed: 1, noAction: 3, briefs: 1 });
  });

  it("only counts the period, in time order whatever the input order", () => {
    const s = nudgeSummary(
      [
        ev("2026-10-04T10:00:00Z", "nudge.closed"),
        ev("2026-09-20T10:00:00Z", "nudge.shown", "u9"),
        ev("2026-10-04T09:00:00Z", "nudge.shown"),
      ],
      SINCE,
    );
    expect(s).toEqual({ shown: 1, briefIt: 0, closed: 1, noAction: 0, briefs: 0 });
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

  it("counts views, pages, clicks and how far the demo got", () => {
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
    expect(s.clicks).toEqual([["Sign up · hero", 1]]);
    expect(s.demo).toEqual([["start", 2], ["brief", 1]]);
  });
});
