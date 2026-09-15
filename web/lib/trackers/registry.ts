// The ONE place that enumerates trackers.
//
// Before this existed, "which providers are there" was spelled out in four
// places at once - an if/else ladder in run-processing, a hostname guess in
// ticket-sync, a hand-written pair of branches in the live sync, and a list of
// cards in the Connections UI. Adding a provider meant finding all four and
// getting each one right. Now an adapter is registered here and every one of
// those paths picks it up.

import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getGithubToken, makeGithubTracker } from "@/lib/github";
import { clerkClient } from "@clerk/nextjs/server";
import { clerkMatch, clerkStrategy } from "@/lib/clerk-strategies";
import type { ProviderKey, Tracker } from "@/lib/tracker";

export type ProviderDef = {
  key: ProviderKey;
  /** Display name, used in UI and in user-facing error copy. */
  name: string;
  /**
   * The strategy passed to createExternalAccount, and the substring matched
   * against externalAccount.provider. Both come from clerk-strategies so a
   * provider can be pointed at a custom Clerk connector without a code change.
   */
  clerkStrategy: string;
  clerkMatch: string;
  /** Build a Tracker for this user, or null when they haven't connected it. */
  resolve: (userId: string) => Promise<Tracker | null>;
};

export const PROVIDERS: ProviderDef[] = [
  {
    key: "linear",
    name: "Linear",
    clerkStrategy: clerkStrategy("linear"),
    clerkMatch: clerkMatch("linear"),
    resolve: async (userId) => {
      const tok = await getLinearToken(userId);
      return tok ? makeLinearTracker(tok) : null;
    },
  },
  {
    key: "jira",
    name: "Jira",
    clerkStrategy: clerkStrategy("jira"),
    clerkMatch: clerkMatch("jira"),
    resolve: async (userId) => {
      const tok = await getJiraAuth(userId);
      if (!tok) return null;
      const cloud = await getJiraCloud(tok);
      return cloud ? makeJiraTracker(tok, cloud) : null;
    },
  },
  {
    key: "github",
    name: "GitHub",
    clerkStrategy: clerkStrategy("github"),
    clerkMatch: clerkMatch("github"),
    resolve: async (userId) => {
      const tok = await getGithubToken(userId);
      return tok ? makeGithubTracker(tok) : null;
    },
  },
];

export function providerDef(key: ProviderKey): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export function providerName(key: ProviderKey): string {
  return providerDef(key)?.name ?? key;
}

/** Every tracker, for the Connections UI. */
export const CLERK_PROVIDERS = PROVIDERS;

/**
 * Resolve the tracker this user files into.
 *
 * Brief files into ONE tracker, so the first connected provider wins and the
 * order of PROVIDERS is the tie-break (Linear and Jira first, preserving the
 * behaviour that predates GitHub). `pinned` restricts the search to a single
 * provider: a brief that was filed to Jira must never be re-filed somewhere
 * else just because the user has since connected another tracker.
 */
export async function resolveTracker(
  userId: string,
  pinned?: ProviderKey | null,
): Promise<Tracker | null> {
  const candidates = pinned ? PROVIDERS.filter((p) => p.key === pinned) : PROVIDERS;
  for (const def of candidates) {
    try {
      const tracker = await def.resolve(userId);
      if (tracker) return tracker;
    } catch {
      // A provider whose token lookup throws is treated as not connected, so
      // one broken integration can't block filing to a working one.
      continue;
    }
  }
  return null;
}

/** Which provider this user has connected, if any. Used by /api/me and the UI. */
export async function connectedProvider(userId: string): Promise<ProviderKey | null> {
  for (const def of PROVIDERS) {
    try {
      if (await def.resolve(userId)) return def.key;
    } catch {
      continue;
    }
  }
  return null;
}

/** Human-readable list of every tracker, for "no tracker connected" copy. */
export const ALL_PROVIDER_NAMES = PROVIDERS.map((p) => p.name).join(", ");

export const NO_TRACKER_ERROR = `No tracker connected - connect one (${ALL_PROVIDER_NAMES}) in Connections, then retry.`;

/**
 * Trackers that LOOK connected on the Clerk user record.
 *
 * This is deliberately not the same question as "can we file into it": Clerk
 * reports an account as verified while refusing to vend a token for it once
 * the grant goes stale. Telling someone in that state "no tracker connected"
 * sends them to a page that says Connected, which is a dead end - so the
 * filing error uses this to say "reconnect" instead.
 */
export async function looksConnected(userId: string): Promise<ProviderKey[]> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const accounts = user.externalAccounts ?? [];
    return PROVIDERS.filter((def) =>
      accounts.some((a) => {
        const provider = (a.provider ?? "").toLowerCase();
        const status = a.verification?.status;
        return provider.includes(def.clerkMatch) && (status === undefined || status === "verified");
      }),
    ).map((def) => def.key);
  } catch {
    return [];
  }
}

/**
 * The right thing to tell someone whose filing found no tracker: whether they
 * have none at all, or one whose connection has gone stale.
 */
export async function noTrackerError(userId: string): Promise<string> {
  const looks = await looksConnected(userId);
  if (looks.length === 0) return NO_TRACKER_ERROR;
  const names = looks.map(providerName).join(" and ");
  return `Your ${names} connection has expired - reconnect it under Connections, then retry.`;
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
