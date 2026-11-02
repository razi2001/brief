// The charts on /admin/activity, as pure functions: one point per day, the
// period totals against the period before, and where people came from.
// Days are UTC. lib/activity-server.ts loads the rows.

import type { Counted, EventRow, PersonFacts } from "@/lib/activity";
import { NO_REFERRER, channelOf, signupChannel } from "@/lib/channels";

export const DAY_MS = 86_400_000;
export const RANGES = [7, 30, 90] as const;

/** "2026-10-21" (UTC), or "" for a date that doesn't parse. */
export function dayOf(at: string | number): string {
  const t = typeof at === "number" ? at : Date.parse(at);
  return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
}

/** The `days` days ending with today, oldest first. */
export function dayRange(now: number, days: number): string[] {
  const today = Date.parse(dayOf(now));
  return Array.from({ length: days }, (_, i) => dayOf(today - (days - 1 - i) * DAY_MS));
}

/** The visit chart stacks three groups, LinkedIn at the baseline. */
export const VISIT_GROUPS = ["LinkedIn", "Other sites", NO_REFERRER] as const;
const groupOf = (channel: string) => (channel === "LinkedIn" ? 0 : channel === NO_REFERRER ? 2 : 1);

export type DayPoint = {
  day: string;
  visits: number;
  /** Visits per VISIT_GROUPS entry. */
  groups: [number, number, number];
  /** Every channel that day, for the hover card. */
  channels: Counted;
  signups: number;
  active: number;
  briefs: number;
  filed: number;
};

export const METRICS = ["visits", "signups", "active", "briefs", "filed"] as const;
export type Metric = (typeof METRICS)[number];
export type Total = {
  value: number;
  /** The same count over the period before, or null when the log doesn't reach back that far. */
  before: number | null;
};

export type SourceRow = { channel: string; visits: number; signupClicks: number; chromeClicks: number; signups: number };

export type Dashboard = {
  daily: DayPoint[];
  totals: Record<Metric, Total>;
  /** Website visits and what they led to, per channel. */
  sources: SourceRow[];
  /** What people who signed up in the period said in onboarding. */
  heard: Counted;
};

type BriefRow = { user_id: string; created_at: string; ticket_url: string | null; status: string };

/** A ticket or a draft. A raw upload that never became either isn't one (as on /admin). */
const isBrief = (b: BriefRow) => b.status !== "uploaded";

