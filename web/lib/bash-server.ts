import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { lookupNames } from "@/lib/org-server";
import { displayIdentifier, providerOf } from "@/lib/ticket-sync";
import { isUniqueViolation, newShareId } from "@/lib/share-id";
import { FILING_CLAIM_TTL_MS } from "@/lib/brief-filing";
import {
  DAILY_BASH_LIMIT,
  DEFAULT_DURATION,
  HOLDS_BY_DEFAULT,
  MAX_BASH_MEMBERS,
  board,
  isLive,
  personActive,
  personEnd,
  phaseOf,
  type BashMemberRow,
  type BashPhase,
} from "@/lib/bash";

/**
 * Quality competitions, read and written with the service-role client. Every entry point
 * takes the signed-in user's id from the route's own auth() call.
 *
 * A quality competition has a start date, an end date and a duration. It is reached by
 * its link code alone: whoever holds the link and is signed in may look and
 * join, before it opens or while it is open. Joining shows your name to the
 * others in it. The duration is each person's own clock: it starts when THEY
 * press Start, while the quality competition is open (bash_members.started_at).
 *
 * A brief counts for a quality competition when it was sent with the popup's button set
 * to it (a row in bash_briefs, written as it is filed or drafted), which the
 * popup only offers while that person's own clock runs. Being in one never
 * sweeps in everything a person reports.
 *
 * A quality competition that HOLDS keeps those briefs as drafts, to be grouped and filed
 * by whoever created it once it is closed (the review, bash-review-server.ts).
 * One that doesn't lets each be filed as usual, with its name as a label.
 */

export type BashRow = {
  id: string;
  code: string;
  name: string;
  created_by: string;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
  hold: boolean;
  grouped_at: string | null;
  /** The time each person gets, in minutes. */
  minutes: number | null;
};
const BASH_COLUMNS = "id, code, name, created_by, starts_at, ends_at, ended_at, hold, grouped_at, minutes";
const minutesOf = (b: BashRow) => b.minutes ?? DEFAULT_DURATION;

/** Briefs that count: written up or on their way. A raw upload is not one yet. */
const COUNTED = ["filed", "drafted", "processing", "failed"];

export type BashPerson = {
  /** Stable and opaque (not the user id): keys the board's rows, which move as ranks change. */
  key: string;
  name: string;
  imageUrl?: string;
  isYou: boolean;
  count: number;
  rank: number;
  /** When their own time runs out (or ran out). Null while they have joined but not started. */
  endsAt: string | null;
};

export type BashBrief = {
  id: string;
  title: string;
  /** Index into `people`. */
  by: number;
  createdAt: string;
  /** The brief's public page, when it has one. */
  shareId?: string;
  /** The tracker id, when it is filed and has a readable one. */
  ticket?: string;
  /** The tracker's own state name, when filed. */
  state?: string;
  stateColor?: string;
};

/** One report in the review: a brief, who made it, and whether it is still being written up. */
export type ReviewItem = {
  id: string;
  title: string;
  /** Index into `people`. */
  by: number;
  shareId?: string;
  writing: boolean;
  /** Its write-up failed: nothing to file from until it is written again. */
  unwritten: boolean;
};

export type ReviewGroup = {
  id: string;
  title: string;
  reports: ReviewItem[];
  /** A ticket is being created for it right now. */
  filing: boolean;
  /** The ticket it became. */
  ticket?: { url: string; identifier?: string };
  /** Why the last try to file it failed. */
  error?: string;
};

/** The review of a quality competition that held its reports, for whoever created it. */
export type BashReview = {
  /** The reports have been put in groups. Until then there is nothing to review. */
  grouped: boolean;
  groups: ReviewGroup[];
  /** Reports left out of every ticket. */
  dropped: ReviewItem[];
};

