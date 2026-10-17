"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  EXT_PAIRED_EVENT,
  clearPendingExt,
  extIdFromRedirect,
  readPendingExt,
  rememberPendingExt,
} from "@/lib/extension-handoff";

type ChromeRuntime = {
  sendMessage?: (id: string, msg: unknown, cb?: (res?: { ok?: boolean }) => void) => void;
  lastError?: unknown;
};

function chromeRuntime(): ChromeRuntime | undefined {
  return (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

/**
 * Mints a token and hands it to extension `extId`. When the extension takes
 * it, records the pairing and says so on the page (EXT_PAIRED_EVENT).
 * `answered` runs once the extension replies, with whether it took the token;
 * a failed mint or fetch leaves it uncalled, so the next page load retries.
 */
async function pair(
  rt: ChromeRuntime,
  extId: string,
  userId: string,
  answered?: (ok: boolean) => void,
) {
  try {
    const res = await fetch("/api/extension-token", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const { token } = await res.json();
    rt.sendMessage!(extId, { type: "brief-cloud-token", token }, (r) => {
      void rt.lastError; // avoid "Unchecked runtime.lastError" noise
      if (r?.ok) {
        try {
          localStorage.setItem("briefExtId", extId);
          localStorage.setItem("briefExtSyncedUser", userId);
        } catch {}
        window.dispatchEvent(new Event(EXT_PAIRED_EVENT));
      }
      answered?.(!!r?.ok);
    });
  } catch {
    /* next page load retries */
  }
}

/**
 * Keeps the extension's pairing MIRRORING the web session, both ways:
 *  - signed in here as a different user than the extension last paired with →
 *    mint a fresh token and push it over (account switches propagate),
 *  - signed OUT here while the extension is still paired → tell it to drop
 *    the token, so "disconnected on the web" means disconnected everywhere.
 * It also finishes a pairing asked for before sign-up: an extension that sent
 * a signed-out visitor to /connect is remembered from the sign-in redirect and
 * paired once they're signed in (lib/extension-handoff).
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
    try {
      const asked = extIdFromRedirect(window.location.search, window.location.origin);
      if (asked) rememberPendingExt(localStorage, asked);
    } catch {}
    if (!authLoaded) return;
    let extId: string | null = null;
    let syncedUser: string | null = null;
    let pendingExt: string | null = null;
    try {
      extId = localStorage.getItem("briefExtId");
      syncedUser = localStorage.getItem("briefExtSyncedUser");
      pendingExt = readPendingExt(localStorage);
    } catch {
      return;
    }
    const rt = chromeRuntime();

    // Signed out, extension still paired → unpair it.
    if (!isSignedIn) {
      if (!extId || !rt?.sendMessage || !syncedUser) return;
      rt.sendMessage(extId, { type: "brief-cloud-disconnect" }, (r) => {
        void rt.lastError;
        if (r?.ok) {
          try {
            localStorage.removeItem("briefExtSyncedUser");
          } catch {}
        }
      });
      return;
    }
    if (!user) return;

    // A pairing asked for before sign-up. /connect pairs its own ?ext=, so
    // wait for it there; once it has, there's nothing left to do.
    if (pendingExt) {
      if (window.location.pathname === "/connect") return;
      if (pendingExt === extId && syncedUser === user.id) {
        clearPendingExt(localStorage);
        return;
      }
      if (!rt?.sendMessage) return; // kept for a page that can reach it
      void pair(rt, pendingExt, user.id, () => {
        // Taken or turned down, it's settled: don't mint one per page.
        try {
          clearPendingExt(localStorage);
        } catch {}
      });
      return;
    }

    // Signed in as someone the extension isn't paired with → re-pair.
    if (!extId || !rt?.sendMessage || syncedUser === user.id) return;
    void pair(rt, extId, user.id);
  }, [authLoaded, isSignedIn, user]);

  return null;
}

function subscribePaired(onChange: () => void) {
  window.addEventListener(EXT_PAIRED_EVENT, onChange);
  // /connect pairing in another tab (the extension's setup tab) writes there.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EXT_PAIRED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Whether the extension in this browser is paired as `userId`, kept live. */
export function useExtensionPaired(userId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribePaired,
    () => {
      try {
        return !!userId && localStorage.getItem("briefExtSyncedUser") === userId;
      } catch {
        return false;
      }
    },
    () => false,
  );
}
