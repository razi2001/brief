import { describe, expect, it } from "vitest";
import type { EventRow, PersonFacts } from "./activity";
import { dashboardOf, dayOf, dayRange, type DashboardInput } from "./activity-stats";

const NOW = Date.parse("2026-11-02T15:00:00Z");

const person = (createdAt: string, over: Partial<PersonFacts> = {}): PersonFacts => ({
  id: `user_${createdAt}`,
  name: "Ada",
  email: null,
  image: null,
  createdAt,
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
const view = (at: string, pv: string, props: Record<string, string> = {}): EventRow => ({
  at,
  name: "site.view",
  props: { path: "/", pv, ...props },
});
const click = (at: string, pv: string, target: string): EventRow => ({ at, name: "site.click", props: { target, pv } });

const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({
  now: NOW,
  days: 7,
  site: [],
  people: [],
  seen: [],
  briefs: [],
  logStart: "2026-10-20T19:00:00Z",
  ...over,
});

describe("dayOf / dayRange", () => {
  it("names UTC days, oldest first, ending today", () => {
    expect(dayOf("2026-11-01T23:30:00-02:00")).toBe("2026-11-02");
    expect(dayOf("not a date")).toBe("");
    expect(dayRange(NOW, 3)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("dashboardOf", () => {
  it("puts each visit on its day, stacked by where it came from", () => {
    const d = dashboardOf(
      input({
        site: [
          view("2026-11-01T10:00:00Z", "a", { ref: "www.linkedin.com" }),
          view("2026-11-01T11:00:00Z", "b", { ref: "com.linkedin.android" }),
          view("2026-11-01T12:00:00Z", "c", { ref: "www.google.com" }),
          view("2026-11-02T09:00:00Z", "d"),
          view("2026-10-01T09:00:00Z", "old"),
        ],
      }),
    );
    expect(d.daily).toHaveLength(7);
    const nov1 = d.daily.find((p) => p.day === "2026-11-01")!;
    expect(nov1.visits).toBe(3);
    expect(nov1.groups).toEqual([2, 1, 0]);
    expect(nov1.channels).toEqual([
      ["LinkedIn", 2],
      ["Google", 1],
    ]);
    expect(d.daily.at(-1)!.groups).toEqual([0, 0, 1]);
    expect(d.totals.visits.value).toBe(4);
  });

  it("counts sign-ups, active people and briefs per day", () => {
    const d = dashboardOf(
      input({
        people: [person("2026-11-02T08:00:00Z"), person("2026-11-02T09:00:00Z"), person("2026-10-29T09:00:00Z")],
        seen: [
          { user_id: "u1", at: "2026-11-02T10:00:00Z" },
          { user_id: "u1", at: "2026-11-02T11:00:00Z" },
          { user_id: "u2", at: "2026-11-02T12:00:00Z" },
        ],
        briefs: [
          { user_id: "u3", created_at: "2026-11-02T13:00:00Z", ticket_url: "https://linear.app/x", status: "filed" },
          { user_id: "u3", created_at: "2026-11-02T14:00:00Z", ticket_url: null, status: "drafted" },
          { user_id: "u4", created_at: "2026-11-02T14:30:00Z", ticket_url: null, status: "uploaded" },
        ],
      }),
    );
    const today = d.daily.at(-1)!;
    // u4's raw upload makes them active, but isn't a brief.
    expect(today).toMatchObject({ signups: 2, active: 4, briefs: 2, filed: 1 });
    expect(d.totals.signups).toEqual({ value: 3, before: 0 });
    expect(d.totals.active.value).toBe(4);
    expect(d.totals.briefs.value).toBe(2);
    expect(d.totals.filed.value).toBe(1);
  });

  it("compares with the period before, but not where the log didn't exist yet", () => {
    const people = [person("2026-11-01T08:00:00Z"), person("2026-10-22T08:00:00Z"), person("2026-10-21T08:00:00Z")];
    const site = [view("2026-11-01T08:00:00Z", "a"), view("2026-10-22T08:00:00Z", "b")];
    const week = dashboardOf(input({ people, site }));
    expect(week.totals.signups).toEqual({ value: 1, before: 2 });
    expect(week.totals.visits).toEqual({ value: 1, before: 1 });

    const month = dashboardOf(input({ days: 30, people, site }));
    expect(month.totals.visits.before).toBeNull();
    expect(month.totals.active.before).toBeNull();
    expect(month.totals.signups.before).toBe(0);
  });

  it("follows each page load's clicks back to where the visit came from", () => {
    const d = dashboardOf(
      input({
        site: [
          view("2026-11-01T10:00:00Z", "a", { ref: "www.linkedin.com" }),
          click("2026-11-01T10:01:00Z", "a", "signup"),
          click("2026-11-01T10:02:00Z", "a", "chrome"),
          view("2026-11-01T11:00:00Z", "b", { utm_source: "ticket" }),
          click("2026-11-01T11:01:00Z", "b", "chrome"),
          view("2026-11-01T12:00:00Z", "c"),
          view("2026-11-01T12:30:00Z", "e"),
        ],
        people: [person("2026-11-01T10:05:00Z", { signup: { src: "hero", ref: "www.linkedin.com" } })],
      }),
    );
    expect(d.sources).toEqual([
      { channel: "LinkedIn", visits: 1, signupClicks: 1, chromeClicks: 1, signups: 1 },
      { channel: "Brief tickets", visits: 1, signupClicks: 0, chromeClicks: 1, signups: 0 },
      { channel: "No referrer", visits: 2, signupClicks: 0, chromeClicks: 0, signups: 0 },
    ]);
  });

  it("tallies what new sign-ups said they heard from, unanswered last", () => {
    const d = dashboardOf(
      input({
        people: [
          person("2026-11-01T08:00:00Z", { source: "LinkedIn" }),
          person("2026-11-01T09:00:00Z", { source: "LinkedIn" }),
          person("2026-11-01T10:00:00Z", { source: "A friend or colleague" }),
          person("2026-11-01T11:00:00Z"),
          person("2026-09-01T11:00:00Z", { source: "Product Hunt" }),
        ],
      }),
    );
    expect(d.heard).toEqual([
      ["LinkedIn", 2],
      ["A friend or colleague", 1],
      ["No answer", 1],
    ]);
  });
});
