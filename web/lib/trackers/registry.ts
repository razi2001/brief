// The ONE place that enumerates trackers.
//
// Before this existed, "which providers are there" was spelled out in four
// places at once - an if/else ladder in run-processing, a hostname guess in
// ticket-sync, a hand-written pair of branches in the live sync, and a list of
// cards in the Connections UI. Adding a provider meant finding all four and
// getting each one right. Now an adapter is registered here and every one of
// those paths picks it up.
//
// Two kinds of connection meet here. Clerk-backed trackers (Linear, Jira,
// GitHub) are connected accounts on the Clerk user, and their tokens come from
// Clerk. The rest are connections Brief owns (lib/connections), whose OAuth
// grant lives in our own table: Clerk has no connection for most of them, and
// production's Clerk plan allows no social connection past those three, which
// rules out its GitLab and Notion ones. Past this file, nothing needs to know
// which kind a tracker is.

import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import { PROVIDER_LABELS, WORKSPACE_NOUN } from "@/lib/provider-labels";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getGithubToken, makeGithubTracker } from "@/lib/github";
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
  /** Who holds the token: a Clerk connected account, or Brief's own store. */
  auth: "clerk" | "owned";
  /**
   * Clerk-backed providers only. The strategy passed to createExternalAccount,
   * and the substring matched against externalAccount.provider. Both come from
   * clerk-strategies so a provider can be pointed at a custom Clerk connector
   * without a code change.
   */
  clerkStrategy?: string;
  clerkMatch?: string;
  /**
   * The token alone can't file: the user has to pick which workspace it files
   * into (an Azure DevOps organization, an Asana workspace). Until they do, the
   * connection is waiting on them, not broken.
   */
  requiresWorkspace?: boolean;
  /** Build a Tracker for this user, or null when they haven't connected it. */
  resolve: (userId: string) => Promise<Tracker | null>;
  /** The same resolve, with the reason when there is no Tracker. */
  check: (userId: string) => Promise<TrackerCheck>;
};

function clerkProvider(def: { key: ProviderKey; resolve: (userId: string) => Promise<Tracker | null> }): ProviderDef {
  return {
    ...def,
    name: PROVIDER_LABELS[def.key],
    auth: "clerk",
    clerkStrategy: clerkStrategy(def.key),
    clerkMatch: clerkMatch(def.key),
    // Clerk only says whether it will vend a token. A connected account it
    // won't vend one for is a grant gone stale.
    check: async (userId) => {
      const tracker = await def.resolve(userId);
      return tracker ? { tracker } : { tracker: null, problem: "stale" };
    },
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
    auth: "owned",
    check,
    resolve: async (userId) => (await check(userId)).tracker,
  };
}

export const PROVIDERS: ProviderDef[] = [
  clerkProvider({
    key: "linear",
    resolve: async (userId) => {
      const tok = await getLinearToken(userId);
      return tok ? makeLinearTracker(tok) : null;
    },
  }),
  clerkProvider({
    key: "jira",
    resolve: async (userId) => {
      const tok = await getJiraAuth(userId);
      if (!tok) return null;
      const cloud = await getJiraCloud(tok);
      return cloud ? makeJiraTracker(tok, cloud) : null;
    },
  }),
  clerkProvider({
    key: "github",
    resolve: async (userId) => {
      const tok = await getGithubToken(userId);
      return tok ? makeGithubTracker(tok) : null;
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

/** The trackers connected through Clerk, for the Connections UI. */
export const CLERK_PROVIDERS = PROVIDERS.filter((p) => p.auth === "clerk");

/** `keys` deduplicated and in registry order, the order filing tries them in. */
function inRegistryOrder(keys: ProviderKey[]): ProviderKey[] {
  const have = new Set(keys);
  return PROVIDERS.filter((p) => have.has(p.key)).map((p) => p.key);
}

type ExternalAccountLike = { provider?: string; verification?: { status?: string } | null };
type ClerkUserLike = { externalAccounts?: ExternalAccountLike[] } | null | undefined;

/**
 * The Clerk-backed trackers a user has connected, read off the Clerk user
 * itself: no token round trip. A connection only counts if it isn't a
 * known-unverified (failed or abandoned) OAuth attempt; with no status exposed,
 * presence counts.
 *
 * Owned connections aren't on the Clerk user at all; connectedTrackers covers
 * both.
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
 * Every tracker a user has connected, Clerk-backed and owned, in registry
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
 * when Clerk couldn't be read: then every Clerk-backed tracker is tried rather
 * than none, and a miss among them says nothing about what is connected.
 */
async function candidates(
  userId: string,
  user?: ClerkUserLike,
): Promise<{ defs: ProviderDef[]; clerkKnown: boolean }> {
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
  return { defs: PROVIDERS.filter((p) => keys.has(p.key)), clerkKnown: clerk !== null };
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
  const { defs, clerkKnown } = await candidates(userId, user);
  const misses: Array<{ key: ProviderKey; problem: TrackerProblem }> = [];
  for (const def of defs) {
    const r = await runCheck(def, userId);
    if (r.tracker) return { key: def.key, tracker: r.tracker, issue: null };
    // A Clerk-backed miss only says "expired" when Clerk said it was connected.
    if (clerkKnown || def.auth === "owned") misses.push({ key: def.key, problem: r.problem });
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
