// The owner's /admin/activity, as pure functions: the sign-up funnel, one
// person's timeline and the website's numbers. lib/activity-server.ts loads
// the rows; nothing here touches Clerk or the database.

import { channelOf } from "@/lib/channels";
import { PROVIDER_LABELS, type ProviderKey } from "@/lib/provider-labels";
import type { SignupSource } from "@/lib/signup-source";

export type EventRow = { at: string; name: string; props: Record<string, unknown> };

/** What one account has now, from Clerk and the tables. */
export type PersonFacts = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  createdAt: string;
  signup: SignupSource | null;
  role: string;
  source: string;
  /** Tracker connections, Brief's own plus any left on Clerk. */
  trackers: number;
  extension: boolean;
  briefs: number;
  filed: number;
  lastSeen: string | null;
  /** The owner: listed, but left out of the charts. */
  admin: boolean;
};

export const FUNNEL = [
  { key: "about", label: "About you" },
  { key: "tracker", label: "Tracker" },
  { key: "extension", label: "Extension" },
  { key: "brief", label: "First brief" },
  { key: "filed", label: "Filed" },
] as const;
export type FunnelKey = (typeof FUNNEL)[number]["key"];

/**
 * Read from current state rather than events, so people who signed up before
 * the activity log existed still place in the funnel.
 */
export function funnelOf(p: PersonFacts): Record<FunnelKey, boolean> {
  return {
    about: !!(p.role || p.source),
    tracker: p.trackers > 0,
    extension: p.extension,
    brief: p.briefs > 0,
    filed: p.filed > 0,
  };
}

export function funnelCounts(people: PersonFacts[]): Record<FunnelKey, number> {
  const out = { about: 0, tracker: 0, extension: 0, brief: 0, filed: 0 };
  for (const p of people) {
    const f = funnelOf(p);
    for (const k of Object.keys(out) as FunnelKey[]) if (f[k]) out[k]++;
  }
  return out;
}

/** "now", "5m", "3h", "2d", then a date. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 30 * 86_400) return `${Math.round(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function sourceLine(s: SignupSource | null): string {
  if (!s) return "";
  return [
    s.src && `${s.src} button`,
    (s.ref || s.utm_source) && `from ${channelOf(s.ref, s.utm_source)}`,
    (s.utm_medium || s.utm_campaign) && `utm ${[s.utm_medium, s.utm_campaign].filter(Boolean).join(" / ")}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export type LineKind = "signup" | "onboarding" | "tracker" | "extension" | "brief" | "page" | "demo";
export type TimelineItem = { at: string; kind: LineKind; text: string; bad?: boolean; count?: number };
type Line = Omit<TimelineItem, "at" | "count">;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const tracker = (v: unknown) => PROVIDER_LABELS[str(v) as ProviderKey] ?? (str(v) || "a tracker");

/** One plain line per event, or null for a name this page doesn't know. */
export function lineOf(e: Pick<EventRow, "name" | "props">): Line | null {
  const p = e.props;
  switch (e.name) {
    case "onboarding.about": {
      const parts = [str(p.role), str(p.source) && `heard from ${str(p.source)}`].filter(Boolean);
      return { kind: "onboarding", text: `About you: ${parts.join(", ") || "left blank"}` };
    }
    case "onboarding.step":
      return { kind: "onboarding", text: `Onboarding: ${str(p.step)} step` };
    case "onboarding.finished":
      return { kind: "onboarding", text: "Finished onboarding" };
    case "onboarding.demo":
      return { kind: "demo", text: `Demo: ${str(p.act)}` };
    case "page.view":
      return { kind: "page", text: `Opened ${str(p.path)}` };
    case "tracker.connect_start":
      return { kind: "tracker", text: `Started connecting ${tracker(p.provider)}` };
    case "tracker.connected":
      return { kind: "tracker", text: `Connected ${tracker(p.provider)}` };
    case "tracker.connect_failed": {
      const why = [str(p.code), str(p.reason)].filter(Boolean).join(": ");
      return { kind: "tracker", text: `Connecting ${tracker(p.provider)} failed${why ? ` (${why})` : ""}`, bad: true };
    }
    case "tracker.disconnected":
      return { kind: "tracker", text: `Disconnected ${tracker(p.provider)}` };
    case "extension.paired":
      return { kind: "extension", text: "Paired the extension" };
    case "extension.opened":
      return { kind: "extension", text: "Opened the extension popup" };
    case "nudge.shown":
      return { kind: "extension", text: `Brief's popup reminded them${p.replay === true ? " (on a Replay site)" : ""}` };
    case "nudge.brief_it":
      return { kind: "extension", text: "Started a brief from the reminder" };
    case "nudge.closed":
      return { kind: "extension", text: "Closed the reminder" };
    case "brief.created":
      return {
        kind: "brief",
        text: `Created a brief${str(p.kind) ? ` (${str(p.kind)})` : ""}${p.via === "nudge" ? " from the reminder" : ""}`,
      };
    case "brief.file_refused":
      return { kind: "brief", text: "Tried to file with no tracker", bad: true };
    case "brief.filed":
      return { kind: "brief", text: `Filed a ticket to ${tracker(p.provider)}` };
    case "brief.drafted":
      return { kind: "brief", text: "Saved a draft" };
    case "brief.failed":
      return {
        kind: "brief",
        text: `${str(p.stage) === "draft" ? "Draft" : "Filing"} failed: ${str(p.error) || "unknown error"}`,
        bad: true,
      };
    case "brief.stopped":
      return { kind: "brief", text: "Stopped a ticket before it filed" };
    case "brief.retry":
      return { kind: "brief", text: "Retried a brief" };
    case "brief.archived":
      return { kind: "brief", text: p.undo ? "Restored a brief" : "Archived a brief" };
    case "brief.deleted":
      return { kind: "brief", text: "Deleted a brief" };
    case "bash.started":
      return { kind: "brief", text: `Started a quality competition (${str(p.minutes) || "?"} min)` };
    case "bash.joined":
      return { kind: "brief", text: "Joined a quality competition" };
    case "bash.deleted":
      return { kind: "brief", text: "Deleted a quality competition" };
    default:
      return null;
  }
}

