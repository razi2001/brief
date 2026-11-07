import { clerkClient, type User } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { connectedProviders } from "@/lib/trackers/registry";
import { signupSource } from "@/lib/signup-source";
import {
  nudgeSummary,
  siteSummary,
  timelineOf,
  type EventRow,
  type NudgeSummary,
  type PersonFacts,
  type SiteSummary,
  type TimelineItem,
} from "@/lib/activity";
import { DAY_MS, dashboardOf, dayRange, type Dashboard } from "@/lib/activity-stats";
import { isAdminEmail } from "@/lib/admin-view";

// Reads for /admin/activity. Like lib/admin-server, these see EVERY user: the
// pages call requireAdmin() before any of them.

const MAX_USERS = 500;
const PAGE = 1000;
// "Last seen" only looks back this far in the event log.
const SEEN_DAYS = 90;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Every row of a query, a page at a time (PostgREST caps one answer). */
async function allRows<T>(page: (from: number, to: number) => Page<T>, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const latest = (...dates: (string | null | undefined)[]) =>
  dates.filter((d): d is string => !!d).sort().at(-1) ?? null;

type Rows = {
  tokens: { user_id: string; revoked_at: string | null }[];
  owned: { user_id: string }[];
  briefs: { user_id: string; ticket_url: string | null; created_at: string; status: string }[];
  seen: { user_id: string; at: string }[];
};

function factsOf(u: User, rows: Rows): PersonFacts {
  const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
  const mine = <T extends { user_id: string }>(list: T[]) => list.filter((r) => r.user_id === u.id);
  const tokens = mine(rows.tokens);
  const briefs = mine(rows.briefs);
  return {
    id: u.id,
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || email?.split("@")[0] || "",
    email,
    image: u.hasImage ? u.imageUrl : null,
    createdAt: iso(u.createdAt) ?? "",
    // unsafeMetadata is writable from the browser: cleaned again on the way out.
    signup: signupSource((u.unsafeMetadata?.signup ?? {}) as Record<string, string>),
    role: String(u.privateMetadata?.role ?? ""),
    source: String(u.privateMetadata?.source ?? ""),
    trackers: mine(rows.owned).length + connectedProviders(u).length,
    extension: tokens.some((t) => !t.revoked_at),
    briefs: briefs.length,
    filed: briefs.filter((b) => b.ticket_url).length,
    // Things the person did. Not the token's last_used_at: the extension
    // touches it in the background as they browse (the Replay sites sync on
    // page loads). Not Clerk's lastActiveAt either: an open tab keeps it
    // fresh. Page views and popup opens are events.
    lastSeen: latest(iso(u.lastSignInAt), mine(rows.seen)[0]?.at, ...briefs.map((b) => b.created_at)),
    admin: isAdminEmail(u.emailAddresses),
  };
}

async function loadRows(userId?: string): Promise<Rows> {
  const db = createAdminSupabase();
  const seenSince = new Date(Date.now() - SEEN_DAYS * 86_400_000).toISOString();
  // One person's rows, or everyone's.
  const ids = userId ? [userId] : null;
  const [tokens, owned, briefs, seen] = await Promise.all([
    allRows<Rows["tokens"][number]>((a, b) => {
      const q = db.from("extension_tokens").select("user_id, revoked_at");
      return (ids ? q.in("user_id", ids) : q).range(a, b);
    }),
    allRows<Rows["owned"][number]>((a, b) => {
      const q = db.from("tracker_connections").select("user_id");
      return (ids ? q.in("user_id", ids) : q).range(a, b);
    }),
    allRows<Rows["briefs"][number]>((a, b) => {
      const q = db.from("briefs").select("user_id, ticket_url, created_at, status");
      return (ids ? q.in("user_id", ids) : q).range(a, b);
    }),
    allRows<Rows["seen"][number]>((a, b) => {
      // The extension opening its reminder is not something the person did.
      const q = db
        .from("events")
        .select("user_id, at")
        .not("user_id", "is", null)
        .neq("name", "nudge.shown")
        .gte("at", seenSince);
      return (ids ? q.in("user_id", ids) : q).order("at", { ascending: false }).range(a, b);
    }, 20_000),
  ]);
  return { tokens, owned, briefs, seen };
}

/** Everyone, newest sign-up first, and the rows their facts came from. */
export async function loadPeople(): Promise<{ people: PersonFacts[]; rows: Rows }> {
  const client = await clerkClient();
  const [list, rows] = await Promise.all([
    client.users.getUserList({ limit: MAX_USERS, orderBy: "-created_at" }),
    loadRows(),
  ]);
  return { people: list.data.map((u) => factsOf(u, rows)), rows };
}

/** One person's facts and timeline, or null for an unknown id. */
export async function loadPerson(
  userId: string,
): Promise<{ person: PersonFacts; items: TimelineItem[]; now: number } | null> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId).catch(() => null);
  if (!user) return null;
  const db = createAdminSupabase();
  const [rows, tokens, briefs, events, first] = await Promise.all([
    loadRows(userId),
    db.from("extension_tokens").select("created_at").eq("user_id", userId),
    db.from("briefs").select("created_at, ticket_url, ticket_provider, updated_at").eq("user_id", userId),
    allRows<EventRow>(
      (a, b) =>
        db.from("events").select("at, name, props").eq("user_id", userId).order("at", { ascending: false }).range(a, b),
      5_000,
    ),
    loadLogStart(),
  ]);
  const person = factsOf(user, rows);
  return {
    person,
    now: Date.now(),
    items: timelineOf({
      createdAt: person.createdAt,
      signup: person.signup,
      events,
      tokens: (tokens.data ?? []) as { created_at: string }[],
      briefs: (briefs.data ?? []) as Parameters<typeof timelineOf>[0]["briefs"],
      since: first,
    }),
  };
}

