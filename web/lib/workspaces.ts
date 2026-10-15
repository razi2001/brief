// Which workspace of a tracker is "your team".
//
// An org in Brief is a tracker workspace (see lib/org.ts). A Linear token
// points at exactly one, so org-server reads it straight off the token. Every
// other tracker can see several at once (a GitHub user's orgs, a GitLab user's
// groups, the Jira sites an Atlassian grant covers), so the user picks one
// here, and for Jira, Azure DevOps and Asana that pick is also where tickets
// are filed. A Jira account still on its Clerk connection from before the move
// to Brief's OAuth has no pick: it keeps its token's first site (org-server).
//
// The org lookup runs on Home, on every filing and on the extension's replay
// check, so reading a pick never waits on a tracker: a pick is only ever what
// was stored. The connect callback stores a lone workspace itself (Notion's
// one workspace and Monday's one account included), so the user is only asked
// when there are several.
//
// SECURITY: a pick is only stored after the user's own token has just shown it
// can see that workspace. The org key org-server derives from the pick grants
// read access to a leaderboard and write access to shared filing rules, so an
// id from a request body is never trusted on its own.

import { clerkClient } from "@clerk/nextjs/server";
import { getClerkUser } from "@/lib/clerk-user";
import {
  getConnection,
  isOwnedProvider,
  metaWorkspace,
  readConnectionMeta,
  setConnectionMeta,
  type OwnedProvider,
} from "@/lib/connections";
import { forgetOrg } from "@/lib/connect-flow";
import { listGithubOrgs } from "@/lib/github";
import { listJiraSites } from "@/lib/jira";
import { githubToken } from "@/lib/tracker-tokens";
import { listGitlabGroups } from "@/lib/gitlab";
import { listNotionWorkspaces } from "@/lib/notion";
import { listAzureOrgs } from "@/lib/azure";
import { listClickUpWorkspaces } from "@/lib/clickup";
import { listTrelloWorkspaces } from "@/lib/trello";
import { listAsanaWorkspaces } from "@/lib/asana";
import { listMondayAccount } from "@/lib/monday";
import { PROVIDER_LABELS, WORKSPACE_NOUN } from "@/lib/provider-labels";
import type { ProviderKey, Workspace } from "@/lib/tracker";

// What each tracker calls the thing a user picks. One map, shared with the
// client components, so "Pick your Azure DevOps organization" can't drift.
export { WORKSPACE_NOUN };

/**
 * Clerk privateMetadata key holding the GitHub org login picked for a Clerk
 * GitHub connection, from before GitHub moved to Brief's OAuth. A Brief-held
 * connection keeps its pick on the connection instead.
 */
const GITHUB_ORG_KEY = "githubOrg";

/** The org comes straight from the token: nothing to list or pick. */
const FROM_TOKEN: ReadonlySet<ProviderKey> = new Set<ProviderKey>(["linear"]);