export type DashboardInput = {
  now: number;
  days: number;
  /** site.* events from the start of the period before. */
  site: EventRow[];
  /** Everyone but the owner. */
  people: PersonFacts[];
  /** Signed-in events (who and when) from the start of the period before, owner excluded. */
  seen: { user_id: string; at: string }[];
  /** Every brief row, raw uploads included (they show who was active), owner excluded. */
  briefs: BriefRow[];
  /** The first event ever recorded: counts read from the log start there. */
  logStart: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const visitChannel = (e: EventRow) => channelOf(str(e.props.ref), str(e.props.utm_source));

function tally(values: string[]): Counted {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function dashboardOf(input: DashboardInput): Dashboard {
  const { now, days } = input;
  const range = dayRange(now, days);
  const prev = dayRange(now - days * DAY_MS, days);
  const inRange = new Set(range);
  const inPrev = new Set(prev);
  const index = new Map(range.map((d, i) => [d, i]));

  const daily: DayPoint[] = range.map((day) => ({
    day,
    visits: 0,
    groups: [0, 0, 0],
    channels: [],
    signups: 0,
    active: 0,
    briefs: 0,
    filed: 0,
  }));
  const at = (iso: string) => {
    const i = index.get(dayOf(iso));
    return i === undefined ? null : daily[i];
  };

  // Visits, and the channel of each page load so its clicks can follow it.
  const views = input.site.filter((e) => e.name === "site.view");
  const pvChannel = new Map<string, string>();
  const dayChannels = new Map<string, string[]>();
  for (const v of views) {
    const channel = visitChannel(v);
    if (str(v.props.pv)) pvChannel.set(str(v.props.pv), channel);
    const point = at(v.at);
    if (!point) continue;
    point.visits++;
    point.groups[groupOf(channel)]++;
    dayChannels.set(point.day, [...(dayChannels.get(point.day) ?? []), channel]);
  }
  for (const p of daily) p.channels = tally(dayChannels.get(p.day) ?? []);

  for (const p of input.people) {
    const point = at(p.createdAt);
    if (point) point.signups++;
  }

  const activeByDay = new Map<string, Set<string>>();
  const markActive = (userId: string, iso: string) => {
    const day = dayOf(iso);
    if (!activeByDay.has(day)) activeByDay.set(day, new Set());
    activeByDay.get(day)!.add(userId);
  };
  for (const s of input.seen) markActive(s.user_id, s.at);
  for (const b of input.briefs) {
    markActive(b.user_id, b.created_at);
    const point = at(b.created_at);
    if (!point || !isBrief(b)) continue;
    point.briefs++;
    if (b.ticket_url) point.filed++;
  }
  for (const p of daily) p.active = activeByDay.get(p.day)?.size ?? 0;

  // Totals: this period against the one before.
  const logged = (days: string[]) => !!input.logStart && dayOf(input.logStart) <= days[0];
  const count = <T>(rows: T[], dayOfRow: (r: T) => string, keep: (r: T) => boolean = () => true) => {
    let value = 0;
    let before = 0;
    for (const r of rows) {
      if (!keep(r)) continue;
      const d = dayOfRow(r);
      if (inRange.has(d)) value++;
      else if (inPrev.has(d)) before++;
    }
    return { value, before };
  };
  const distinctUsers = (set: Set<string>) => {
    const ids = new Set<string>();
    for (const [day, users] of activeByDay) if (set.has(day)) for (const u of users) ids.add(u);
    return ids.size;
  };
  const visits = count(views, (v) => dayOf(v.at));
  const signups = count(input.people, (p) => dayOf(p.createdAt));
  const briefs = count(input.briefs, (b) => dayOf(b.created_at), isBrief);
  const filed = count(input.briefs, (b) => dayOf(b.created_at), (b) => !!b.ticket_url);
  const totals: Record<Metric, Total> = {
    visits: { value: visits.value, before: logged(prev) ? visits.before : null },
    signups,
    active: { value: distinctUsers(inRange), before: logged(prev) ? distinctUsers(inPrev) : null },
    briefs,
    filed,
  };

  // Sources: visits, the clicks those page loads made, and measured sign-ups.
  const rows = new Map<string, SourceRow>();
  const row = (channel: string) => {
    if (!rows.has(channel)) rows.set(channel, { channel, visits: 0, signupClicks: 0, chromeClicks: 0, signups: 0 });
    return rows.get(channel)!;
  };
  for (const v of views) if (inRange.has(dayOf(v.at))) row(visitChannel(v)).visits++;
  for (const c of input.site) {
    if (c.name !== "site.click" || !inRange.has(dayOf(c.at))) continue;
    const channel = pvChannel.get(str(c.props.pv)) ?? NO_REFERRER;
    if (c.props.target === "signup") row(channel).signupClicks++;
    if (c.props.target === "chrome") row(channel).chromeClicks++;
  }
  const joined = input.people.filter((p) => inRange.has(dayOf(p.createdAt)));
  for (const p of joined) {
    const channel = signupChannel(p.signup);
    if (channel) row(channel).signups++;
  }
  // Most visits first; "No referrer" last, since it says the least.
  const sources = [...rows.values()].sort(
    (a, b) =>
      Number(a.channel === NO_REFERRER) - Number(b.channel === NO_REFERRER) ||
      b.visits - a.visits ||
      b.signups - a.signups ||
      a.channel.localeCompare(b.channel),
  );

  const answered = tally(joined.map((p) => p.source).filter(Boolean));
  const unanswered = joined.filter((p) => !p.source).length;
  const heard: Counted = unanswered ? [...answered, ["No answer", unanswered]] : answered;

  return { daily, totals, sources, heard };
}
