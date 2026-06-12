"use client";

import { useState } from "react";
import Link from "next/link";
import { useReverification } from "@clerk/nextjs";
import { TrackerLogo } from "./TrackerLogo";
import { TRACKER_DEFS, useTrackerConnect, type TrackerDef } from "./useTrackerConnect";

/**
 * Dedicated Integrations section for trackers (Linear, Jira). Connections are
 * managed here via the Clerk client API rather than through the `<UserProfile/>`
 * "Connected accounts" panel. The connect flow itself lives in
 * useTrackerConnect (shared with the onboarding wizard); this component adds
 * the card UI and the disconnect flow.
 */

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
  const {
    isLoaded,
    user,
    busy,
    errors,
    setTrackerBusy,
    setTrackerError,
    connectedAccount,
    pendingAccount,
    connect,
  } = useTrackerConnect("/dashboard");
  // Set when the inline disconnect ultimately fails (user cancels the
  // reverification, or some other error), so we point them to account settings.
  const [needsAccount, setNeedsAccount] = useState<Record<string, boolean>>({});

  // Removing a connected account is a "sensitive" action: Clerk requires
  // step-up reverification (session_reverification_required). useReverification
  // wraps the call so it pops Clerk's verify-code modal inline and retries the
  // destroy on success — no leaving the page.
  const destroyAccount = useReverification(
    (account: { destroy: () => Promise<unknown> }) => account.destroy(),
  );

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

  async function handleDisconnect(t: TrackerDef) {
    const account = connectedAccount(t.providerMatch) ?? pendingAccount(t.providerMatch);
    if (!account) return;
    setTrackerError(t.key, "");
    setNeedsAccount((m) => ({ ...m, [t.key]: false }));
    setTrackerBusy(t.key, true);
    try {
      // Pops Clerk's reverification modal if needed, then removes the account.
      await destroyAccount(account);
      await user!.reload();
    } catch {
      // Reverification cancelled or some other failure — fall back to the
      // account page, where Clerk's own UI can complete the removal.
      setNeedsAccount((m) => ({ ...m, [t.key]: true }));
    } finally {
      setTrackerBusy(t.key, false);
    }
  }

  return (
    <section id="integrations" className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Trackers · MCP</h2>

      <div className="mt-3 flex flex-col gap-3">
        {TRACKER_DEFS.map((t) => {
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
                    onClick={() => connect(t)}
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
                  <Link
                    href="/account"
                    className="text-accent no-underline hover:underline"
                  >
                    manage connections in account settings
                  </Link>
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
