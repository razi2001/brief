// The ONE place that enumerates trackers.
//
// Before this existed, "which providers are there" was spelled out in four
// places at once - an if/else ladder in run-processing, a hostname guess in
// ticket-sync, a hand-written pair of branches in the live sync, and a list of
// cards in the Connections UI. Adding a provider meant finding all four and
// getting each one right. Now an adapter is registered here and every one of
// those paths picks it up.
//
// Every tracker is a connection Brief owns (lib/connections), whose OAuth grant
// lives in our own table. Linear, Jira and GitHub used to be Clerk connected
// accounts, and a user who connected one that way still files through it until
// they reconnect: those three read Brief's store first and Clerk second
// (lib/tracker-tokens). Past this file, nothing needs to know which it was.

import { makeJiraTracker } from "@/lib/jira";
import { PROVIDER_LABELS, WORKSPACE_NOUN } from "@/lib/provider-labels";
import { makeLinearTracker } from "@/lib/linear";
import { makeGithubTracker } from "@/lib/github";
import { makeGitlabTracker } from "@/lib/gitlab";
import { makeNotionTracker } from "@/lib/notion";
import { makeAzureTracker } from "@/lib/azure";
import { makeClickUpTracker } from "@/lib/clickup";
import { makeTrelloTracker } from "@/lib/trello";
import { makeAsanaTracker } from "@/lib/asana";
import { makeMondayTracker } from "@/lib/monday";
import { getClerkUser } from "@/lib/clerk-user";
import { clerkMatch, clerkStrategy } from "@/lib/clerk-strategies";
import {
  connectionWorkspace,
  getConnection,
  isProviderConfigured,
  listConnectedProviders,
  type Connection,
  type OwnedProvider,
} from "@/lib/connections";
import { githubToken, jiraAccess, linearToken, type MovedProvider } from "@/lib/tracker-tokens";
import type { ProviderKey, Tracker, Workspace } from "@/lib/tracker";

/**
 * Why a connected tracker can't file right now. Each has a different fix:
 * `stale` needs a reconnect, `needsWorkspace` a pick on Settings, and
 * `unavailable` (this deployment lacks the provider's credentials) nothing the
 * user can do.
 */
export type TrackerProblem = "stale" | "needsWorkspace" | "unavailable";

/**
 * A resolve that says why it came back empty, so health checks and error copy
 * never have to look the connection up a second time (for an owned tracker a
 * second lookup can mean a second refresh against a revoked grant).
 */
export type TrackerCheck = { tracker: Tracker; problem?: undefined } | { tracker: null; problem: TrackerProblem };

export type ProviderDef = {
  key: ProviderKey;
  /** Display name, used in UI and in user-facing error copy. */
  name: string;
  /**
   * Linear, Jira and GitHub only, from before they moved off Clerk: the
   * strategy passed to createExternalAccount, and the substring matched
   * against externalAccount.provider, so an account connected through Clerk
   * still counts and can be removed. Both come from clerk-strategies so a
   * provider can be pointed at a custom Clerk connector without a code change.
   */
  clerkStrategy?: string;
  clerkMatch?: string;
  /**
   * The token alone can't file: the user has to pick which workspace it files
   * into (an Azure DevOps organization, an Asana workspace). Until they do, the
   * connection is waiting on them, not broken. Jira's site works the same way
   * for a Brief-held connection only, so its own check decides.
   */
  requiresWorkspace?: boolean;
  /** Build a Tracker for this user, or null when they haven't connected it. */
  resolve: (userId: string) => Promise<Tracker | null>;
  /** The same resolve, with the reason when there is no Tracker. */
  check: (userId: string) => Promise<TrackerCheck>;
};

const STALE: TrackerCheck = { tracker: null, problem: "stale" };

/**
 * Linear, Jira and GitHub: a connection Brief holds, else, with no Brief row at
 * all, the Clerk account from before the move (lib/tracker-tokens). A miss is
 * always stale, never unavailable: a deployment without Brief's OAuth app for
 * one still offers the Clerk connect, so a reconnect always helps.
 */
function movedProvider(def: { key: MovedProvider; check: (userId: string) => Promise<TrackerCheck> }): ProviderDef {
  return {
    ...def,
    name: PROVIDER_LABELS[def.key],
    clerkStrategy: clerkStrategy(def.key),
    clerkMatch: clerkMatch(def.key),
    resolve: async (userId) => (await def.check(userId)).tracker,
  };
}