export type BashSnapshot = {
  /** The server clock when this was read, so a browser with a wrong clock still counts down right. */
  now: number;
  code: string;
  name: string;
  /** The time each person gets, in minutes. */
  minutes: number;
  /** Reports are held as drafts until the review. */
  hold: boolean;
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
  /** You created it, so you may close it and review it. */
  isOwner: boolean;
  /** You are in it. */
  joined: boolean;
  /** When your own time runs out (or ran out), once you have pressed Start. */
  yourEndsAt: string | null;
  people: BashPerson[];
  /** Newest first. */
  briefs: BashBrief[];
  /** Only for whoever created it, once it is closed, when it holds. */
  review?: BashReview;
};

/** Where you stand in a quality competition: not in it, in it, your clock running, or your time used. */
export type YourPart = "none" | "joined" | "testing" | "done";

export type BashListItem = {
  code: string;
  name: string;
  /** The time each person gets, in minutes. */
  minutes: number;
  startsAt: string;
  endsAt: string;
  endedAt: string | null;
  phase: BashPhase;
  people: number;
  you: YourPart;
  /** You created it. */
  mine: boolean;
};

export const timesOf = (b: BashRow) => ({ startsAt: b.starts_at, endsAt: b.ends_at, endedAt: b.ended_at });

export type CreateBashResult = { ok: true; code: string } | { ok: false; reason: "limit" | "error" };

/**
 * Create a quality competition open from `startsAt` to `endsAt` (already checked by
 * cleanWindow), giving each person `minutes` of their own. Its creator joins
 * it, like anyone else would; nobody's clock starts here. `hold` says whether
 * its reports wait for a review; left out, they do.
 */
export async function createBash(
  userId: string,
  name: string,
  minutes: number,
  window: { startsAt: string; endsAt: string },
  hold?: boolean,
): Promise<CreateBashResult> {
  const db = createAdminSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db
    .from("bashes")
    .select("id", { count: "exact", head: true })
    .eq("created_by", userId)
    .gte("created_at", since);
  if (recent.error) return { ok: false, reason: "error" };
  if ((recent.count ?? 0) >= DAILY_BASH_LIMIT) return { ok: false, reason: "limit" };

  // A code clash is one in 2^72; one more try covers it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await db
      .from("bashes")
      .insert({
        code: newShareId(),
        name,
        created_by: userId,
        starts_at: window.startsAt,
        ends_at: window.endsAt,
        minutes,
        hold: hold ?? HOLDS_BY_DEFAULT,
      })
      .select("id, code")
      .single();
    if (isUniqueViolation(error)) continue;
    if (error || !data) return { ok: false, reason: "error" };
    const member = await db.from("bash_members").insert({ bash_id: data.id, user_id: userId });
    if (member.error) return { ok: false, reason: "error" };
    return { ok: true, code: data.code };
  }
  return { ok: false, reason: "error" };
}

export async function findBash(code: string, db?: SupabaseClient): Promise<BashRow | null> {
  const { data, error } = await (db ?? createAdminSupabase()).from("bashes").select(BASH_COLUMNS).eq("code", code).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BashRow | null) ?? null;
}

export type JoinResult = "ok" | "missing" | "ended" | "full" | "error";

/** Join a quality competition that is upcoming or open. Joining twice changes nothing. */
export async function joinBash(userId: string, code: string): Promise<JoinResult> {
  const bash = await findBash(code);
  if (!bash) return "missing";
  if (!isLive(timesOf(bash), Date.now())) return "ended";

  const db = createAdminSupabase();
  const size = await db.from("bash_members").select("user_id", { count: "exact", head: true }).eq("bash_id", bash.id);
  if (size.error) return "error";
  if ((size.count ?? 0) >= MAX_BASH_MEMBERS) return "full";

  const { error } = await db
    .from("bash_members")
    .upsert({ bash_id: bash.id, user_id: userId }, { onConflict: "bash_id,user_id", ignoreDuplicates: true });
  return error ? "error" : "ok";
}

export type StartResult = "ok" | "missing" | "upcoming" | "ended" | "full" | "error";

/**
 * Start your own time in an open quality competition, joining it first if you had not.
 * Starting twice changes nothing: the clock is never reset.
 */
