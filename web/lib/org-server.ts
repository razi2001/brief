import { cache } from "react";
import { clerkClient } from "@clerk/nextjs/server";
import { connectedTrackers } from "@/lib/trackers/registry";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { orgKey } from "@/lib/org";
import { getLinearOrg } from "@/lib/linear";
import { getJiraAuth, getJiraCloud } from "@/lib/jira";
import { metaWorkspace, readConnectionMeta } from "@/lib/connections";
import { linearToken } from "@/lib/tracker-tokens";
import { getPickedWorkspace } from "@/lib/workspaces";
import { rankReporters, type LeaderRow, type Reporter } from "@/lib/podium";
import { inferMemberships, type ResolvedOrg } from "@/lib/org-infer";
import { summarizeRoi, type RoiSummary } from "@/lib/roi";
import { sortTeam, type TeamMember } from "@/lib/team";
import type { ProviderKey } from "@/lib/tracker";

/**
 * Org identity, resolved from live tracker tokens and cached in Supabase.
 *
 * SECURITY - the one rule this file exists to enforce: an org key is ALWAYS
 * derived here, from a token the server just used. It is never read from a
 * request body, a query param, or any client state. A caller that could name
 * its own org could read any org's leaderboard and rewrite any org's filing
 * rules. Every exported function below takes a userId and resolves the org
 * itself for exactly that reason. A stored workspace pick obeys the same rule:
 * lib/workspaces stores one only after the user's token has shown it can see it.
 */

export type OrgIdentity = { key: string; name: string; provider: ProviderKey };

/** One cached org_members row. */
type CachedMembership = {
  org_key: string;
  org_name: string;
  provider: string;
  resolved_at: string;
};

/**
 * How long a cached membership is trusted before we ask the tracker again.
 * Long enough that it costs nothing on a normal session; short enough that
 * someone who changes workspace lands in the right org the same day.
 */
export const ORG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long we leave an account alone after failing to place it in an org.
 *
 * Plenty of accounts can't resolve: Clerk holds a Linear connection it marks
 * verified but refuses to vend a token for (HTTP 400 - a stale grant the user
 * has to reconnect), or there is no tracker at all. Short enough that someone
 * who reconnects is picked up the same morning, long enough that the hopeless
 * majority aren't retried on every dashboard render.
 */
export const ORG_MISS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * The Linear workspace a token points at. A Brief-held connection stored it at
 * connect time, read off the token then; a Clerk one from before the move to
 * Brief's OAuth, or a Brief one whose read failed, is asked now. Either way the
 * key is the organization's id, so moving from Clerk to Brief keeps the org.
 */
async function linearOrg(userId: string): Promise<{ id: string; name: string } | null> {
  const meta = await readConnectionMeta(userId, "linear");
  const stored = meta && metaWorkspace(meta);
  if (stored) return stored;
  const tok = await linearToken(userId);
  return tok ? getLinearOrg(tok) : null;
}

/**
 * The Jira site that is this user's org. A Brief-held connection's is the site
 * picked for it, and there is none until then: a guess could put the user in
 * a stranger's org. A Clerk connection from before the move keeps its token's
 * first site, as it always has. The key is the site's cloud id either way, so
 * picking the same site after moving keeps the org.
 */
async function jiraOrg(userId: string): Promise<{ id: string; name: string } | null> {
  const meta = await readConnectionMeta(userId, "jira");
  if (meta) return metaWorkspace(meta);
  const tok = await getJiraAuth(userId);
  if (!tok) return null;
  const cloud = await getJiraCloud(tok);
  return cloud ? { id: cloud.cloudId, name: cloud.name ?? "Jira site" } : null;
}

/**
 * Ask each connected tracker which workspace it points at.
 *
 * Order matches PROVIDERS in the registry, so a user with two trackers
 * connected lands in the same org their briefs get filed into.
 */
