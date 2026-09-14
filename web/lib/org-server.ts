import { clerkClient } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { orgKey } from "@/lib/org";
import { getLinearOrg, getLinearToken } from "@/lib/linear";
import { getJiraAuth, getJiraCloud } from "@/lib/jira";
import { getGithubToken, listGithubOrgs } from "@/lib/github";
import { rankReporters, type LeaderRow, type Reporter } from "@/lib/podium";
import { inferMemberships, type ResolvedOrg } from "@/lib/org-infer";
import type { ProviderKey } from "@/lib/tracker";

/**
 * Org identity, resolved from live tracker tokens and cached in Supabase.
 *
 * SECURITY - the one rule this file exists to enforce: an org key is ALWAYS
 * derived here, from a token the server just used. It is never read from a
 * request body, a query param, or any client state. A caller that could name
 * its own org could read any org's leaderboard and rewrite any org's filing
 * rules. Every exported function below takes a userId and resolves the org
 * itself for exactly that reason.
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

/** Clerk privateMetadata key holding the GitHub org the user picked. */
const GITHUB_ORG_KEY = "githubOrg";

/**
 * Ask each connected tracker which workspace it points at.
 *
 * Order matches PROVIDERS in the registry, so a user with two trackers
 * connected lands in the same org their briefs get filed into.
 */
async function resolveFromTrackers(userId: string): Promise<OrgIdentity | null> {
  try {
    const tok = await getLinearToken(userId);
    if (tok) {
      const org = await getLinearOrg(tok);
      const key = org && orgKey("linear", org.id);
      if (key && org) return { key, name: org.name, provider: "linear" };
    }
  } catch {
    /* a tracker we can't reach contributes no org, it doesn't break the page */
  }

  try {
    const tok = await getJiraAuth(userId);
    if (tok) {
      const cloud = await getJiraCloud(tok);
      const key = cloud && orgKey("jira", cloud.cloudId);
      if (key && cloud) {
        return { key, name: cloud.name ?? "Jira site", provider: "jira" };
      }
    }
  } catch {
    /* as above */
  }

  // GitHub is the odd one out: a user belongs to many orgs, so there is nothing
  // to infer. We use the one they picked, and if they haven't picked yet they
  // have no org - deliberately, rather than being put in a stranger's.
  try {
    const tok = await getGithubToken(userId);
    if (tok) {
      const picked = await getPickedGithubOrg(userId);
      const key = picked && orgKey("github", picked);
      if (key && picked) return { key, name: picked, provider: "github" };
    }
  } catch {
    /* as above */
  }

  return null;
}

export async function getPickedGithubOrg(userId: string): Promise<string | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const v = (user.privateMetadata?.[GITHUB_ORG_KEY] as string) ?? "";
    return v.trim() || null;
  } catch {
    return null;
  }
}

/** Record the user's GitHub org choice. Validated against what their token can see. */
export async function setPickedGithubOrg(
  userId: string,
  login: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const want = (login ?? "").trim();
  const client = await clerkClient();

  // Clearing the choice is always allowed - it just drops them out of the org.
  if (!want) {
    await client.users.updateUserMetadata(userId, {
      privateMetadata: { [GITHUB_ORG_KEY]: "" },
    });
    await forgetMembership(userId);
    return { ok: true };
  }

  // Never store an org the user can't prove membership of: the org key is what
  // grants read access to a leaderboard and write access to shared preferences.
  const tok = await getGithubToken(userId);
  if (!tok) return { ok: false, error: "GitHub isn't connected." };
  const orgs = await listGithubOrgs(tok);
  const match = orgs.find((o) => o.login.toLowerCase() === want.toLowerCase());
  if (!match) return { ok: false, error: "You're not a member of that GitHub org." };

  await client.users.updateUserMetadata(userId, {
    privateMetadata: { [GITHUB_ORG_KEY]: match.login },
  });
  // Drop the cached membership so the next read picks the new org up at once.
  await forgetMembership(userId);
  return { ok: true };
}

async function forgetMembership(userId: string): Promise<void> {
  try {
    await createAdminSupabase().from("org_members").delete().eq("user_id", userId);
  } catch {
    /* the row will be refreshed by TTL anyway */
  }
}

/**
 * The user's org: cached when fresh, re-resolved when missing or stale.
 *
 * Best-effort throughout, matching getTrackerContext and resolveTracker: a
 * tracker outage degrades to the cached row, and a cache miss degrades to no
 * org. Neither ever throws out of a render.
 */
export async function getOrg(
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
}

/** Every Brief user known to be in this org. */
export async function getOrgMemberIds(
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
}

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

    const skip = new Set([
      ...(memberRows ?? []).map((r: { user_id: string }) => r.user_id),
      ...(missRows ?? []).map((r: { user_id: string }) => r.user_id),
    ]);
    const pending = list.data.map((u) => u.id).filter((id) => !skip.has(id));
    if (pending.length === 0) return 0;

    // Shuffled so that if there are ever more pending than the budget allows,
    // the same accounts don't get first refusal on every pass.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }

    const batch = pending.slice(0, limit);
    // getOrg caches whatever it resolves, which is the whole point.
    const results = await Promise.all(
      batch.map(async (id) => ({ id, org: await getOrg(id, admin).catch(() => null) })),
    );

    const missed = results.filter((r) => !r.org).map((r) => r.id);
    const hit = results.filter((r) => r.org).map((r) => r.id);
    await Promise.all([
      missed.length
        ? admin.from("org_resolve_misses").upsert(
            missed.map((user_id) => ({ user_id, tried_at: new Date().toISOString() })),
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

  // The aggregate groups over briefs, so a teammate with none in the window
  // produces no row at all. Pad them back in at zero: the roster should show
  // the team, not only whoever happened to file this month.
  const padded = (rows: LeaderRow[]): LeaderRow[] => {
    const seen = new Set(rows.map((r) => r.userId));
    return [
      ...rows,
      ...memberIds
        .filter((id) => !seen.has(id))
        .map((userId) => ({ userId, filed: 0, night: 0, avgTitle: 0, prevFiled: 0 })),
    ];
  };

  const month = rankReporters(padded(monthRows));
  const all = rankReporters(padded(allRows));
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
async function lookupNames(
  userIds: string[],
): Promise<Map<string, { name: string; imageUrl?: string }>> {
  const names = new Map<string, { name: string; imageUrl?: string }>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return names;
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({ userId: unique, limit: unique.length });
    for (const u of list.data) {
      const name =
        u.firstName ??
        u.username ??
        u.primaryEmailAddress?.emailAddress?.split("@")[0] ??
        "someone";
      names.set(u.id, { name, imageUrl: u.imageUrl });
    }
  } catch {
    /* fall back to the placeholder at the call site rather than losing the podium */
  }
  return names;
}

/** The start of the trailing 30-day window, or null for all time. */
export function rangeStart(range: "month" | "all"): Date | null {
  if (range === "all") return null;
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
