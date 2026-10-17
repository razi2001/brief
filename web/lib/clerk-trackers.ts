// The Clerk connected accounts left from before Linear, Jira and GitHub moved
// to Brief's own OAuth, and their removal. Done on the server, through Clerk's
// backend API, so the connect callback and the disconnect route can both do it.

import { clerkClient } from "@clerk/nextjs/server";
import { CLERK_PROVIDERS } from "@/lib/trackers/registry";
import { keepPhotoOf } from "@/lib/tracker-avatar";
import type { ProviderKey } from "@/lib/tracker";

/**
 * How a removal went:
 *  - `none`        there was no matching account
 *  - `done`        every matching account is gone, at least one removed
 *  - `kept`        an account was left because it is the user's only way to
 *                  sign in (logged); the rest are gone
 *  - `unreachable` the Clerk user could not be read, so nothing is known
 *  - `failed`      an account was found and Clerk refused to remove it
 */
export type ClerkRemoval = "none" | "done" | "kept" | "unreachable" | "failed";

/** The parts of a Clerk backend user this reads. */
type ClerkUserLike = {
  passwordEnabled?: boolean;
  hasImage?: boolean;
  imageUrl?: string;
  emailAddresses?: Array<{ verification?: { status?: string; strategy?: string } | null }>;
  externalAccounts?: Array<{ id: string; provider?: string; imageUrl?: string }>;
};

/**
 * Would removing `account` leave this user with no way to sign in? True when
 * they have no password, no other external account (beyond those already
 * removed) and no verified email address that came from anywhere but this
 * account's own OAuth. Tracker connections are connect-only on both Clerk
 * instances, so this should never hold; it guards against one that is not.
 */
export function isOnlySignIn(
  user: ClerkUserLike,
  account: { id: string; provider?: string },
  removed: ReadonlySet<string> = new Set(),
): boolean {
  if (user.passwordEnabled) return false;
  const others = (user.externalAccounts ?? []).filter((a) => a.id !== account.id && !removed.has(a.id));
  if (others.length) return false;
  const provider = (account.provider ?? "").toLowerCase();
  const viaThisAccount = `from_${provider.startsWith("oauth_") ? provider : `oauth_${provider}`}`;
  const ownEmail = (user.emailAddresses ?? []).some(
    (e) => e.verification?.status === "verified" && (e.verification.strategy ?? "").toLowerCase() !== viaThisAccount,
  );
  return !ownEmail;
}

/**
 * Remove the user's Clerk tracker accounts (Linear, Jira, GitHub), matched on
 * each tracker's Clerk provider string: every one of them, or only `only`'s.
 * An account that is the user's only way to sign in is left in place and
 * logged (`kept`), never removed.
 *
 * Matching relies on every Clerk tracker connection being connect-only
 * (`authenticatable: false`) on both Clerk instances; isOnlySignIn is the
 * backstop should one ever not be.
 */
export async function removeClerkTrackers(userId: string, only?: ProviderKey): Promise<ClerkRemoval> {
  // An empty match would match every account, sign-in ones included.
  const matches = CLERK_PROVIDERS.filter((d) => !only || d.key === only)
    .map((d) => (d.clerkMatch ?? "").toLowerCase())
    .filter(Boolean);
  if (!matches.length) return "none";

  let client: Awaited<ReturnType<typeof clerkClient>>;
  let user: ClerkUserLike;
  try {
    client = await clerkClient();
    user = await client.users.getUser(userId);
  } catch (err) {
    console.warn("[connect] could not read the Clerk user to remove tracker accounts:", errorName(err));
    return "unreachable";
  }

  const trackers = (user.externalAccounts ?? []).filter((a) => {
    const p = (a.provider ?? "").toLowerCase();
    return matches.some((m) => p.includes(m));
  });
  if (!trackers.length) return "none";
  const removed = new Set<string>();
  let kept = false;
  let photoKept = false;
  try {
    for (const account of trackers) {
      if (isOnlySignIn(user, account, removed)) {
        console.warn(`[connect] kept a ${account.provider} Clerk account: it is the user's only way to sign in`);
        kept = true;
        continue;
      }
      // The photo the user shows may be this account's: keep it on their
      // profile first, or deleting the account takes it away.
      if (!photoKept) {
        photoKept = await keepPhotoOf(user, account, (file) => client.users.updateUserProfileImage(userId, { file }));
      }
      await client.users.deleteUserExternalAccount({ userId, externalAccountId: account.id });
      removed.add(account.id);
    }
  } catch (err) {
    console.warn("[connect] could not remove a Clerk tracker account:", errorName(err));
    return "failed";
  }
  return kept ? "kept" : "done";
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown error";
}
