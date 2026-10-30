"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { EXTENSION_ID } from "@/lib/chrome-store";
import {
  EXT_PAIRED_EVENT,
  clearPendingExt,
  extIdFromRedirect,
  readPendingExt,
  rememberPendingExt,
} from "@/lib/extension-handoff";

type ChromeRuntime = {
  sendMessage?: (id: string, msg: unknown, cb?: (res?: { ok?: boolean }) => void) => void;
  lastError?: { message?: string };
};

function chromeRuntime(): ChromeRuntime | undefined {
  return (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

/**
 * Whether extension `extId` is installed and hears this page. It doesn't
 * answer a ping, but only a missing extension can't be reached at all.
 */
function installed(rt: ChromeRuntime, extId: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      rt.sendMessage!(extId, { type: "brief-cloud-ping" }, () => {
        resolve(!/receiving end does not exist/i.test(rt.lastError?.message ?? ""));
      });
    } catch {
      resolve(false);
    }
  });
}

/** An extension this tab offered a token to and that turned it down. */
const DECLINED_KEY = "briefExtDeclined";

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
      try {
        if (r?.ok) {
          localStorage.setItem("briefExtId", extId);
          localStorage.setItem("briefExtSyncedUser", userId);
        } else {
          sessionStorage.setItem(DECLINED_KEY, extId);
        }
      } catch {}
      if (r?.ok) window.dispatchEvent(new Event(EXT_PAIRED_EVENT));
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
 * paired once they're signed in (lib/extension-handoff). And it pairs the Web
 * Store extension when it's installed but this browser never paired it.
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

  // Never paired in this browser, yet the Web Store extension is installed:
  // its setup tab only opens /connect once the microphone is granted, so
  // someone who denied it, has none, or closed the tab stays unpaired. Pair it
  // here, on load and whenever this page comes back into view (installing
  // happens in other tabs, and the page hears a new extension without a reload).
  useEffect(() => {
    if (!authLoaded || !isSignedIn || !user) return;
    const userId = user.id;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState === "hidden") return;
      // /connect pairs its own ?ext=.
      if (window.location.pathname === "/connect") return;
      try {
        // A known extension: the effect above keeps it in sync.
        if (localStorage.getItem("briefExtId") || readPendingExt(localStorage)) return;
        // Turned a token down: not one per focus.
        if (sessionStorage.getItem(DECLINED_KEY) === EXTENSION_ID) return;
      } catch {
        return;
      }
      const rt = chromeRuntime();
      if (!rt?.sendMessage) return;
      busy = true;
      try {
        if (await installed(rt, EXTENSION_ID)) await pair(rt, EXTENSION_ID, userId);
      } finally {
        busy = false;
      }
    };
    void check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
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
