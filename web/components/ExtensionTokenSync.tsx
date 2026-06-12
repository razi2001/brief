"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";

type ChromeRuntime = {
  chrome?: {
    runtime?: {
      sendMessage?: (id: string, msg: unknown, cb?: (res?: { ok?: boolean }) => void) => void;
      lastError?: unknown;
    };
  };
};

/**
 * Keeps the extension paired with WHOEVER is signed in here. The /connect page
 * records the extension id (localStorage "briefExtId"); on app load, if the
 * signed-in user differs from the last user we synced to the extension, mint a
 * fresh token and push it over. Switching web accounts then propagates to the
 * extension automatically - no re-pairing, no filing into a stale account.
 * Renders nothing; silently no-ops outside Chrome or when never paired.
 */
export default function ExtensionTokenSync() {
  const { isLoaded, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !user) return;
    let extId: string | null = null;
    try {
      extId = localStorage.getItem("briefExtId");
      if (!extId || localStorage.getItem("briefExtSyncedUser") === user.id) return;
    } catch {
      return;
    }
    const rt = (window as unknown as ChromeRuntime).chrome?.runtime;
    if (!rt?.sendMessage) return;

    (async () => {
      try {
        const res = await fetch("/api/extension-token", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const { token } = await res.json();
        rt.sendMessage!(extId!, { type: "brief-cloud-token", token }, (r) => {
          // Touch lastError so Chrome doesn't log "Unchecked runtime.lastError"
          // when the extension isn't installed in this profile.
          void rt.lastError;
          if (r?.ok) {
            try {
              localStorage.setItem("briefExtSyncedUser", user.id);
            } catch {}
          }
        });
      } catch {
        /* next page load retries */
      }
    })();
  }, [isLoaded, user]);

  return null;
}