function ownedProvider(def: {
  key: OwnedProvider;
  requiresWorkspace?: boolean;
  /** The Tracker for a live connection, or null when this deployment can't build one. */
  build: (c: Connection, workspace: Workspace | null) => Tracker | null;
}): ProviderDef {
  const { build, ...rest } = def;
  const check = async (userId: string): Promise<TrackerCheck> => {
    const c = await getConnection(userId, def.key);
    const workspace = c ? connectionWorkspace(c) : null;
    if (c && def.requiresWorkspace && !workspace) return { tracker: null, problem: "needsWorkspace" };
    const tracker = c ? build(c, workspace) : null;
    if (tracker) return { tracker };
    // A deployment missing this provider's credentials can't file for anyone,
    // and a reconnect would not change that.
    return { tracker: null, problem: isProviderConfigured(def.key) ? "stale" : "unavailable" };
  };
  return {
    ...rest,
    name: PROVIDER_LABELS[def.key],
    check,
    resolve: async (userId) => (await check(userId)).tracker,
  };
}

export const PROVIDERS: ProviderDef[] = [
  movedProvider({
    key: "linear",
    check: async (userId) => {
      const tok = await linearToken(userId);
      return tok ? { tracker: makeLinearTracker(tok) } : STALE;
    },
  }),
  movedProvider({
    key: "jira",
    // A token can be granted several Jira sites, and a Brief-held one files
    // into the site the user picked, waiting on the pick until there is one.
    // A Clerk-held one keeps filing into its token's first site, as it did
    // before the move.
    check: async (userId) => {
      const access = await jiraAccess(userId);
      if (access === "needsSite") return { tracker: null, problem: "needsWorkspace" };
      return access ? { tracker: makeJiraTracker(access.tok, access.cloud) } : STALE;
    },
  }),
  movedProvider({
    key: "github",
    // Files to any repository the token reaches, so an organization pick is
    // only the org.
    check: async (userId) => {
      const tok = await githubToken(userId);
      return tok ? { tracker: makeGithubTracker(tok) } : STALE;
    },
  }),
  ownedProvider({
    key: "gitlab",
    // Files to personal projects too, so a group pick is only the org.
    build: (c) => makeGitlabTracker({ token: c.accessToken }),
  }),
  ownedProvider({
    key: "azure",
    // Every Azure DevOps call is made against one organization's host, so
    // there is nothing to file into until the user has picked one.
    requiresWorkspace: true,
    build: (c, ws) => (ws ? makeAzureTracker({ org: ws.id, authorization: `Bearer ${c.accessToken}` }) : null),
  }),
  ownedProvider({
    key: "clickup",
    // No pick yet just means every workspace the grant covers is in play.
    build: (c, ws) => makeClickUpTracker({ token: c.accessToken, teamId: ws?.id }),
  }),
  ownedProvider({
    key: "notion",
    build: (c) => makeNotionTracker({ token: c.accessToken }),
  }),
  ownedProvider({
    key: "trello",
    // Every Trello request carries the app's API key next to the user's token,
    // so a deployment without the key can't file at all.
    build: (c) => {
      const key = process.env.TRELLO_API_KEY;
      return key ? makeTrelloTracker({ key, token: c.accessToken }) : null;
    },
  }),
  ownedProvider({
    key: "asana",
    // Projects, tags and people all live inside one workspace, so filing waits
    // for the pick.
    requiresWorkspace: true,
    build: (c, ws) => (ws ? makeAsanaTracker({ token: c.accessToken, workspaceGid: ws.id }) : null),
  }),
  ownedProvider({
    key: "monday",
    build: (c) => makeMondayTracker({ token: c.accessToken }),
  }),
];

export function providerDef(key: ProviderKey): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export function providerName(key: ProviderKey): string {
  return providerDef(key)?.name ?? key;
}

/**
 * The trackers a user may still have a Clerk connected account for, from
 * before Linear, Jira and GitHub moved to Brief's own OAuth.
 */
export const CLERK_PROVIDERS = PROVIDERS.filter((p) => !!p.clerkMatch);

