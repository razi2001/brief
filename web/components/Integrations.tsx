"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import TrackerPicker from "./TrackerPicker";
import { TRACKER_DEFS, useTrackerConnect, type TrackerDef } from "./useTrackerConnect";
import type { ProviderKey } from "./provider-labels";

/**
 * The Settings page's issue tracker section. Connections are managed here via
 * the Clerk client API rather than through the `<UserProfile/>` "Connected
 * accounts" panel. The connect/disconnect logic lives in useTrackerConnect
 * (shared with the onboarding wizard); TrackerPicker is the card over it.
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

const OPTIONS = TRACKER_DEFS.map(({ key, name, caption }) => ({ key, name, caption }));

function defFor(key: ProviderKey): TrackerDef {
  return TRACKER_DEFS.find((d) => d.key === key)!;
}

export default function Integrations() {
  // Which connected trackers can't actually be used. Clerk reports an account
  // as verified while refusing to vend a token for it once the grant goes
  // stale, so "connected" on its own is not the truth - only the server can
  // tell, and it says so here. Fetched after paint: a slow tracker must not
  // hold the page, and until it answers nothing claims to be broken.
  const [stale, setStale] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/trackers/health", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setStale(Array.isArray(j.stale) ? j.stale : []))
      .catch(() => setStale([]));
  }, []);

  const {
    isLoaded,
    user,
    busy,
    errors,
    setTrackerError,
    isConnected,
    pendingAccount,
    pendingError,
    connect,
    disconnect,
  } = useTrackerConnect("/connections");
  // Set when the inline disconnect ultimately fails (user cancels the
  // reverification, or some other error), so we point them to account settings.
  const [needsAccount, setNeedsAccount] = useState<Record<string, boolean>>({});

  if (!isLoaded || !user) {
    return (
      <section id="integrations" className="scroll-mt-8">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Issue tracker</h2>
        <div className="mt-3">
          <SkeletonCard />
        </div>
      </section>
    );
  }

  const connected = TRACKER_DEFS.find((t) => isConnected(t))?.key ?? null;
  // A tracker whose last attempt didn't finish. Back from the OAuth round trip,
  // that is the one the card should open on, so its error is right there.
  const attempted =
    TRACKER_DEFS.find((t) => errors[t.key] || pendingAccount(t.providerMatch))?.key ?? null;

  async function handleDisconnect(key: ProviderKey) {
    setTrackerError(key, "");
    setNeedsAccount((m) => ({ ...m, [key]: false }));
    const ok = await disconnect(defFor(key));
    // Fall back to the account page, where Clerk's own UI can finish the job.
    if (!ok) setNeedsAccount((m) => ({ ...m, [key]: true }));
  }

  function messageFor(key: ProviderKey): ReactNode {
    const t = defFor(key);
    if (needsAccount[key]) {
      return (
        <>
          Couldn&apos;t remove it here -{" "}
          <Link href="/account" className="text-accent no-underline hover:underline">
            manage connections in account settings
          </Link>
          .
        </>
      );
    }
    if (errors[key]) return errors[key];
    // Only Clerk connections leave a half-finished record behind.
    if (isConnected(t) || !pendingAccount(t.providerMatch)) return null;
    // Show Clerk's actual verification error when it has one - "didn't finish"
    // alone gives the user nothing to act on.
    return ["Last connection didn’t finish", pendingError(t.providerMatch), "click Connect to try again."]
      .filter(Boolean)
      .join(" - ");
  }

  return (
    <section id="integrations" className="scroll-mt-8">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Issue tracker</h2>
      <div className="mt-3">
        <TrackerPicker
          options={OPTIONS}
          connected={connected}
          stale={stale}
          busy={busy}
          initialSelected={connected ? null : attempted}
          messageFor={messageFor}
          onConnect={(key) => connect(defFor(key))}
          onDisconnect={handleDisconnect}
        />
      </div>
    </section>
  );
}