export async function startBash(userId: string, code: string): Promise<StartResult> {
  const bash = await findBash(code);
  if (!bash) return "missing";
  const phase = phaseOf(timesOf(bash), Date.now());
  if (phase === "upcoming") return "upcoming";
  if (phase === "closed") return "ended";

  const joined = await joinBash(userId, code);
  if (joined !== "ok") return joined;
  const { error } = await createAdminSupabase()
    .from("bash_members")
    .update({ started_at: new Date().toISOString() })
    .eq("bash_id", bash.id)
    .eq("user_id", userId)
    .is("started_at", null);
  return error ? "error" : "ok";
}

/** Leave a quality competition you joined. Once your time has started you stay on its board. */
export async function leaveBash(userId: string, code: string): Promise<"ok" | "missing" | "started" | "error"> {
  const bash = await findBash(code);
  if (!bash) return "missing";
  const db = createAdminSupabase();
  const mine = await db.from("bash_members").select("started_at").eq("bash_id", bash.id).eq("user_id", userId).maybeSingle();
  if (mine.error) return "error";
  if (!mine.data) return "ok";
  if ((mine.data as { started_at: string | null }).started_at) return "started";
  const { error } = await db.from("bash_members").delete().eq("bash_id", bash.id).eq("user_id", userId).is("started_at", null);
  return error ? "error" : "ok";
}

/** Close a quality competition now. Only whoever created it may; for anyone else it is missing. */
export async function endBash(userId: string, code: string): Promise<"ok" | "missing" | "error"> {
  const bash = await findBash(code);
  if (!bash || bash.created_by !== userId) return "missing";
  if (!isLive(timesOf(bash), Date.now())) return "ok";
  const { error } = await createAdminSupabase()
    .from("bashes")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", bash.id)
    .is("ended_at", null);
  return error ? "error" : "ok";
}

/**
 * Delete a quality competition for good. Only whoever created it may; for anyone else it
 * is missing. Its people, its review groups and the marks on its reports go
 * with it (the database cascades them). The reports themselves stay with who
 * sent them: a held one is a draft in their Tickets, a filed one keeps its
 * ticket.
 */
export async function deleteBash(userId: string, code: string): Promise<"ok" | "missing" | "error"> {
  const bash = await findBash(code);
  if (!bash || bash.created_by !== userId) return "missing";
  const { error } = await createAdminSupabase().from("bashes").delete().eq("id", bash.id).eq("created_by", userId);
  return error ? "error" : "ok";
}

/**
 * The open quality competition in which this person's own clock is running, if any: what
 * the brief they are sending right now can count for, and whether it is then
 * held for a review or filed with the quality competition's label. In several at once,
 * one that holds wins, then the one started last.
 */
export async function runningBashOf(
  userId: string,
  db?: SupabaseClient,
): Promise<{ id: string; name: string; hold: boolean; /** When their own time runs out. */ endsAt: number } | null> {
  const admin = db ?? createAdminSupabase();
  const mine = await admin.from("bash_members").select("bash_id, started_at").eq("user_id", userId).not("started_at", "is", null);
  if (mine.error || !mine.data?.length) return null;
  const started = new Map((mine.data as { bash_id: string; started_at: string }[]).map((m) => [m.bash_id, m.started_at]));
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("bashes")
    .select(BASH_COLUMNS)
    .in("id", [...started.keys()])
    .is("ended_at", null)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso);
  if (error || !data?.length) return null;
  // Only while their own time runs.
  const now = Date.now();
  const active = (data as BashRow[]).filter((b) => personActive(timesOf(b), started.get(b.id)!, minutesOf(b), now));
  if (!active.length) return null;
  const best = active.sort(
    (a, b) => Number(b.hold) - Number(a.hold) || (started.get(b.id) ?? "").localeCompare(started.get(a.id) ?? ""),
  )[0];
  return { id: best.id, name: best.name, hold: best.hold, endsAt: personEnd(timesOf(best), started.get(best.id)!, minutesOf(best)) };
}

/** Mark a brief as part of a quality competition. Marking it twice changes nothing; a brief is in one quality competition only. */
export async function markForBash(bashId: string, briefId: string, db?: SupabaseClient): Promise<void> {
  await (db ?? createAdminSupabase())
    .from("bash_briefs")
    .upsert({ brief_id: briefId, bash_id: bashId }, { onConflict: "brief_id", ignoreDuplicates: true });
}