/** `keys` deduplicated and in registry order, the order filing tries them in. */
function inRegistryOrder(keys: ProviderKey[]): ProviderKey[] {
  const have = new Set(keys);
  return PROVIDERS.filter((p) => have.has(p.key)).map((p) => p.key);
}

type ExternalAccountLike = { provider?: string; verification?: { status?: string } | null };
type ClerkUserLike = { externalAccounts?: ExternalAccountLike[] } | null | undefined;

/**
 * The trackers a user has connected through Clerk, read off the Clerk user
 * itself: no token round trip. A connection only counts if it isn't a
 * known-unverified (failed or abandoned) OAuth attempt; with no status exposed,
 * presence counts.
 *
 * Brief-held connections aren't on the Clerk user at all; connectedTrackers
 * covers both.
 */
export function connectedProviders(user: ClerkUserLike): ProviderKey[] {
  const live = (a: ExternalAccountLike) => a.verification?.status === undefined || a.verification?.status === "verified";
  return CLERK_PROVIDERS.filter((def) => {
    // An empty match string would match every account.
    const match = def.clerkMatch;
    if (!match) return false;
    return user?.externalAccounts?.some((a) => (a.provider ?? "").toLowerCase().includes(match) && live(a));
  }).map((def) => def.key);
}

/**
 * Every tracker a user has connected, through Clerk or Brief, in registry
 * order. Pass the Clerk user when the caller already has it (null counts as no
 * Clerk accounts); leave it out and it is fetched. A Clerk failure while
 * fetching it is thrown, so the caller decides what an unknown answer means.
 * A connection store (Supabase) failure is not: it reads as no owned
 * connections, since listConnectedProviders logs and degrades to none.
 */
export async function connectedTrackers(userId: string, user?: ClerkUserLike): Promise<ProviderKey[]> {
  const [clerkUser, owned] = await Promise.all([
    user === undefined ? getClerkUser(userId) : user,
    listConnectedProviders(userId),
  ]);
  return inRegistryOrder([...connectedProviders(clerkUser), ...owned]);
}

/**
 * The trackers worth trying for this user, so filing and /api/me resolve only
 * what is connected instead of probing all ten in turn. `clerkKnown` is false
 * when Clerk couldn't be read: then every tracker with a Clerk account is
 * tried rather than none, and a miss among them says nothing about what is
 * connected unless Brief holds a connection for it (`owned`).
 */
async function candidates(
  userId: string,
  user?: ClerkUserLike,
): Promise<{ defs: ProviderDef[]; clerkKnown: boolean; owned: Set<ProviderKey> }> {
  const [clerk, owned] = await Promise.all([
    (async () => {
      try {
        return connectedProviders(user === undefined ? await getClerkUser(userId) : user);
      } catch {
        return null;
      }
    })(),
    listConnectedProviders(userId),
  ]);
  const keys = new Set<ProviderKey>([...(clerk ?? CLERK_PROVIDERS.map((p) => p.key)), ...owned]);
  return { defs: PROVIDERS.filter((p) => keys.has(p.key)), clerkKnown: clerk !== null, owned: new Set(owned) };
}

/** A provider's check, with a throw read as stale: it can't file either way. */
async function runCheck(def: ProviderDef, userId: string): Promise<TrackerCheck> {
  try {
    return await def.check(userId);
  } catch {
    return { tracker: null, problem: "stale" };
  }
}

/** Check one tracker for this user, or null for a key the registry doesn't know. */
export async function checkTracker(userId: string, key: ProviderKey): Promise<TrackerCheck | null> {
  const def = providerDef(key);
  return def ? runCheck(def, userId) : null;
}

export const NO_TRACKER_ERROR = "No tracker connected - connect one in Settings, then retry.";

/** Copy for a connection still waiting on its workspace pick. */
export function workspacePickError(key: ProviderKey): string {
  return `Pick your ${providerName(key)} ${WORKSPACE_NOUN[key]} under Settings, then retry.`;
}

/** Copy for a tracker this deployment can't file into at all. */
export function unavailableError(key: ProviderKey): string {
  return `${providerName(key)} isn't available right now.`;
}

/**
 * The line that explains why none of these connected trackers could file, or
 * null when there is nothing to explain. A pending pick comes first because
 * it is the quickest fix, then an expired connection, and only then a tracker
 * the user can't do anything about.
 */
