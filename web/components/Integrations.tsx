"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { TrackerLogo } from "./TrackerLogo";

/**
 * Dedicated Integrations section for trackers (Linear, Jira). Connections are
 * managed here via the Clerk client API rather than through the `<UserProfile/>`
 * "Connected accounts" panel.
 *
 * Clerk client API used (verified against @clerk/types in node_modules,
 * matching @clerk/nextjs v7.4.3):
 *   - user.createExternalAccount({ strategy, redirectUrl }): Promise<ExternalAccountResource>
 *       The returned account's verification.externalVerificationRedirectURL (a URL | null)
 *       is the OAuth URL the browser must navigate to.
 *   - externalAccount.destroy(): Promise<void>  — disconnects the account.
 *   - user.reload(): Promise<UserResource>      — refreshes externalAccounts after destroy.
 */

type Tracker = {
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

const TRACKERS: Tracker[] = [
  {
    key: "linear",
    name: "Linear",
    caption: "Files tickets with embedded evidence.",
    providerMatch: "linear",
    strategy: "oauth_linear",
    notEnabledHint:
      "Linear isn't enabled yet — add the Linear connection in Clerk.",
  },
  {
    key: "jira",
    name: "Jira",
    caption: "Atlassian Cloud — file to a project.",
    providerMatch: "atlassian",
    strategy: "oauth_atlassian",
    notEnabledHint:
      "Jira isn't enabled yet — add the Atlassian connection in Clerk.",
  },
];

function SkeletonCard() {
  return (
    <div className="card flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-cream-2" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-24 rounded bg-cream-2" />
          <div className="mt-2 h-2.5 w-48 max-w-full rounded bg-cream-2" />
        </div>
      </div>
      <div className="h-6 w-20 shrink-0 rounded-full bg-cream-2" />
    </div>
  );
}

export default function Integrations() {
  const { isLoaded, user } = useUser();
  // Per-tracker busy + error state, keyed by tracker key.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Set when Clerk refuses the inline disconnect (403 — sensitive action needs
  // its own reverification flow), so we point the user to account settings.
  const [needsAccount, setNeedsAccount] = useState<Record<string, boolean>>({});

  if (!isLoaded || !user) {
    return (
      <section id="integrations" className="scroll-mt-8">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Trackers · MCP</h2>
        <div className="mt-3 flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  const setTrackerBusy = (key: string, value: boolean) =>
    setBusy((b) => ({ ...b, [key]: value }));
  const setTrackerError = (key: string, value: string) =>
    setErrors((e) => ({ ...e, [key]: value }));

  // Only a VERIFIED external account counts as connected. Clerk creates an
  // (unverified) record even when the OAuth flow fails or is abandoned, so
  // checking mere existence would wrongly show "Connected".
  const accountFor = (providerMatch: string, verified: boolean) =>
    user.externalAccounts.find(
      (a) =>
        (a.provider ?? "").toLowerCase().includes(providerMatch) &&
        (verified
          ? a.verification?.status === "verified"
          : a.verification?.status !== "verified"),
    );
  const connectedAccount = (providerMatch: string) => accountFor(providerMatch, true);
  const pendingAccount = (providerMatch: string) => accountFor(providerMatch, false);

  async function handleConnect(t: Tracker) {
    setTrackerError(t.key, "");
    setTrackerBusy(t.key, true);
    try {
      // Clear out a previous failed/abandoned attempt so it can't linger and
      // look "connected" — and so the new attempt starts clean.
      const stale = pendingAccount(t.providerMatch);
      if (stale) {
        try {
          await stale.destroy();
          await user!.reload();
        } catch {
          /* ignore — proceed with a fresh attempt */
        }
      }
      const externalAccount = await user!.createExternalAccount({
        strategy: t.strategy,
        redirectUrl: window.location.origin + "/dashboard",
      });
      const redirectUrl =
        externalAccount.verification?.externalVerificationRedirectURL;
      if (redirectUrl) {
        // externalVerificationRedirectURL is a URL object; send the browser to it.
        window.location.href = redirectUrl.toString();
        return; // navigating away — keep the button in its busy state.
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

  async function handleDisconnect(t: Tracker) {
    const account = connectedAccount(t.providerMatch) ?? pendingAccount(t.providerMatch);
    if (!account) return;
    setTrackerError(t.key, "");
    setNeedsAccount((m) => ({ ...m, [t.key]: false }));
    setTrackerBusy(t.key, true);
    try {
      await account.destroy();
      await user!.reload();
    } catch {
      // Clerk blocks the inline removal (403). Its own account UI runs the
      // proper (reverification-aware) flow, so route the user there.
      setNeedsAccount((m) => ({ ...m, [t.key]: true }));
    } finally {
      setTrackerBusy(t.key, false);
    }
  }

  return (
    <section id="integrations" className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Trackers · MCP</h2>

      <div className="mt-3 flex flex-col gap-3">
        {TRACKERS.map((t) => {
          const account = connectedAccount(t.providerMatch);
          const isConnected = !!account;
          const pending = !isConnected && !!pendingAccount(t.providerMatch);
          const isBusy = !!busy[t.key];
          const error = errors[t.key];
          const showAccount = !!needsAccount[t.key];

          return (
            <div key={t.key} className="card px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border hairline bg-[#fffdf8]">
                    <TrackerLogo kind={t.key} size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{t.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{t.caption}</p>
                  </div>
                </div>

                {isConnected ? (
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="pill border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]">
                      Connected ✓
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(t)}
                      disabled={isBusy}
                      className="text-xs tracking-wide text-muted no-underline hover:text-accent hover:underline disabled:opacity-50"
                    >
                      {isBusy ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleConnect(t)}
                    disabled={isBusy}
                    className="shrink-0 text-xs tracking-wide text-accent no-underline hover:underline disabled:opacity-50"
                  >
                    {isBusy ? "Connecting…" : "Connect →"}
                  </button>
                )}
              </div>

              {showAccount ? (
                <p className="mt-2 border-t hairline pt-2 text-xs text-muted">
                  Couldn&apos;t remove it here —{" "}
                  <a
                    href="/account"
                    className="text-accent no-underline hover:underline"
                  >
                    manage connections in account settings
                  </a>
                  .
                </p>
              ) : (
                (error || pending) && (
                  <p className="mt-2 border-t hairline pt-2 text-xs text-muted">
                    {error || "Last connection didn’t finish — click Connect to try again."}
                  </p>
                )
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
