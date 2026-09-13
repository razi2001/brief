"use client";

import { useState } from "react";
import { useUser, useReverification } from "@clerk/nextjs";
import { PROVIDER_LABELS, type ProviderKey } from "./provider-labels";
import { clerkMatch, clerkStrategy, extraScopes } from "@/lib/clerk-strategies";

/**
 * Shared client-side tracker-connection logic, used by both the Connections
 * page (Integrations) and the first-run onboarding wizard so they can't drift
 * apart.
 *
 * Every tracker here is a Clerk connected account, and only the Clerk CLIENT
 * can create or remove one, so these flows stay in the browser.
 *
 * Clerk client API used (verified against @clerk/types in node_modules,
 * matching @clerk/nextjs v7.4.3):
 *   - user.createExternalAccount({ strategy, redirectUrl }): Promise<ExternalAccountResource>
 *       The returned account's verification.externalVerificationRedirectURL (a URL | null)
 *       is the OAuth URL the browser must navigate to.
 *   - externalAccount.destroy(): Promise<void>  - disconnects the account.
 *   - user.reload(): Promise<UserResource>      - refreshes externalAccounts after destroy.
 */

export type TrackerDef = {
  key: ProviderKey;
  name: string;
  caption: string;
  // Substring matched against externalAccount.provider (e.g. "oauth_linear"),
  // and the strategy passed to createExternalAccount.
  providerMatch: string;
  strategy: string;
  // Inline copy shown when the provider isn't available in this deployment.
  notEnabledHint: string;
};

export const TRACKER_DEFS: TrackerDef[] = [
  {
    key: "linear",
    name: "Linear",
    caption: "Files tickets with embedded evidence.",
    providerMatch: clerkMatch("linear"),
    strategy: clerkStrategy("linear"),
    notEnabledHint: "Linear isn't enabled yet - add the Linear connection in Clerk.",
  },
  {
    key: "jira",
    name: "Jira",
    caption: "Atlassian Cloud - file to a project.",
    providerMatch: clerkMatch("jira"),
    strategy: clerkStrategy("jira"),
    notEnabledHint: "Jira isn't enabled yet - add the Atlassian connection in Clerk.",
  },
  {
    key: "github",
    name: "GitHub",
    caption: "File issues to a repository.",
    providerMatch: clerkMatch("github"),
    strategy: clerkStrategy("github"),
    notEnabledHint: "GitHub isn't enabled yet - add the GitHub connection in Clerk.",
  },
];

// Clerk's account-linking rejection when the OAuth account's email doesn't
// match any email on this user. Matched in pendingError (copy) and connect()
// (the auto-heal).
const EMAIL_MISMATCH_RE = /email address does not match|does not match your existing email/i;

/**
 * Pull something readable out of a Clerk client error. Clerk throws objects
 * carrying an `errors` array; the bare Error message is usually just
 * "ClerkAPIResponseError", which tells a user nothing.
 */
function clerkErrorMessage(err: unknown): string {
  const e = err as {
    errors?: Array<{ message?: string; longMessage?: string; code?: string }>;
    message?: string;
  };
  const first = e?.errors?.[0];
  if (first) {
    const text = first.longMessage || first.message || "";
    return first.code ? `${text} (${first.code})` : text;
  }
  return e?.message ?? "";
}

/**
 * Did this fail because the user dismissed Clerk's step-up verification?
 * That's a decision, not a fault, so it gets its own copy rather than a raw
 * `session_reverification_required` code.
 */
function isReverificationCancelled(err: unknown): boolean {
  const e = err as { errors?: Array<{ code?: string }>; code?: string; message?: string };
  const codes = [e?.code, e?.message, ...(e?.errors ?? []).map((x) => x.code)];
  return codes.some((c) => typeof c === "string" && /reverification/i.test(c));
}

