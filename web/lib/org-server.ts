import { clerkClient } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { orgKey } from "@/lib/org";
import { getLinearOrg, getLinearToken } from "@/lib/linear";
import { getJiraAuth, getJiraCloud } from "@/lib/jira";
import { getGithubToken, listGithubOrgs } from "@/lib/github";
import { rankReporters, type LeaderRow, type Reporter } from "@/lib/podium";
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
 * The org's ranked reporters, with display names attached.
 *
 * `since` null means all time. Names come from ONE batched Clerk lookup rather
 * than one per person.
 */
export async function getLeaderboard(
  orgKeyValue: string,
  viewerId: string,
  since: Date | null,
  db?: SupabaseClient,
): Promise<PodiumEntry[]> {
  const admin = db ?? createAdminSupabase();
  const memberIds = await getOrgMemberIds(orgKeyValue, admin);
  if (memberIds.length === 0) return [];

  let rows: LeaderRow[] = [];
  try {
    const { data, error } = await admin.rpc("org_leaderboard", {
      member_ids: memberIds,
      since: since ? since.toISOString() : null,
    });
    if (error) throw error;
    rows = (data ?? []).map(
      (r: {
        user_id: string;
        filed: number | string;
        night: number | string;
        avg_title: number | string;
        prev_filed: number | string;
      }) => ({
        userId: r.user_id,
        filed: Number(r.filed) || 0,
        night: Number(r.night) || 0,
        avgTitle: Number(r.avg_title) || 0,
        prevFiled: Number(r.prev_filed) || 0,
      }),
    );
  } catch {
    // A failed aggregate hides the podium rather than breaking the dashboard.
    return [];
  }

  const ranked = rankReporters(rows);
  if (ranked.length === 0) return [];

  const names = new Map<string, { name: string; imageUrl?: string }>();
  try {
    const client = await clerkClient();
    const list = await client.users.getUserList({
      userId: ranked.map((r) => r.userId),
      limit: ranked.length,
    });
    for (const u of list.data) {
      const name =
        u.firstName ??
        u.username ??
        u.primaryEmailAddress?.emailAddress?.split("@")[0] ??
        "someone";
      names.set(u.id, { name, imageUrl: u.imageUrl });
    }
  } catch {
    /* fall back to the placeholder below rather than losing the podium */
  }

  return ranked.map((r) => ({
    ...r,
    name: names.get(r.userId)?.name ?? "someone",
    imageUrl: names.get(r.userId)?.imageUrl,
    isYou: r.userId === viewerId,
  }));
}

/** The start of the trailing 30-day window, or null for all time. */
export function rangeStart(range: "month" | "all"): Date | null {
  if (range === "all") return null;
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
