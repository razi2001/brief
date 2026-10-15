"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import TrackerPicker from "./TrackerPicker";
import { NOT_AVAILABLE, TRACKER_DEFS, TRACKER_OPTIONS, useTrackerConnect, type TrackerDef } from "./useTrackerConnect";
import type { ProviderKey } from "./provider-labels";

/**
 * The Settings page's issue tracker section. Connections are managed here
 * rather than through the `<UserProfile/>` "Connected accounts" panel: through
 * Brief's own OAuth routes, and for Linear, Jira and GitHub on a deployment
 * without Brief's app for them, through the Clerk client API. The
 * connect/disconnect logic lives in useTrackerConnect (shared with the
 * onboarding wizard); TrackerPicker is the card over it.
 */

function SkeletonCard() {
  return (
    <div className="card flex items-center justify-between gap-3 px-3.5 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="h-9 w-9 shrink-0 rounded-lg bg-surface-2" />
        <div className="min-w-0 flex-1">
          <div className="h-3 w-20 rounded bg-surface-2" />
          <div className="mt-2 h-2.5 w-44 max-w-full rounded bg-surface-2" />
        </div>
      </div>
      <div className="h-7 w-24 shrink-0 rounded-lg bg-surface-2" />
    </div>
  );
}

function defFor(key: ProviderKey): TrackerDef {
  return TRACKER_DEFS.find((d) => d.key === key)!;
}

const asKeys = (v: unknown): ProviderKey[] => (Array.isArray(v) ? (v as ProviderKey[]) : []);

export default function Integrations() {
  // Which connected trackers can't actually be used. Clerk reports an account
  // as verified while refusing to vend a token for it once the grant goes
  // stale, so "connected" on its own is not the truth - only the server can
  // tell, and it says so here. It also names the ones still waiting on a
  // workspace pick, which are not broken. Fetched after paint: a slow tracker
  // must not hold the page, and until it answers nothing claims to be broken.
  const [health, setHealth] = useState<{ stale: ProviderKey[]; needsWorkspace: ProviderKey[] }>({
    stale: [],
    needsWorkspace: [],
  });
  useEffect(() => {
    fetch("/api/trackers/health", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => setHealth({ stale: asKeys(j?.stale), needsWorkspace: asKeys(j?.needsWorkspace) }))
      .catch(() => setHealth({ stale: [], needsWorkspace: [] }));
  }, []);

  const {
    isLoaded,
    user,
    busy,
    errors,
    notice,
    lastError,
    setTrackerError,
    isConnected,
    isAvailable,
    connectedAccount,
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
      <SkeletonCard />
    );
  }

  const connected = TRACKER_DEFS.find((t) => isConnected(t))?.key ?? null;
  // A tracker whose last attempt didn't finish. Back from the OAuth round trip,
  // that is the one the card should open on, so its error is right there.
  const errored = TRACKER_DEFS.find((t) => errors[t.key])?.key ?? null;
  const attempted =
    errored ?? TRACKER_DEFS.find((t) => pendingAccount(t.providerMatch))?.key ?? null;
  // A switch to an owned tracker that came back with an error left the current
  // one connected, so the card opens on the attempt rather than hiding it.
  const initialSelected = connected ? errored : attempted;
  const unavailable = TRACKER_DEFS.filter((t) => !isAvailable(t)).map((t) => t.key);

  async function handleDisconnect(key: ProviderKey) {
    const t = defFor(key);
    setTrackerError(key, "");
    setNeedsAccount((m) => ({ ...m, [key]: false }));
    const ok = await disconnect(t);
    // A Clerk account left from before the move can still be removed on the
    // account page, where Clerk's own UI can finish the job. Nothing else has
    // such a page; the hook already set its error.
    if (!ok && connectedAccount(t.providerMatch)) setNeedsAccount((m) => ({ ...m, [key]: true }));
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
    // The card's own status already says a tracker isn't available yet.
    if (errors[key] && !(errors[key] === NOT_AVAILABLE && unavailable.includes(key))) {
      // The provider's own words, when the server had them, under the message.
      const detail = lastError?.provider === key ? lastError.detail : undefined;
      if (!detail) return errors[key];
      return (
        <>
          {errors[key]}
          <span className="mt-1 line-clamp-3 break-words text-[11px] opacity-80" title={detail}>
            {detail}
          </span>
        </>
      );
    }
    // Only Clerk connections leave a half-finished record behind.
    if (isConnected(t) || !pendingAccount(t.providerMatch)) return null;
    // Show Clerk's actual verification error when it has one - "didn't finish"
    // alone gives the user nothing to act on.
    return ["Last connection didn’t finish", pendingError(t.providerMatch), "click Connect to try again."]
      .filter(Boolean)
      .join(" - ");
  }

  return (
    <TrackerPicker
          options={TRACKER_OPTIONS}
          connected={connected}
          stale={health.stale}
          needsWorkspace={health.needsWorkspace}
          unavailable={unavailable}
          busy={busy}
          initialSelected={initialSelected}
          messageFor={messageFor}
          notice={notice}
          onConnect={(key) => connect(defFor(key))}
          onDisconnect={handleDisconnect}
        />
  );
}