async function resolveFromTrackers(userId: string): Promise<OrgIdentity | null> {
  // Only ask the trackers this user connected: each ask is a token round trip,
  // and asking every tracker on every page was most of Settings' wait.
  let connected: ProviderKey[];
  try {
    connected = await connectedTrackers(userId);
  } catch {
    // Clerk is down, so its accounts are unknown: try the original three as
    // before. A Brief-held connection doesn't need Clerk to read, so it still
    // counts (null stands for "no Clerk accounts" and skips the Clerk call).
    connected = await connectedTrackers(userId, null)
      .then((owned) => [...new Set<ProviderKey>(["linear", "jira", "github", ...owned])])
      .catch((): ProviderKey[] => ["linear", "jira", "github"]);
  }

  if (connected.includes("linear")) {
    try {
      const org = await linearOrg(userId);
      const key = org && orgKey("linear", org.id);
      if (key && org) return { key, name: org.name, provider: "linear" };
    } catch {
      /* a tracker we can't reach contributes no org, it doesn't break the page */
    }
  }

  if (connected.includes("jira")) {
    try {
      const site = await jiraOrg(userId);
      const key = site && orgKey("jira", site.id);
      if (key && site) return { key, name: site.name, provider: "jira" };
    } catch {
      /* as above */
    }
  }

  // Every other tracker can see several workspaces, so there is nothing to
  // infer from the token alone. We use the one they picked (lib/workspaces;
  // connect already stored a lone one), and without one they have no org -
  // deliberately, rather than being put in a stranger's.
  for (const p of connected) {
    if (p === "linear" || p === "jira") continue;
    try {
      const ws = await getPickedWorkspace(userId, p);
      const key = ws && orgKey(p, ws.id);
      if (key && ws) return { key, name: ws.name, provider: p };
    } catch {
      /* as above */
    }
  }

  return null;
}

/**
 * The user's org: cached when fresh, re-resolved when missing or stale.
 *
 * Best-effort throughout, matching getTrackerContext and resolveTracker: a
 * tracker outage degrades to the cached row, and a cache miss degrades to no
 * org. Neither ever throws out of a render.
 */