export type CountedBrief = {
  id: string;
  userId: string;
  createdAt: string;
  title: string | null;
  ticket_title: string | null;
  ticket_body: string | null;
  share_id: string | null;
  status: string;
  ticket_identifier: string | null;
  ticket_url: string | null;
  ticket_provider: string | null;
  ticket_state_name: string | null;
  ticket_state_color: string | null;
};

type Member = BashMemberRow & { startedAt: string | null };

/**
 * Is this brief one a quality competition holds for its review? Then a failed write-up is
 * written again, never filed around the review.
 */
export async function heldByBash(briefId: string, db?: SupabaseClient): Promise<boolean> {
  const admin = db ?? createAdminSupabase();
  const marks = await admin.from("bash_briefs").select("bash_id").eq("brief_id", briefId).limit(20);
  const ids = ((marks.data ?? []) as { bash_id: string }[]).map((m) => m.bash_id);
  if (ids.length === 0) return false;
  const held = await admin.from("bashes").select("id").in("id", ids).eq("hold", true).limit(1);
  return (held.data ?? []).length > 0;
}

/** Who is in a quality competition and the briefs sent to it, newest first. */
export async function loadCounted(bash: BashRow, db?: SupabaseClient): Promise<{ members: Member[]; briefs: CountedBrief[] }> {
  const admin = db ?? createAdminSupabase();
  const memberRows = await admin.from("bash_members").select("user_id, joined_at, started_at").eq("bash_id", bash.id);
  if (memberRows.error) throw new Error(memberRows.error.message);
  const members: Member[] = ((memberRows.data ?? []) as { user_id: string; joined_at: string; started_at: string | null }[]).map((m) => ({
    userId: m.user_id,
    joinedAt: m.joined_at,
    startedAt: m.started_at,
  }));

  const marked = await admin.from("bash_briefs").select("brief_id").eq("bash_id", bash.id).limit(2000);
  if (marked.error) throw new Error(marked.error.message);
  const ids = ((marked.data ?? []) as { brief_id: string }[]).map((r) => r.brief_id);
  if (ids.length === 0) return { members, briefs: [] };

  // In lots: a long list of ids in one request's URL has a limit.
  const lots: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) lots.push(ids.slice(i, i + 100));
  const parts = await Promise.all(lots.map((lot) => countedRows(admin, lot)));
  const briefs = parts.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { members, briefs };
}

async function countedRows(admin: SupabaseClient, ids: string[]): Promise<CountedBrief[]> {
  const rows = await admin
    .from("briefs")
    .select(
      "id, user_id, created_at, title, ticket_title, ticket_body, share_id, status, ticket_identifier, ticket_url, ticket_provider, ticket_state_name, ticket_state_color",
    )
    .in("id", ids)
    .in("status", COUNTED)
    .is("archived_at", null);
  if (rows.error) throw new Error(rows.error.message);
  return ((rows.data ?? []) as (Omit<CountedBrief, "userId" | "createdAt"> & { user_id: string; created_at: string })[]).map(
    ({ user_id, created_at, ...b }) => ({ ...b, userId: user_id, createdAt: created_at }),
  );
}

const titleOf = (b: CountedBrief) => b.ticket_title || b.title || "Untitled";