function issueFor(misses: Array<{ key: ProviderKey; problem: TrackerProblem }>): string | null {
  const pick = misses.find((m) => m.problem === "needsWorkspace");
  if (pick) return workspacePickError(pick.key);
  const stale = misses.filter((m) => m.problem === "stale").map((m) => m.key);
  if (stale.length) {
    return `Your ${stale.map(providerName).join(" and ")} connection has expired - reconnect it under Settings, then retry.`;
  }
  const off = misses.find((m) => m.problem === "unavailable");
  return off ? unavailableError(off.key) : null;
}

type Resolution = { key: ProviderKey; tracker: Tracker; issue: null } | { key: null; tracker: null; issue: string | null };

/**
 * The first connected tracker that resolves, in registry order, or the reason
 * none did. One pass: each candidate is checked once, and the same checks
 * explain a miss.
 */
async function resolveFirst(userId: string, user?: ClerkUserLike): Promise<Resolution> {
  const { defs, clerkKnown, owned } = await candidates(userId, user);
  const misses: Array<{ key: ProviderKey; problem: TrackerProblem }> = [];
  for (const def of defs) {
    const r = await runCheck(def, userId);
    if (r.tracker) return { key: def.key, tracker: r.tracker, issue: null };
    // A miss only says "expired" for a tracker known to be connected: one
    // Brief holds, or one Clerk said it holds.
    if (clerkKnown || owned.has(def.key)) misses.push({ key: def.key, problem: r.problem });
  }
  return { key: null, tracker: null, issue: issueFor(misses) };
}

/**
 * Resolve the tracker this user files into.
 *
 * Brief files into ONE tracker, so the first connected provider wins and the
 * order of PROVIDERS is the tie-break (Linear and Jira first, preserving the
 * behaviour that predates GitHub). `pinned` restricts the search to a single
 * provider: a brief that was filed to Jira must never be re-filed somewhere
 * else just because the user has since connected another tracker.
 *
 * A provider whose lookup throws is treated as not connected, so one broken
 * integration can't block filing to a working one.
 */
export async function resolveTracker(
  userId: string,
  pinned?: ProviderKey | null,
): Promise<Tracker | null> {
  return (await resolveTrackerOrError(userId, pinned)).tracker;
}

/** resolveTracker, plus the line to show the user when it finds nothing. */
export async function resolveTrackerOrError(
  userId: string,
  pinned?: ProviderKey | null,
): Promise<{ tracker: Tracker; error: null } | { tracker: null; error: string }> {
  if (pinned) {
    const r = await checkTracker(userId, pinned);
    if (r?.tracker) return { tracker: r.tracker, error: null };
    if (r?.problem === "needsWorkspace") return { tracker: null, error: workspacePickError(pinned) };
    if (r?.problem === "unavailable") return { tracker: null, error: unavailableError(pinned) };
    return {
      tracker: null,
      error: `${providerName(pinned)} is not connected - reconnect it under Settings, then retry.`,
    };
  }
  const r = await resolveFirst(userId);
  return r.tracker ? { tracker: r.tracker, error: null } : { tracker: null, error: r.issue ?? NO_TRACKER_ERROR };
}

/**
 * Which tracker this user files into, and when there is none but something is
 * connected, the line that says why (a pending workspace pick, an expired
 * connection). Pass the Clerk user when the caller already has it.
 */
export async function trackerStatus(
  userId: string,
  user?: ClerkUserLike,
): Promise<{ tracker: ProviderKey | null; issue: string | null }> {
  const r = await resolveFirst(userId, user);
  return { tracker: r.key, issue: r.issue };
}

/** Resolve every connected tracker, keyed by provider. Used by the live sync. */
export async function resolveConnectedTrackers(
  userId: string,
  keys: ProviderKey[],
): Promise<Map<ProviderKey, Tracker>> {
  const out = new Map<ProviderKey, Tracker>();
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      const def = providerDef(key);
      if (!def) return;
      try {
        const tracker = await def.resolve(userId);
        if (tracker) out.set(key, tracker);
      } catch {
        /* a tracker we can't reach simply contributes no live info */
      }
    }),
  );
  return out;
}