type BriefRow = { created_at: string; ticket_url: string | null; ticket_provider: string | null; updated_at: string | null };

/**
 * Newest first, ending with the sign-up. Before `since` (the first event ever
 * recorded) the log has nothing, so extension tokens and briefs fill that
 * history in; after it they are already events. Runs of the same line fold
 * into one with a count.
 */
export function timelineOf(input: {
  createdAt: string;
  signup: SignupSource | null;
  events: EventRow[];
  tokens: { created_at: string }[];
  briefs: BriefRow[];
  since: string | null;
}): TimelineItem[] {
  const before = (at: string | null) => !!at && (!input.since || at < input.since);
  const items: TimelineItem[] = [];
  const src = sourceLine(input.signup);
  items.push({ at: input.createdAt, kind: "signup", text: src ? `Signed up · ${src}` : "Signed up" });
  for (const t of input.tokens) {
    if (before(t.created_at)) items.push({ at: t.created_at, kind: "extension", text: "Paired the extension" });
  }
  for (const b of input.briefs) {
    if (before(b.created_at)) items.push({ at: b.created_at, kind: "brief", text: "Created a brief" });
    const filedAt = b.updated_at ?? b.created_at;
    if (b.ticket_url && before(filedAt)) {
      items.push({ at: filedAt, kind: "brief", text: `Filed a ticket to ${tracker(b.ticket_provider)}` });
    }
  }
  for (const e of input.events) {
    const line = lineOf(e);
    if (line) items.push({ at: e.at, ...line });
  }
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const folded: TimelineItem[] = [];
  for (const item of items) {
    const prev = folded[folded.length - 1];
    if (prev && prev.text === item.text) prev.count = (prev.count ?? 1) + 1;
    else folded.push({ ...item });
  }
  return folded;
}

export type Counted = [string, number][];
/** The website's pages, buttons and demo. Where visits came from is in lib/activity-stats. */
export type SiteSummary = {
  views: number;
  mobile: number;
  pages: Counted;
  clicks: Counted;
  /** Page loads that reached each demo button, in the demo's order. */
  demo: Counted;
};

// What get-brief.app's tracked buttons do.
const CLICK_TARGETS: Record<string, string> = {
  signup: "Sign up",
  chrome: "Add to Chrome",
  video: "Watch video",
  demo: "Try the demo",
  sandbox: "Sandbox",
};

// The hero demo's buttons in the order a visitor meets them.
const DEMO_ORDER = ["start", "brief", "pay", "add", "video", "shot", "replay", "stop", "create", "draft", "goal", "again"];

function tally(values: string[]): Counted {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The website's numbers since `sinceMs`. */
/** What the extension's reminder popup did over a period. */
export type NudgeSummary = { shown: number; briefIt: number; closed: number; noAction: number; briefs: number };

/**
 * The reminder's numbers since `sinceMs`. Each showing ends one way: a brief
 * started, closed, or no action (neither, before that person's next showing
 * or now). `briefs`: briefs created from it (brief.created with `via: "nudge"`).
 */
export function nudgeSummary(events: (EventRow & { user_id: string | null })[], sinceMs: number): NudgeSummary {
  const recent = events
    .filter((e) => Date.parse(e.at) >= sinceMs)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: NudgeSummary = { shown: 0, briefIt: 0, closed: 0, noAction: 0, briefs: 0 };
  // per person: a showing nobody has answered yet
  const waiting = new Map<string, boolean>();
  for (const e of recent) {
    const who = e.user_id ?? "";
    if (e.name === "nudge.shown") {
      if (waiting.get(who)) out.noAction++;
      waiting.set(who, true);
      out.shown++;
    } else if (e.name === "nudge.brief_it") {
      out.briefIt++;
      waiting.set(who, false);
    } else if (e.name === "nudge.closed") {
      out.closed++;
      waiting.set(who, false);
    } else if (e.name === "brief.created" && e.props.via === "nudge") {
      out.briefs++;
    }
  }
  for (const w of waiting.values()) if (w) out.noAction++;
  return out;
}

export function siteSummary(events: EventRow[], sinceMs: number): SiteSummary {
  const recent = events.filter((e) => Date.parse(e.at) >= sinceMs);
  const views = recent.filter((e) => e.name === "site.view");
  const clicks = recent.filter((e) => e.name === "site.click");

  const reached = new Map<string, Set<string>>();
  for (const e of recent) {
    if (e.name !== "site.demo") continue;
    const act = str(e.props.act);
    if (!reached.has(act)) reached.set(act, new Set());
    reached.get(act)!.add(str(e.props.pv) || `${e.at}`);
  }
  const rank = (act: string) => (DEMO_ORDER.includes(act) ? DEMO_ORDER.indexOf(act) : DEMO_ORDER.length);
  const demo: Counted = [...reached]
    .map(([act, pvs]) => [act, pvs.size] as [string, number])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);

  return {
    views: views.length,
    mobile: views.filter((e) => e.props.device === "mobile").length,
    pages: tally(views.map((e) => str(e.props.path) || "/")),
    clicks: tally(
      clicks.map((e) => {
        const target = str(e.props.target);
        return [CLICK_TARGETS[target] ?? target, str(e.props.where)].filter(Boolean).join(" · ");
      }),
    ),
    demo,
  };
}