/** The quality competition as its page shows it: the board and what was found. Null when no such quality competition. */
export async function loadBash(code: string, viewerId: string): Promise<BashSnapshot | null> {
  const db = createAdminSupabase();
  const bash = await findBash(code, db);
  if (!bash) return null;

  const { members, briefs: counted } = await loadCounted(bash, db);
  const memberIds = members.map((m) => m.userId);
  const names = await lookupNames(memberIds);
  const times = timesOf(bash);
  const endOfTime = (m: Member | undefined) =>
    m?.startedAt ? new Date(personEnd(times, m.startedAt, minutesOf(bash))).toISOString() : null;
  const memberOf = new Map(members.map((m) => [m.userId, m]));

  const rows = board(members, counted);
  const indexOf = new Map(rows.map((r, i) => [r.userId, i]));
  const people: BashPerson[] = rows.map((r) => ({
    key: createHash("sha256").update(`${bash.code}:${r.userId}`).digest("hex").slice(0, 12),
    name: names.get(r.userId)?.fullName ?? "someone",
    imageUrl: names.get(r.userId)?.imageUrl,
    isYou: r.userId === viewerId,
    count: r.count,
    rank: r.rank,
    endsAt: endOfTime(memberOf.get(r.userId)),
  }));

  const briefs: BashBrief[] = counted.map((b) => {
    const filed = b.status === "filed";
    const provider = providerOf(b.ticket_url, b.ticket_provider);
    return {
      id: b.id,
      title: titleOf(b),
      by: indexOf.get(b.userId) ?? 0,
      createdAt: b.createdAt,
      shareId: b.share_id ?? undefined,
      ticket: (filed && displayIdentifier(b.ticket_identifier, provider)) || undefined,
      state: filed ? (b.ticket_state_name ?? undefined) : undefined,
      stateColor: filed ? (b.ticket_state_color ?? undefined) : undefined,
    };
  });

  const now = Date.now();
  const isOwner = bash.created_by === viewerId;
  const over = !isLive(times, now);
  return {
    now,
    code: bash.code,
    name: bash.name,
    minutes: minutesOf(bash),
    hold: bash.hold,
    startsAt: bash.starts_at,
    endsAt: bash.ends_at,
    endedAt: bash.ended_at,
    isOwner,
    joined: memberOf.has(viewerId),
    yourEndsAt: endOfTime(memberOf.get(viewerId)),
    people,
    briefs,
    review: isOwner && bash.hold && over ? await loadReview(db, bash, counted, indexOf, now) : undefined,
  };
}

type GroupRow = {
  id: string;
  title: string;
  position: number;
  ticket_url: string | null;
  ticket_identifier: string | null;
  ticket_provider: string | null;
  filing_started_at: string | null;
  error: string | null;
};

async function loadReview(
  db: SupabaseClient,
  bash: BashRow,
  counted: CountedBrief[],
  indexOf: Map<string, number>,
  now: number,
): Promise<BashReview> {
  if (!bash.grouped_at) return { grouped: false, groups: [], dropped: [] };
  const [groupRows, placeRows] = await Promise.all([
    db
      .from("bash_groups")
      .select("id, title, position, ticket_url, ticket_identifier, ticket_provider, filing_started_at, error")
      .eq("bash_id", bash.id)
      .order("position")
      .order("created_at"),
    db.from("bash_briefs").select("brief_id, group_id, dropped").eq("bash_id", bash.id),
  ]);
  if (groupRows.error) throw new Error(groupRows.error.message);
  if (placeRows.error) throw new Error(placeRows.error.message);

  const byId = new Map(counted.map((b) => [b.id, b]));
  const item = (b: CountedBrief): ReviewItem => ({
    id: b.id,
    title: titleOf(b),
    by: indexOf.get(b.userId) ?? 0,
    shareId: b.share_id ?? undefined,
    writing: b.status === "processing" && !b.ticket_body,
    unwritten: b.status === "failed" && !b.ticket_body && !b.ticket_url,
  });
  const inGroup = new Map<string, ReviewItem[]>();
  const dropped: ReviewItem[] = [];
  // Oldest first inside a group: the order people found it in.
  const places = (placeRows.data ?? []) as { brief_id: string; group_id: string | null; dropped: boolean }[];
  for (const p of places.sort((a, b) => (byId.get(a.brief_id)?.createdAt ?? "").localeCompare(byId.get(b.brief_id)?.createdAt ?? ""))) {
    const b = byId.get(p.brief_id);
    if (!b) continue;
    if (p.dropped || !p.group_id) dropped.push(item(b));
    else inGroup.set(p.group_id, [...(inGroup.get(p.group_id) ?? []), item(b)]);
  }

  const groups: ReviewGroup[] = ((groupRows.data ?? []) as GroupRow[])
    .map((g) => {
      const provider = providerOf(g.ticket_url, g.ticket_provider);
      return {
        id: g.id,
        title: g.title,
        reports: inGroup.get(g.id) ?? [],
        filing: !g.ticket_url && !!g.filing_started_at && now - new Date(g.filing_started_at).getTime() < FILING_CLAIM_TTL_MS,
        ticket: g.ticket_url
          ? { url: g.ticket_url, identifier: displayIdentifier(g.ticket_identifier, provider) || undefined }
          : undefined,
        error: g.error ?? undefined,
      };
    })
    // A group emptied by moving its reports away is gone, unless it is a ticket already.
    .filter((g) => g.reports.length > 0 || g.ticket);
  // The claim is taken before the model is asked: until the groups are saved,
  // no group exists and no report has a place. That is still "grouping".
  const pending = (groupRows.data ?? []).length === 0 && places.some((p) => !p.dropped && !p.group_id && byId.has(p.brief_id));
  if (pending) return { grouped: false, groups: [], dropped: [] };
  return { grouped: true, groups, dropped };
}