export function useTrackerConnect(redirectPath = "/dashboard") {
  const { isLoaded, user } = useUser();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Removing a connected account is a Clerk "sensitive" action - this wrapper
  // pops the step-up reverification modal when required, then runs destroy.
  const destroyAccount = useReverification(
    (account: { destroy: () => Promise<unknown> }) => account.destroy(),
  );

  // CREATING one is sensitive too, which is easy to miss because it only
  // surfaces once the session is older than the reverification window (10
  // minutes by default). Sign in and connect immediately and it works; come
  // back to the page later and Clerk throws session_reverification_required.
  // Wrapping it here pops the same verify modal and retries, instead of
  // failing with an error that looks like a misconfigured provider.
  const createAccount = useReverification(
    (params: Parameters<NonNullable<typeof user>["createExternalAccount"]>[0]) =>
      user!.createExternalAccount(params),
  );

  const setTrackerBusy = (key: string, value: boolean) => setBusy((b) => ({ ...b, [key]: value }));
  const setTrackerError = (key: string, value: string) =>
    setErrors((e) => ({ ...e, [key]: value }));

  // Only a VERIFIED external account counts as connected. Clerk creates an
  // (unverified) record even when the OAuth flow fails or is abandoned, so
  // checking mere existence would wrongly show "Connected".
  const accountFor = (providerMatch: string, verified: boolean) =>
    user?.externalAccounts.find(
      (a) =>
        (a.provider ?? "").toLowerCase().includes(providerMatch) &&
        (verified ? a.verification?.status === "verified" : a.verification?.status !== "verified"),
    );

  /** Is this tracker connected? */
  const isConnected = (t: TrackerDef): boolean => !!accountFor(t.providerMatch, true);

  const connectedAccount = (providerMatch: string) => accountFor(providerMatch, true);
  const pendingAccount = (providerMatch: string) => accountFor(providerMatch, false);

  // The REASON the last OAuth attempt didn't verify - rewritten to something
  // actionable where we recognize the Clerk error, otherwise Clerk's own text.
  // Empty when there's no pending record or Clerk attached no error to it.
  const pendingError = (providerMatch: string): string => {
    const v = pendingAccount(providerMatch)?.verification;
    if (!v || v.status === "verified") return "";
    const raw = v.error?.longMessage || v.error?.message || "";
    const def = TRACKER_DEFS.find((t) => t.providerMatch === providerMatch);
    const name = def?.name ?? "tracker";
    // Clerk's account-linking guard: this OAuth identity/email already belongs
    // to a different Brief account. Tell the user what to actually do.
    if (/claimed by another user|already.*(connected|linked|associated)/i.test(raw)) {
      return `This ${name} account is already linked to a different Brief account. Disconnect it there (or sign in with that account) before connecting it here.`;
    }
    // Clerk requires the OAuth account's email to match one of THIS account's
    // emails. We handle it: Connect adopts the provider's email onto this
    // account and retries - the user just has to click again.
    if (EMAIL_MISMATCH_RE.test(raw)) {
      return `Your ${name} login uses a different email than this account - that's fine. Hit Connect again and it will be linked.`;
    }
    return raw;
  };

  /**
   * Brief files into ONE tracker, so connecting a new one drops every other.
   * Clerk accounts can only be removed by the Clerk client, which is why this
   * happens here rather than server-side; owned connections are cleared by the
   * callback route once the new one lands.
   * Returns false if the user cancelled the reverification needed to remove one.
   */
  async function disconnectOtherTrackers(keep: ProviderKey): Promise<boolean> {
    if (!user) return true;
    const otherMatches = TRACKER_DEFS.filter((d) => d.key !== keep).map((d) => d.providerMatch);
    const others = user.externalAccounts.filter((a) =>
      otherMatches.some((m) => (a.provider ?? "").toLowerCase().includes(m)),
    );
    try {
      for (const acc of others) await destroyAccount(acc);
      if (others.length) await user.reload();
    } catch {
      // Reverification cancelled, or removal failed.
      return false;
    }
    return true;
  }

  async function connect(t: TrackerDef) {
    if (!user) return;
    setTrackerError(t.key, "");
    setTrackerBusy(t.key, true);
    try {
      // One tracker at a time: drop the others before switching. If the user
      // cancels the reverification to remove one, abort - don't connect both.
      const switched = await disconnectOtherTrackers(t.key);
      if (!switched) {
        setTrackerError(
          t.key,
          "Couldn't switch trackers - you'll need to disconnect the current one first.",
        );
        setTrackerBusy(t.key, false);
        return;
      }

      const providerMatch = t.providerMatch;
      // Different-email linking: when the last attempt failed because the
      // provider account's email isn't on this user, adopt that email onto
      // the account (server verifies it came from the user's own OAuth
      // attempt) so THIS attempt links cleanly. Different emails are fine.
      const stale = pendingAccount(providerMatch);
      const staleErr =
        stale?.verification?.error?.longMessage || stale?.verification?.error?.message || "";
      if (stale?.emailAddress && EMAIL_MISMATCH_RE.test(staleErr)) {
        try {
          const r = await fetch("/api/account/link-email", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: stale.emailAddress }),
          });
          if (r.ok) await user.reload();
        } catch {
          /* best-effort - the retry below surfaces any remaining error */
        }
      }
      // Clear out a previous failed/abandoned attempt so it can't linger and
      // look "connected" - and so the new attempt starts clean.
      if (stale) {
        try {
          await stale.destroy();
          await user.reload();
        } catch {
          /* ignore - proceed with a fresh attempt */
        }
      }
      // additionalScopes is what lets a BUILT-IN Clerk connection ask for more
      // than sign-in permissions - without it GitHub hands back a token that
      // can read a profile and nothing else.
      const scopes = extraScopes(t.key);
      const externalAccount = await createAccount({
        strategy: t.strategy as Parameters<typeof user.createExternalAccount>[0]["strategy"],
        redirectUrl: window.location.origin + redirectPath,
        ...(scopes ? { additionalScopes: scopes } : {}),
      });
      const redirectUrl = externalAccount.verification?.externalVerificationRedirectURL;
      if (redirectUrl) {
        // externalVerificationRedirectURL is a URL object; send the browser to it.
        window.location.href = redirectUrl.toString();
        return; // navigating away - keep the button in its busy state.
      }
      // Clerk accepted the call but gave us nowhere to send the browser. The
      // verification object usually says why.
      const why =
        externalAccount.verification?.error?.longMessage ||
        externalAccount.verification?.error?.message ||
        "";
      console.error(`[connect:${t.key}] no redirect url`, externalAccount.verification);
      setTrackerError(t.key, why || t.notEnabledHint);
      setTrackerBusy(t.key, false);
    } catch (err) {
      // Show what Clerk actually said. Guessing "the provider isn't enabled"
      // was actively misleading whenever the real cause was something else -
      // a missing scope, a reverification the user dismissed, an account
      // already linked elsewhere.
      console.error(`[connect:${t.key}]`, err);
      setTrackerError(
        t.key,
        isReverificationCancelled(err)
          ? `Connecting ${t.name} needs you to confirm it's you. Hit Connect again and complete the verification step.`
          : clerkErrorMessage(err) || t.notEnabledHint,
      );
      setTrackerBusy(t.key, false);
    }
  }

  /** Disconnect either kind. Returns false when it couldn't be removed here. */
  async function disconnect(t: TrackerDef): Promise<boolean> {
    setTrackerError(t.key, "");
    setTrackerBusy(t.key, true);
    try {
      const providerMatch = t.providerMatch;
      const account = connectedAccount(providerMatch) ?? pendingAccount(providerMatch);
      if (!account) return true;
      // Pops Clerk's reverification modal if needed, then removes the account.
      await destroyAccount(account);
      await user?.reload();
      return true;
    } catch {
      return false;
    } finally {
      setTrackerBusy(t.key, false);
    }
  }

  return {
    isLoaded,
    user,
    busy,
    errors,
    setTrackerBusy,
    setTrackerError,
    isConnected,
    connectedAccount,
    pendingAccount,
    pendingError,
    connect,
    disconnect,
    PROVIDER_LABELS,
  };
}
