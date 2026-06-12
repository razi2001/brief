"use client";

import { useEffect } from "react";
import { useAuth, useUser } from "@clerk/nextjs";

type ChromeRuntime = {
  chrome?: {
    runtime?: {
      sendMessage?: (id: string, msg: unknown, cb?: (res?: { ok?: boolean }) => void) => void;
      lastError?: unknown;
    };
  };
};

/**
 * Keeps the extension's pairing MIRRORING the web session, both ways:
 *  - signed in here as a different user than the extension last paired with →
 *    mint a fresh token and push it over (account switches propagate),
 *  - signed OUT here while the extension is still paired → tell it to drop
 *    the token, so "disconnected on the web" means disconnected everywhere.
 *
 * The /connect page records the extension id (localStorage "briefExtId") at
 * first pairing; "briefExtSyncedUser" tracks who the extension is paired as.
 * Mounted in the root layout so the sign-out case fires on the landing page
 * too. Renders nothing; silently no-ops outside Chrome or when never paired.
 */
export default function ExtensionTokenSync() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!authLoaded) return;
    let extId: string | null = null;
    let syncedUser: string | null = null;
    try {
      extId = localStorage.getItem("briefExtId");
      syncedUser = localStorage.getItem("briefExtSyncedUser");
    } catch {
      return;
    }
    if (!extId) return;
    const rt = (window as unknown as ChromeRuntime).chrome?.runtime;
    if (!rt?.sendMessage) return;

    // Signed out, extension still paired → unpair it.
    if (!isSignedIn) {
      if (!syncedUser) return;
      rt.sendMessage(extId, { type: "brief-cloud-disconnect" }, (r) => {
        void rt.lastError; // avoid "Unchecked runtime.lastError" noise
        if (r?.ok) {
          try {
            localStorage.removeItem("briefExtSyncedUser");
          } catch {}
        }
      });
      return;
    }

    // Signed in as someone the extension isn't paired with → re-pair.
    if (!user || syncedUser === user.id) return;
    (async () => {
      try {
        const res = await fetch("/api/extension-token", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const { token } = await res.json();
        rt.sendMessage!(extId!, { type: "brief-cloud-token", token }, (r) => {
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
  }, [authLoaded, isSignedIn, user]);

  return null;
}