/** Closed quality competitions stay on the list this long. */
const KEEP_CLOSED_DAYS = 30;
const ORDER: Record<BashPhase, number> = { open: 0, upcoming: 1, closed: 2 };

/**
 * The quality competitions this person can take part in or has: the ones they created
 * or joined, and the ones people of their team created. "Their team" is the
 * tracker workspace Brief already knows they share (org_members). Open ones
 * first, then upcoming (soonest first), then the closed ones of the last
 * month (latest first).
 */
export async function listBashes(userId: string): Promise<BashListItem[]> {
  const db = createAdminSupabase();
  const [mine, me] = await Promise.all([
    db.from("bash_members").select("bash_id, started_at").eq("user_id", userId),
    db.from("org_members").select("org_key").eq("user_id", userId).maybeSingle(),
  ]);
  if (mine.error) throw new Error(mine.error.message);
  const part = new Map(((mine.data ?? []) as { bash_id: string; started_at: string | null }[]).map((m) => [m.bash_id, m.started_at]));

  let creators = [userId];
  const orgKey = (me.data as { org_key: string } | null)?.org_key;
  if (orgKey) {
    const mates = await db.from("org_members").select("user_id").eq("org_key", orgKey).limit(500);
    creators = [...new Set([userId, ...((mates.data ?? []) as { user_id: string }[]).map((m) => m.user_id)])];
  }

  const since = new Date(Date.now() - KEEP_CLOSED_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const select = `${BASH_COLUMNS}, bash_members(count)`;
  const [made, joined] = await Promise.all([
    db.from("bashes").select(select).in("created_by", creators).gte("ends_at", since).order("starts_at", { ascending: false }).limit(60),
    part.size
      ? db.from("bashes").select(select).in("id", [...part.keys()]).gte("ends_at", since).order("starts_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (made.error) throw new Error(made.error.message);
  if (joined.error) throw new Error(joined.error.message);

  type Row = BashRow & { bash_members: { count: number }[] | null };
  const rows = new Map<string, Row>();
  for (const r of [...((made.data ?? []) as unknown as Row[]), ...((joined.data ?? []) as unknown as Row[])]) rows.set(r.id, r);

  const now = Date.now();
  return [...rows.values()]
    .map((b): BashListItem => {
      const times = timesOf(b);
      const startedAt = part.get(b.id);
      const you: YourPart = !part.has(b.id) ? "none" : !startedAt ? "joined" : personActive(times, startedAt, minutesOf(b), now) ? "testing" : "done";
      return {
        code: b.code,
        name: b.name,
        minutes: minutesOf(b),
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        endedAt: b.ended_at,
        phase: phaseOf(times, now),
        people: b.bash_members?.[0]?.count ?? 0,
        you,
        mine: b.created_by === userId,
      };
    })
    .sort(
      (a, b) =>
        ORDER[a.phase] - ORDER[b.phase] ||
        (a.phase === "upcoming" ? a.startsAt.localeCompare(b.startsAt) : (b.endedAt ?? b.endsAt).localeCompare(a.endedAt ?? a.endsAt)),
    );
}