/** get-brief.app's events since `since`. */
async function loadSiteEvents(since: string): Promise<EventRow[]> {
  const db = createAdminSupabase();
  return allRows<EventRow>((a, b) =>
    db.from("events").select("at, name, props").like("name", "site.%").gte("at", since).order("at").range(a, b),
  );
}

/** The extension's reminder popup since `since`, and the briefs it brought. */
async function loadNudgeEvents(since: string): Promise<(EventRow & { user_id: string | null })[]> {
  type Row = EventRow & { user_id: string | null };
  const db = createAdminSupabase();
  const events = () => db.from("events").select("user_id, at, name, props").gte("at", since);
  const [card, briefs] = await Promise.all([
    allRows<Row>((a, b) => events().like("name", "nudge.%").order("at").range(a, b)),
    allRows<Row>((a, b) => events().eq("name", "brief.created").eq("props->>via", "nudge").order("at").range(a, b)),
  ]);
  return [...card, ...briefs];
}

/** How far back the reminder's numbers look, whatever the page's period. */
const NUDGE_DAYS = 30;

/** Who did something while signed in, from `since`. */
async function loadSeen(since: string): Promise<{ user_id: string; at: string }[]> {
  const db = createAdminSupabase();
  return allRows<{ user_id: string; at: string }>((a, b) =>
    db.from("events").select("user_id, at").not("user_id", "is", null).gte("at", since).order("at").range(a, b),
  );
}

async function loadLogStart(): Promise<string | null> {
  const { data } = await createAdminSupabase().from("events").select("at").order("at").limit(1).maybeSingle();
  return (data as { at: string } | null)?.at ?? null;
}

/**
 * The list page: everyone, get-brief.app over the last `days` days, and the
 * charts. Charts read from the start of the period before, to compare.
 */
export async function loadActivity(
  days: number,
): Promise<{ people: PersonFacts[]; site: SiteSummary; dashboard: Dashboard; nudge: NudgeSummary; now: number }> {
  const now = Date.now();
  const start = Date.parse(dayRange(now, days)[0]);
  const from = new Date(start - days * DAY_MS).toISOString();
  const nudgeSince = now - NUDGE_DAYS * DAY_MS;
  const [{ people, rows }, events, seen, logStart, nudgeEvents] = await Promise.all([
    loadPeople(),
    loadSiteEvents(from),
    loadSeen(from),
    loadLogStart(),
    loadNudgeEvents(new Date(nudgeSince).toISOString()),
  ]);
  const owner = new Set(people.filter((p) => p.admin).map((p) => p.id));
  const dashboard = dashboardOf({
    now,
    days,
    site: events,
    people: people.filter((p) => !owner.has(p.id)),
    seen: seen.filter((s) => !owner.has(s.user_id)),
    briefs: rows.briefs.filter((b) => !owner.has(b.user_id)),
    logStart,
  });
  return { people, site: siteSummary(events, start), dashboard, nudge: nudgeSummary(nudgeEvents, nudgeSince), now };
}