// Once per page render: Settings and Home each ask for it from several places.
export const getOrg = cache(async function getOrg(
  userId: string,
  db?: SupabaseClient,
): Promise<OrgIdentity | null> {
  const admin = db ?? createAdminSupabase();

  let cached: CachedMembership | null = null;
  try {
    const { data } = await admin
      .from("org_members")
      .select("org_key, org_name, provider, resolved_at")
      .eq("user_id", userId)
      .maybeSingle();
    cached = (data as CachedMembership | null) ?? null;
  } catch {
    /* fall through to a live resolve */
  }

  const fresh =
    cached && Date.now() - new Date(cached.resolved_at).getTime() < ORG_TTL_MS;
  if (cached && fresh) {
    return {
      key: cached.org_key,
      name: cached.org_name,
      provider: cached.provider as ProviderKey,
    };
  }

  const resolved = await resolveFromTrackers(userId);
  if (!resolved) {
    // Trust a stale cache over nothing: a tracker blip shouldn't empty someone's
    // dashboard. If they genuinely left the workspace, the next successful
    // resolve corrects it.
    if (cached) {
      return {
        key: cached.org_key,
        name: cached.org_name,
        provider: cached.provider as ProviderKey,
      };
    }
    return null;
  }

  try {
    await admin.from("org_members").upsert(
      {
        user_id: userId,
        org_key: resolved.key,
        org_name: resolved.name,
        provider: resolved.provider,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  } catch {
    /* caching is an optimization; the resolved value is still good */
  }
  return resolved;
});

/** Every Brief user known to be in this org. */
// Once per page render (ticket rules, the podium and the headline all count members).
export const getOrgMemberIds = cache(async function getOrgMemberIds(
  orgKeyValue: string,
  db?: SupabaseClient,
): Promise<string[]> {
  const admin = db ?? createAdminSupabase();
  try {
    const { data } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_key", orgKeyValue);
    return (data ?? []).map((r: { user_id: string }) => r.user_id);
  } catch {
    return [];
  }
});

export type OrgSettings = {
  ticketGuidance: string;
  updatedByName: string;
  updatedAt: string | null;
};

export async function getOrgSettings(
  orgKeyValue: string,
  db?: SupabaseClient,
): Promise<OrgSettings> {
  const admin = db ?? createAdminSupabase();
  try {
    const { data } = await admin
      .from("org_settings")
      .select("ticket_guidance, updated_by_name, updated_at")
      .eq("org_key", orgKeyValue)
      .maybeSingle();
    return {
      ticketGuidance: (data?.ticket_guidance as string) ?? "",
      updatedByName: (data?.updated_by_name as string) ?? "",
      updatedAt: (data?.updated_at as string) ?? null,
    };
  } catch {
    // The agent must still be able to file when the settings read fails.
    return { ticketGuidance: "", updatedByName: "", updatedAt: null };
  }
}

export async function setOrgSettings(
  orgKeyValue: string,
  guidance: string,
  by: { userId: string; name: string },
  db?: SupabaseClient,
): Promise<void> {
  const admin = db ?? createAdminSupabase();
  // supabase-js RESOLVES with { error } rather than rejecting, so this has to
  // be checked explicitly. Without it a failed write returns ok and the editor
  // shows "Saved" while the team's guidance is unchanged - the one place in
  // this file where swallowing an error would lie to the user rather than
  // degrade gracefully.
  const { error } = await admin.from("org_settings").upsert(
    {
      org_key: orgKeyValue,
      ticket_guidance: guidance,
      updated_at: new Date().toISOString(),
      updated_by: by.userId,
      updated_by_name: by.name,
    },
    { onConflict: "org_key" },
  );
  if (error) throw new Error(error.message);
}

/** The org's instant-replay sites (see lib/replay-sites.ts). Empty on any failure:
 *  no list means the extension records nothing, the safe default. */
export async function getOrgReplaySites(orgKeyValue: string, db?: SupabaseClient): Promise<string[]> {
  const admin = db ?? createAdminSupabase();
  try {
    const { data } = await admin
      .from("org_settings")
      .select("replay_sites")
      .eq("org_key", orgKeyValue)
      .maybeSingle();
    return Array.isArray(data?.replay_sites) ? (data.replay_sites as string[]) : [];
  } catch {
    return [];
  }
}

/** Replace the org's replay sites. Upserts only its own column, so the ticket
 *  guidance on the same row is untouched. */
export async function setOrgReplaySites(
  orgKeyValue: string,
  sites: string[],
  by: { userId: string; name: string },
  db?: SupabaseClient,
): Promise<void> {
  const admin = db ?? createAdminSupabase();
  const { error } = await admin.from("org_settings").upsert(
    {
      org_key: orgKeyValue,
      replay_sites: sites,
      updated_at: new Date().toISOString(),
      updated_by: by.userId,
      updated_by_name: by.name,
    },
    { onConflict: "org_key" },
  );
  if (error) throw new Error(error.message);
}

export type PodiumEntry = Reporter & {
  name: string;
  imageUrl?: string;
  isYou: boolean;
};

/**
 * Resolve org membership for Brief users who have none cached yet.
 *
 * Membership is normally written the first time someone loads a page, which
 * leaves a cold start the leaderboard can't hide: a colleague is simply absent
 * until they happen to open Brief, and the roster looks wrong to everyone else.
 * This closes that without anyone running an ops script.
 *
 * Candidates come from CLERK, not from the briefs table. Sourcing them from
 * briefs meant only people who had already filed were ever resolved, so a
 * teammate who signed up and connected Linear but hadn't filed yet could never
 * appear.
 *
 * Failures are remembered (org_resolve_misses). Without that, the accounts that
 * can never resolve were retried on every single render, and with a small
 * budget they consumed all of it - the roster stalled a few members short no
 * matter how long you waited. With misses recorded the budget can be generous
 * enough to finish an org in one pass, then costs almost nothing.
 *
 * Fire-and-forget: the dashboard calls it through `after()`, so none of this
 * is on the response path.
 */
export async function warmOrgMemberships(
  db?: SupabaseClient,
  limit = 25,
): Promise<number> {
  const admin = db ?? createAdminSupabase();
  try {
    const client = await clerkClient();
    const missCutoff = new Date(Date.now() - ORG_MISS_TTL_MS).toISOString();
    const [list, { data: memberRows }, { data: missRows }] = await Promise.all([
      client.users.getUserList({ limit: 200 }),
      admin.from("org_members").select("user_id"),
      admin.from("org_resolve_misses").select("user_id").gte("tried_at", missCutoff),
    ]);

    const placed = new Set((memberRows ?? []).map((r: { user_id: string }) => r.user_id));
    // Nobody left to place: do no further work at all. Without this the history
    // pass below re-scanned thousands of brief rows on every single dashboard
    // render, long after the org was complete.
    const unplaced = list.data.map((u) => u.id).filter((id) => !placed.has(id));
    if (unplaced.length === 0) return 0;

    const missed = new Set((missRows ?? []).map((r: { user_id: string }) => r.user_id));
    const pending = unplaced.filter((id) => !missed.has(id));

    // Shuffled so that if there are ever more pending than the budget allows,
    // the same accounts don't get first refusal on every pass.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }

    // getOrg caches whatever it resolves, which is the whole point.
    const results = await Promise.all(
      pending
        .slice(0, limit)
        .map(async (id) => ({ id, org: await getOrg(id, admin).catch(() => null) })),
    );

    const failed = results.filter((r) => !r.org).map((r) => r.id);
    const hit = results.filter((r) => r.org).map((r) => r.id);
    await Promise.all([
      failed.length
        ? admin.from("org_resolve_misses").upsert(
            failed.map((user_id) => ({ user_id, tried_at: new Date().toISOString() })),
            { onConflict: "user_id" },
          )
        : null,
      // A previously hopeless account that just worked shouldn't stay marked.
      hit.length ? admin.from("org_resolve_misses").delete().in("user_id", hit) : null,
    ]);

    // Anyone the tokens couldn't place may still be placeable from their own
    // filing history - see placeFromHistory.
    const inferred = await placeFromHistory(admin);

    return hit.length + inferred;
  } catch {
    // A warm-up that fails is invisible - the next page load tries again.
    return 0;
  }
}

/**
 * Place people their token can't vouch for, using where their tickets went.
 *
 * A stale Linear grant means Clerk won't produce a token, so resolution fails
 * and the person vanishes from their team's roster - even with dozens of
 * tickets filed into that team's workspace. Brief filed those tickets and
 * recorded the urls, so the workspace is already known; see lib/org-infer.ts
 * for why this is sound and why it is only ever a fallback.
 */
async function placeFromHistory(admin: SupabaseClient): Promise<number> {
  try {
    const [{ data: ticketRows }, { data: memberRows }] = await Promise.all([
      admin
        .from("briefs")
        .select("user_id, ticket_url")
        .not("ticket_url", "is", null)
        .limit(4000),
      admin.from("org_members").select("user_id, org_key, org_name"),
    ]);

    const resolved = new Map<string, ResolvedOrg>(
      ((memberRows ?? []) as Array<{ user_id: string; org_key: string; org_name: string }>).map(
        (r) => [r.user_id, { orgKey: r.org_key, orgName: r.org_name }],
      ),
    );
    if (resolved.size === 0) return 0;

    const placements = inferMemberships({
      tickets: ((ticketRows ?? []) as Array<{ user_id: string; ticket_url: string | null }>).map(
        (r) => ({ userId: r.user_id, url: r.ticket_url }),
      ),
      resolved,
    });
    if (placements.length === 0) return 0;

    const { error } = await admin.from("org_members").upsert(
      placements.map((p) => ({
        user_id: p.userId,
        org_key: p.orgKey,
        org_name: p.orgName,
        provider: "linear",
        // Backdated so a real token lookup is preferred as soon as the TTL
        // lapses - inference should never keep a live answer out.
        resolved_at: new Date(Date.now() - ORG_TTL_MS / 2).toISOString(),
      })),
      { onConflict: "user_id" },
    );
    if (error) return 0;

    // They're placed, so stop treating them as hopeless.
    await admin
      .from("org_resolve_misses")
      .delete()
      .in("user_id", placements.map((p) => p.userId));

    return placements.length;
  } catch {
    return 0;
  }
}

/**
 * The aggregate groups over briefs, so a teammate with none in the window
 * produces no row at all. Pad them back in at zero: the roster should show the
 * team, not only whoever happened to file.
 */
function padToRoster(rows: LeaderRow[], memberIds: string[]): LeaderRow[] {
  const seen = new Set(rows.map((r) => r.userId));
  return [
    ...rows,
    ...memberIds
      .filter((id) => !seen.has(id))
      .map((userId) => ({ userId, filed: 0, night: 0, avgTitle: 0, prevFiled: 0 })),
  ];
}

/**
 * Both ranges in one pass, sharing a single Clerk name lookup.
 *
 * The range used to live in the URL, so switching it re-ran the WHOLE dashboard
 * - including attachTicketInfo, which makes live tracker API calls for dozens
 * of tickets. Switching a leaderboard filter should not cost a Linear round
 * trip per ticket. Both ranges are cheap SQL against one index, so we fetch
 * them together and let the client toggle instantly.
 */
export async function getLeaderboards(
  orgKeyValue: string,
  viewerId: string,
  db?: SupabaseClient,
): Promise<{ month: PodiumEntry[]; all: PodiumEntry[] }> {
  const admin = db ?? createAdminSupabase();
  const memberIds = await getOrgMemberIds(orgKeyValue, admin);
  if (memberIds.length === 0) return { month: [], all: [] };

  const [monthRows, allRows] = await Promise.all([
    leaderboardRows(admin, memberIds, rangeStart("month")),
    leaderboardRows(admin, memberIds, rangeStart("all")),
  ]);

  const month = rankReporters(padToRoster(monthRows, memberIds));
  const all = rankReporters(padToRoster(allRows, memberIds));
  const names = await lookupNames([...month, ...all].map((r) => r.userId));

  const decorate = (rs: Reporter[]): PodiumEntry[] =>
    rs.map((r) => ({
      ...r,
      name: names.get(r.userId)?.name ?? "someone",
      imageUrl: names.get(r.userId)?.imageUrl,
      isYou: r.userId === viewerId,
    }));

  return { month: decorate(month), all: decorate(all) };
}

/**
 * Everyone in the org, for the Settings team list.
 *
 * Built from the podium's own roster (org_members) and aggregate, so the two can
 * never disagree about who is on the team. All-time counts and titles: a roster
 * is not a this-month figure. If the aggregate fails the roster still shows,
 * with zero counts, rather than the team vanishing from Settings.
 */
export async function getOrgTeam(
  orgKeyValue: string,
  viewerId: string,
  db?: SupabaseClient,
): Promise<TeamMember[]> {
  const admin = db ?? createAdminSupabase();
  const memberIds = await getOrgMemberIds(orgKeyValue, admin);
  if (memberIds.length === 0) return [];

  const rows = await leaderboardRows(admin, memberIds, null);
  const ranked = rankReporters(padToRoster(rows, memberIds));
  const names = await lookupNames(ranked.map((r) => r.userId));

  return sortTeam(
    ranked.map((r) => ({
      userId: r.userId,
      fullName: names.get(r.userId)?.fullName ?? "someone",
      imageUrl: names.get(r.userId)?.imageUrl,
      isYou: r.userId === viewerId,
      filed: r.filed,
      title: r.title,
    })),
  );
}

async function leaderboardRows(
  admin: SupabaseClient,
  memberIds: string[],
  since: Date | null,
): Promise<LeaderRow[]> {
  try {
    const { data, error } = await admin.rpc("org_leaderboard", {
      member_ids: memberIds,
      since: since ? since.toISOString() : null,
    });
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, string | number>>).map((r) => ({
      userId: String(r.user_id),
      filed: Number(r.filed) || 0,
      night: Number(r.night) || 0,
      avgTitle: Number(r.avg_title) || 0,
      prevFiled: Number(r.prev_filed) || 0,
    }));
  } catch {
    // A failed aggregate hides the podium rather than breaking the dashboard.
    return [];
  }
}

/** One batched Clerk lookup for however many distinct people are ranked. */
export async function lookupNames(
  userIds: string[],
): Promise<Map<string, { name: string; fullName: string; imageUrl?: string }>> {
  const names = new Map<string, { name: string; fullName: string; imageUrl?: string }>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ userId: unique, limit: unique.length });
    for (const u of list.data) {
      const handle = u.username ?? u.primaryEmailAddress?.emailAddress?.split("@")[0];
      // The podium has room for a first name; the team list shows who it is.
      const name = u.firstName ?? handle ?? "someone";
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ") || handle || "someone";
      names.set(u.id, { name, fullName, imageUrl: u.imageUrl });
    }
  } catch {
    /* fall back to the placeholder at the call site rather than losing the podium */
  }
  return names;
}