/** Whether `p` is a tracker whose workspace is chosen here (the API route's guard). */
export function hasWorkspacePick(p: string): p is ProviderKey {
  return Object.hasOwn(WORKSPACE_NOUN, p) && !FROM_TOKEN.has(p as ProviderKey);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** What the token saw, and whether there was a token to ask with at all. */
type Listing = { connected: boolean; list: Workspace[] };

const NOT_CONNECTED: Listing = { connected: false, list: [] };

async function fetchWorkspaces(userId: string, provider: ProviderKey): Promise<Listing> {
  switch (provider) {
    case "github": {
      // A Clerk connection from before the move lists with its own token, so
      // its user can still pick an org.
      const tok = await githubToken(userId);
      return tok ? { connected: true, list: await listOwned("github", tok.token) } : NOT_CONNECTED;
    }
    // Only a Brief-held Jira connection has a site to pick; a Clerk one files
    // into its token's first site, as it did before the move.
    case "jira":
    case "gitlab":
    case "azure":
    case "clickup":
    case "notion":
    case "trello":
    case "asana":
    case "monday": {
      const c = await getConnection(userId, provider);
      return c ? { connected: true, list: await listOwned(provider, c.accessToken) } : NOT_CONNECTED;
    }
    default:
      return NOT_CONNECTED;
  }
}

/** Linear has nothing to list: its one workspace is read off the token (FROM_TOKEN). */
async function listOwned(provider: Exclude<OwnedProvider, "linear">, token: string): Promise<Workspace[]> {
  switch (provider) {
    case "jira":
      // Read as empty on a failure, like every other lister here.
      return listJiraSites(token).catch(() => []);
    case "github": {
      // The login is the org's identity on GitHub and what githubOrg has always
      // stored, so it serves as both id and name.
      const orgs = await listGithubOrgs({ token });
      return orgs.map((o) => ({ id: o.login, name: o.login, avatarUrl: o.avatarUrl }));
    }
    case "gitlab":
      return listGitlabGroups({ token });
    case "notion":
      return listNotionWorkspaces({ token });
    case "azure":
      return listAzureOrgs(`Bearer ${token}`);
    case "clickup":
      return listClickUpWorkspaces(token);
    case "trello": {
      // Every Trello request carries the app's API key beside the user's token,
      // so a deployment without the key can't see any workspace.
      const key = process.env.TRELLO_API_KEY;
      return key ? listTrelloWorkspaces({ key, token }) : [];
    }
    case "asana":
      return listAsanaWorkspaces(token);
    case "monday":
      return listMondayAccount({ token });
  }
}

/**
 * Listing can take seconds (GitHub walks up to three pages of repos) and the
 * answer rarely changes, so it is remembered per user and tracker for a few
 * minutes. The promise is kept rather than the result, so the Settings render
 * and the org lookup running beside it share one call instead of making two.
 */
const LIST_TTL_MS = 5 * 60 * 1000;
const listMemo = new Map<string, { at: number; listing: Promise<Listing> }>();

const memoKey = (userId: string, provider: ProviderKey) => `${provider}:${userId}`;

/**
 * Drop every remembered listing for this user. The connect callback and the
 * disconnect route call it: a list read with the previous token (or before
 * there was one) is not what the new connection sees.
 */
export function forgetWorkspaces(userId: string): void {
  for (const p of Object.keys(WORKSPACE_NOUN) as ProviderKey[]) listMemo.delete(memoKey(userId, p));
}

function listing(userId: string, provider: ProviderKey, fresh = false): Promise<Listing> {
  const k = memoKey(userId, provider);
  const now = Date.now();
  const hit = listMemo.get(k);
  if (!fresh && hit && now - hit.at < LIST_TTL_MS) return hit.listing;

  // Expired entries are only ever overwritten, never read, so sweep them now
  // and then rather than let one per user who ever opened Settings pile up.
  if (listMemo.size > 500) {
    for (const [key, e] of listMemo) if (now - e.at >= LIST_TTL_MS) listMemo.delete(key);
  }

  const entry = {
    at: now,
    // A token lookup that throws (Clerk down) reads as not connected.
    listing: fetchWorkspaces(userId, provider).catch(() => NOT_CONNECTED),
  };
  listMemo.set(k, entry);
  // Only a real answer is remembered. "Not connected" may be about to change
  // (the user is in the middle of connecting), and the adapters' listers read
  // a failure as an empty list, so an empty one may be an outage that a
  // remembered copy would stretch into minutes of "nothing to pick".
  void entry.listing.then((l) => {
    if ((!l.connected || l.list.length === 0) && listMemo.get(k) === entry) listMemo.delete(k);
  });
  return entry.listing;
}

/**
 * Every workspace this user's token for `provider` can see. [] when not
 * connected (and for Linear, whose org comes straight from the token).
 */
export async function listWorkspaces(userId: string, provider: ProviderKey): Promise<Workspace[]> {
  if (FROM_TOKEN.has(provider)) return [];
  return (await listing(userId, provider)).list;
}

// ---------------------------------------------------------------------------
// The pick
// ---------------------------------------------------------------------------

/**
 * The stored pick, read without asking the tracker: this runs on every org
 * lookup, and a stored pick was already proven when it was made.
 */
async function storedPick(userId: string, provider: ProviderKey): Promise<Workspace | null> {
  if (isOwnedProvider(provider)) {
    // The meta column only: the connect callback already stored a lone
    // workspace, so the row is the answer, and no token is decrypted or
    // refreshed to read it.
    const meta = await readConnectionMeta(userId, provider);
    if (meta) return metaWorkspace(meta);
  }
  // No Brief-held GitHub connection: a Clerk one from before the move keeps
  // the org picked for it.
  if (provider === "github") return legacyGithubPick(userId);
  return null;
}

/**
 * The GitHub org picked for a Clerk GitHub connection, from before GitHub
 * moved to Brief's OAuth, or null. The connect callback carries it over to a
 * Brief connection whose token can still see it, and Settings tries again
 * when the connect could not (adoptLegacyGithubPick).
 */
export async function legacyGithubPick(userId: string): Promise<Workspace | null> {
  const user = await getClerkUser(userId);
  const login = String(user.privateMetadata?.[GITHUB_ORG_KEY] ?? "").trim();
  return login ? { id: login, name: login } : null;
}

/**
 * Drop the Clerk-era GitHub pick once a Brief connection holds it. Best
 * effort: a pick left behind is ignored while a Brief connection exists.
 */
export async function forgetLegacyGithubPick(userId: string): Promise<void> {
  try {
    const client = await clerkClient();
    // null removes the key in Clerk's metadata merge.
    await client.users.updateUserMetadata(userId, { privateMetadata: { [GITHUB_ORG_KEY]: null } });
  } catch (err) {
    console.warn(
      "[workspaces] could not clear the Clerk-era GitHub org pick:",
      err instanceof Error ? err.name : "unknown error",
    );
  }
}

/**
 * Move a Clerk-era GitHub org pick onto a Brief-held connection that has none,
 * when `list`, just read with that connection's token, holds it. This is the
 * connect callback's carry-over, tried again: its listing can fail, and a
 * failed listing must not cost the user their org. Returns the adopted org.
 */
async function adoptLegacyGithubPick(userId: string, list: Workspace[]): Promise<Workspace | null> {
  if (!list.length || !(await readConnectionMeta(userId, "github"))) return null;
  const legacy = await legacyGithubPick(userId);
  const match = legacy ? list.find((w) => sameId("github", w.id, legacy.id)) : undefined;
  if (!match) return null;
  await setConnectionMeta(userId, "github", { workspaceId: match.id, workspaceName: match.name });
  await forgetLegacyGithubPick(userId);
  await forgetOrg(userId);
  return match;
}

/**
 * The picked workspace, as stored. Never calls the tracker, since this sits
 * on every org lookup: nothing stored means no org yet, never a guess.
 */
export async function getPickedWorkspace(userId: string, provider: ProviderKey): Promise<Workspace | null> {
  if (FROM_TOKEN.has(provider)) return null;
  try {
    return await storedPick(userId, provider);
  } catch {
    return null;
  }
}

/** GitHub logins are case-insensitive upstream; every other id is opaque. */
function sameId(provider: ProviderKey, a: string, b: string): boolean {
  return provider === "github" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The GitHub org login, or "" to clear it: on a Brief-held connection when
 * there is one, else in Clerk's privateMetadata, where storedPick reads a
 * Clerk connection's pick.
 */
async function writeGithubPick(userId: string, login: string): Promise<void> {
  if (await readConnectionMeta(userId, "github")) {
    await setConnectionMeta(userId, "github", { workspaceId: login, workspaceName: login });
    return;
  }
  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, { privateMetadata: { [GITHUB_ORG_KEY]: login } });
}

/**
 * Validated against listWorkspaces (never store something the token can't
 * see); clears the org_members cache row.
 */
export async function setPickedWorkspace(
  userId: string,
  provider: ProviderKey,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = PROVIDER_LABELS[provider] ?? provider;
  const noun = WORKSPACE_NOUN[provider] ?? "workspace";
  if (!hasWorkspacePick(provider)) return { ok: false, error: `${name} has no ${noun} to pick.` };
  const want = (id ?? "").trim();

  if (!want) {
    // Clearing only drops the user out of their org, which is always safe, so
    // it needs no proof. Only GitHub's pick clears: GitHub files without one,
    // while for some trackers the pick is also where tickets file, so it is
    // changed, never cleared.
    if (provider !== "github") return { ok: false, error: `Pick a ${noun}.` };
    try {
      await writeGithubPick(userId, "");
    } catch {
      return { ok: false, error: `Couldn't clear your ${name} ${noun}.` };
    }
    await forgetOrg(userId);
    return { ok: true };
  }

  // A fresh list, not the remembered one: the proof should be current, and a
  // few-minutes-old list could belong to an account the user has since swapped.
  const { connected, list } = await listing(userId, provider, true);
  if (!connected) return { ok: false, error: `${name} isn't connected.` };
  const match = list.find((w) => sameId(provider, w.id, want));
  if (!match) return { ok: false, error: `That ${noun} isn't on your ${name} account.` };

  try {
    if (provider === "github") {
      await writeGithubPick(userId, match.id);
    } else if (isOwnedProvider(provider)) {
      // The org lookup reads only this row, so a pick made here (a Monday
      // account connect couldn't list included) is stored on it. A Jira site's
      // address goes with it: every Jira link is built from it.
      await setConnectionMeta(userId, provider, {
        workspaceId: match.id,
        workspaceName: match.name,
        ...(match.url ? { siteUrl: match.url } : {}),
      });
    }
  } catch {
    return { ok: false, error: `Couldn't save your ${name} ${noun}.` };
  }
  // The org is resolved from the pick, so the cached one is the old pick's.
  await forgetOrg(userId);
  return { ok: true };
}

/**
 * Workspaces to offer on Settings when nothing is picked; [] otherwise. Only
 * Settings asks, so this may call the tracker. A lone workspace is offered
 * too: reading a pick implies nothing from one (that would put a tracker call
 * on every org lookup), so it is offered as a single choice rather than
 * leaving the user with no org at all.
 */
export async function workspacesToPick(userId: string, provider: ProviderKey): Promise<Workspace[]> {
  if (!hasWorkspacePick(provider)) return [];
  try {
    if (await getPickedWorkspace(userId, provider)) return [];
    const list = await listWorkspaces(userId, provider);
    // A carry-over that fails just leaves the list to pick from.
    if (provider === "github" && (await adoptLegacyGithubPick(userId, list).catch(() => null))) return [];
    return list;
  } catch {
    return [];
  }
}
