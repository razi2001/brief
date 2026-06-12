"use client";

import { useState } from "react";
import { useUser, useReverification } from "@clerk/nextjs";

/**
 * Shared client-side tracker-connection logic (Clerk OAuth external accounts),
 * used by both the Connections page (Integrations) and the first-run
 * onboarding wizard so they can't drift apart.
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
  key: "linear" | "jira";
  name: string;
  caption: string;
  // Substring matched against externalAccount.provider (e.g. "oauth_linear",
  // "oauth_atlassian"), and the strategy passed to createExternalAccount.
  providerMatch: string;
  strategy: "oauth_linear" | "oauth_atlassian";
  // Inline copy shown when the provider isn't enabled in the Clerk instance.
  notEnabledHint: string;
};

export const TRACKER_DEFS: TrackerDef[] = [
  {
    key: "linear",
    name: "Linear",
    caption: "Files tickets with embedded evidence.",
    providerMatch: "linear",
    strategy: "oauth_linear",
    notEnabledHint: "Linear isn't enabled yet - add the Linear connection in Clerk.",
  },
  {
    key: "jira",
    name: "Jira",
    caption: "Atlassian Cloud - file to a project.",
    providerMatch: "atlassian",
    strategy: "oauth_atlassian",
    notEnabledHint: "Jira isn't enabled yet - add the Atlassian connection in Clerk.",
  },
];

export function useTrackerConnect(redirectPath = "/dashboard") {
  const { isLoaded, user } = useUser();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Removing a connected account is a Clerk "sensitive" action - this wrapper
  // pops the step-up reverification modal when required, then runs destroy.
  const destroyAccount = useReverification(
    (account: { destroy: () => Promise<unknown> }) => account.destroy(),
  );

  const setTrackerBusy = (key: string, value: boolean) =>
    setBusy((b) => ({ ...b, [key]: value }));
  const setTrackerError = (key: string, value: string) =>
    setErrors((e) => ({ ...e, [key]: value }));

  // Only a VERIFIED external account counts as connected. Clerk creates an
  // (unverified) record even when the OAuth flow fails or is abandoned, so
  // checking mere existence would wrongly show "Connected".
  const accountFor = (providerMatch: string, verified: boolean) =>
    user?.externalAccounts.find(
      (a) =>
        (a.provider ?? "").toLowerCase().includes(providerMatch) &&
        (verified
          ? a.verification?.status === "verified"
          : a.verification?.status !== "verified"),
    );
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
    // emails. Spell out both ways to fix it instead of Clerk's dead-end copy.
    if (/email address does not match|does not match your existing email/i.test(raw)) {
      return `Your ${name} login uses a different email than this Brief account. Fix either side: sign in to ${name} with this account's email, or add your ${name} email to this account first (Account page, "add email"), then hit Connect again.`;
    }
    return raw;
  };

  // Brief files into ONE tracker, so connecting a new one drops any other.
  // Returns false if the user cancelled the reverification needed to remove it.
  async function disconnectOtherTrackers(keepProviderMatch: string): Promise<boolean> {
    if (!user) return true;
    const others = user.externalAccounts.filter(
      (a) =>
        TRACKER_DEFS.some((d) => (a.provider ?? "").toLowerCase().includes(d.providerMatch)) &&
        !(a.provider ?? "").toLowerCase().includes(keepProviderMatch),
    );
    if (!others.length) return true;
    try {
      for (const acc of others) await destroyAccount(acc);
      await user.reload();
      return true;
    } catch {
      // Reverification cancelled, or removal failed.
      return false;
    }
  }

  async function connect(t: TrackerDef) {
    if (!user) return;
    setTrackerError(t.key, "");
    setTrackerBusy(t.key, true);
    try {
      // One tracker at a time: drop the other before switching. If the user
      // cancels the reverification to remove it, abort - don't connect both.
      const switched = await disconnectOtherTrackers(t.providerMatch);
      if (!switched) {
        setTrackerError(
          t.key,
          "Couldn't switch trackers - you'll need to disconnect the current one first.",
        );
        setTrackerBusy(t.key, false);
        return;
      }
      // Clear out a previous failed/abandoned attempt so it can't linger and
      // look "connected" - and so the new attempt starts clean.
      const stale = pendingAccount(t.providerMatch);
      if (stale) {
        try {
          await stale.destroy();
          await user.reload();
        } catch {
          /* ignore - proceed with a fresh attempt */
        }
      }
      const externalAccount = await user.createExternalAccount({
        strategy: t.strategy,
        redirectUrl: window.location.origin + redirectPath,
      });
      const redirectUrl =
        externalAccount.verification?.externalVerificationRedirectURL;
      if (redirectUrl) {
        // externalVerificationRedirectURL is a URL object; send the browser to it.
        window.location.href = redirectUrl.toString();
        return; // navigating away - keep the button in its busy state.
      }
      // No redirect URL returned: nothing to navigate to. Surface a hint.
      setTrackerError(t.key, t.notEnabledHint);
      setTrackerBusy(t.key, false);
    } catch {
      // Most commonly the provider isn't enabled in the Clerk instance.
      setTrackerError(t.key, t.notEnabledHint);
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
    connectedAccount,
    pendingAccount,
    pendingError,
    connect,
  };
}