/**
 * The org's measured numbers behind the dashboard headline.
 *
 * All-time rather than windowed: this is the standing case for the tool, not a
 * this-month figure that shrinks over a quiet fortnight. Returns null whenever
 * there is nothing worth a sentence - see summarizeRoi.
 */
export async function getOrgRoi(
  orgKeyValue: string,
  db?: SupabaseClient,
): Promise<RoiSummary | null> {
  const admin = db ?? createAdminSupabase();
  try {
    return await getRoiFor(await getOrgMemberIds(orgKeyValue, admin), admin);
  } catch {
    return null;
  }
}

/** The same headline for any set of people - a team, or just you. */
export async function getRoiFor(
  memberIds: string[],
  db?: SupabaseClient,
): Promise<RoiSummary | null> {
  const admin = db ?? createAdminSupabase();
  try {
    if (memberIds.length === 0) return null;
    const { data, error } = await admin.rpc("org_roi", { member_ids: memberIds });
    if (error) throw error;
    const row = (data ?? [])[0] as
      | { filed: number | string; with_evidence: number | string; avg_seconds: number | string }
      | undefined;
    if (!row) return null;
    return summarizeRoi({
      filed: Number(row.filed) || 0,
      withEvidence: Number(row.with_evidence) || 0,
      avgSeconds: Number(row.avg_seconds) || 0,
    });
  } catch {
    // No headline is fine; a broken dashboard is not.
    return null;
  }
}

/** The start of the trailing 30-day window, or null for all time. */
export function rangeStart(range: "month" | "all"): Date | null {
  if (range === "all") return null;
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
