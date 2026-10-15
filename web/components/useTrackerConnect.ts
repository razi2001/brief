"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser, useReverification } from "@clerk/nextjs";
import { NOT_AVAILABLE, PROVIDER_LABELS, type ProviderKey } from "./provider-labels";
import { clerkMatch, clerkStrategy, extraScopes } from "@/lib/clerk-strategies";

/**
 * Shared client-side tracker-connection logic, used by both the Connections
 * page (Integrations) and the first-run onboarding wizard so they can't drift
 * apart.
 *
 * Two kinds of connection sit behind one Connect button:
 *
 *  - "clerk" trackers (Linear, Jira, GitHub) are Clerk connected accounts.
 *    Only the Clerk CLIENT can create or remove one, so those flows stay in
 *    the browser.
 *  - "owned" trackers (GitLab, Azure DevOps, ClickUp, Notion, Trello, Asana,
 *    Monday) have no Clerk connection, so Brief runs the OAuth flow itself
 *    through /api/connect/<provider> and keeps the token. The browser only
 *    navigates to the start route; the callback stores the token, removes
 *    every other tracker, and sends the browser back with ?connected= or
 *    ?error=.
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
  auth: "clerk" | "owned";
  // Clerk trackers only: substring matched against externalAccount.provider
  // (e.g. "oauth_linear"), and the strategy passed to createExternalAccount.
  providerMatch?: string;
  strategy?: string;
};

function clerkDef(key: ProviderKey, caption: string): TrackerDef {
  return {
    key,
    name: PROVIDER_LABELS[key],
    caption,
    auth: "clerk",
    providerMatch: clerkMatch(key),
    strategy: clerkStrategy(key),
  };
}

function ownedDef(key: ProviderKey, caption: string): TrackerDef {
  return { key, name: PROVIDER_LABELS[key], caption, auth: "owned" };
}

/** Every tracker, in the registry's order. */
export const TRACKER_DEFS: TrackerDef[] = [
  clerkDef("linear", "Files tickets with embedded evidence."),
  clerkDef("jira", "Atlassian Cloud - file to a project."),
  clerkDef("github", "File issues to a repository."),
  ownedDef("gitlab", "File issues to a project."),
  ownedDef("azure", "File work items to a project."),
  ownedDef("clickup", "File tasks to a list."),
  ownedDef("notion", "File pages to a database."),
  ownedDef("trello", "File cards to a board."),
  ownedDef("asana", "File tasks to a project."),
  ownedDef("monday", "File items to a board."),
];

/** The card's dropdown: every tracker, in the registry's order. */
export const TRACKER_OPTIONS = TRACKER_DEFS.map(({ key, name, caption }) => ({ key, name, caption }));

/** A tracker Brief connected itself, as /api/me/connections reports it. */
export type OwnedConnection = {
  provider: ProviderKey;
  label: string | null;
  workspace: { id: string; name: string } | null;
};

// Clerk's account-linking rejection when the OAuth account's email doesn't
// match any email on this user. Matched in pendingError (copy) and connect()
// (the auto-heal).
const EMAIL_MISMATCH_RE = /email address does not match|does not match your existing email/i;

export { NOT_AVAILABLE };

const COULDNT_CONNECT = "Couldn't connect";

/**
 * Copy for each failure code the connect callback sends back. Anyone can put
 * anything in a query string, so the raw value is never shown: an unknown
 * code reads as a plain failure.
 */
function returnErrorCopy(code: string, name: string): string {
  switch (code) {
    case "cancelled":
      return "Connection cancelled";
    case "unavailable":
      return NOT_AVAILABLE;
    case "no_org":
      return `No ${name} organization on this account`;
    case "no_workspace":
      return `No ${name} workspace on this account`;
    default:
      return COULDNT_CONNECT;
  }
}

type ReturnError = { key: ProviderKey | null; message: string };

/**
 * The failure an owned connect came back with: `?error=<code>&provider=<key>`.
 * Read once, at first render, so the card can open on that tracker with the
 * message already on it. A provider we don't know leaves the message
 * unattributed.
 */
function readReturnError(): ReturnError | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = (params.get("error") ?? "").trim();
  if (!code) return null;
  const def = TRACKER_DEFS.find((d) => d.key === params.get("provider"));
  if (!def) return { key: null, message: COULDNT_CONNECT };
  return { key: def.key, message: returnErrorCopy(code, def.name) };
}

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

type OwnedState = { owned: OwnedConnection[]; configured: Partial<Record<ProviderKey, boolean>> };

/** Ask the server about the trackers Brief connects itself. Null on failure. */
async function fetchOwned(): Promise<OwnedState | null> {
  try {
    const r = await fetch("/api/me/connections", { credentials: "same-origin" });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial<OwnedState>;
    return {
      owned: Array.isArray(j.owned) ? j.owned : [],
      configured: j.configured && typeof j.configured === "object" ? j.configured : {},
    };
  } catch {
    return null;
  }
}

/** POST an owned tracker's disconnect. True when the server removed it. */
async function postDisconnect(key: ProviderKey): Promise<boolean> {
  try {
    const r = await fetch(`/api/connect/${key}/disconnect`, {
      method: "POST",
      credentials: "same-origin",
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function useTrackerConnect(redirectPath = "/dashboard") {
  const { isLoaded, user } = useUser();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Seeded from an owned connect's ?error=, so the message is on screen on the
  // first paint back from the provider.
  const [returned] = useState(readReturnError);
  const [errors, setErrors] = useState<Record<string, string>>(() =>
    returned?.key ? { [returned.key]: returned.message } : {},
  );
  // An error that names no tracker, shown on whichever one the card is on.
  const [notice, setNotice] = useState(() => (returned && !returned.key ? returned.message : ""));

  // The owned trackers need a round trip (Clerk accounts are already on the
  // user object): fetched once the user is known, again after a disconnect.
  const [owned, setOwned] = useState<OwnedConnection[]>([]);
  // false = this deployment has no OAuth app for it, so Connect can only fail.
  // Missing (not loaded, or the read failed) counts as available: the start
  // route still refuses with a message of its own.
  const [configured, setConfigured] = useState<Partial<Record<ProviderKey, boolean>>>({});
  const [ownedLoaded, setOwnedLoaded] = useState(false);

  const applyOwned = useCallback((state: OwnedState | null) => {
    if (state) {
      setOwned(state.owned);
      setConfigured(state.configured);
    }
    setOwnedLoaded(true);
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchOwned().then((state) => {
      if (!cancelled) applyOwned(state);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, applyOwned]);

  const refreshOwned = useCallback(async () => applyOwned(await fetchOwned()), [applyOwned]);

  /**
   * Re-read the owned trackers after some were removed. When the read fails,
   * the server already said those are gone, so they come off the list here
   * rather than lingering as "Connected".
   */
  const refreshOwnedOrDrop = useCallback(
    async (removed: ProviderKey[]) => {
      const fresh = await fetchOwned();
      if (fresh) applyOwned(fresh);
      else if (removed.length) setOwned((list) => list.filter((o) => !removed.includes(o.provider)));
    },
    [applyOwned],
  );

  // The callback's ?connected= and ?error=&provider= have been read; take them
  // out of the address bar so a reload doesn't show the error again. Other
  // params (the workspace ?pick=) are left alone.
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (!q.has("connected") && !q.has("error")) return;
    if (q.has("error")) q.delete("provider");
    q.delete("connected");
    q.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
  const accountFor = (providerMatch: string | undefined, verified: boolean) =>
    providerMatch
      ? user?.externalAccounts.find(
          (a) =>
            (a.provider ?? "").toLowerCase().includes(providerMatch) &&
            (verified
              ? a.verification?.status === "verified"
              : a.verification?.status !== "verified"),
        )
      : undefined;

  /** Is this tracker connected? Covers both kinds. */
  const isConnected = (t: TrackerDef): boolean =>
    t.auth === "owned"
      ? owned.some((o) => o.provider === t.key)
      : !!accountFor(t.providerMatch, true);

  /**
   * Can this tracker be connected here at all? Clerk tells us about its own at
   * click time; an owned one needs an OAuth app on this deployment, which only
   * the server knows.
   */
  const isAvailable = (t: TrackerDef): boolean =>
    !(t.auth === "owned" && configured[t.key] === false);

  const connectedAccount = (providerMatch: string | undefined) => accountFor(providerMatch, true);
  const pendingAccount = (providerMatch: string | undefined) => accountFor(providerMatch, false);

  // The REASON the last OAuth attempt didn't verify - rewritten to something
  // actionable where we recognize the Clerk error, otherwise Clerk's own text.
  // Empty when there's no pending record or Clerk attached no error to it.
  const pendingError = (providerMatch: string | undefined): string => {
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
   * Brief files into ONE tracker, so a Clerk connect drops every other one
   * once Clerk has handed back the OAuth URL: Clerk can't tell our server when
   * its OAuth lands, so nothing would clear them afterwards, and an owned row
   * left behind would keep winning the filing.
   *
   * The owned rows are read fresh first, so one connected in another tab is
   * not missed; if that read fails nothing is removed. Clerk accounts go next,
   * because the user can still back out of their reverification with the
   * owned rows intact; owned rows go last.
   *
   * An owned connect never comes here - its callback clears the rest, and only
   * once the new tracker is stored.
   * Returns the card's error when something couldn't be removed, else null.
   */
  async function disconnectOtherTrackers(keep: ProviderKey): Promise<string | null> {
    if (!user) return null;
    const fresh = await fetchOwned();
    if (!fresh) {
      // Name what the page last knew of: the owned rows first, as those are
      // what couldn't be read, else whichever tracker is connected.
      const known = owned.filter((o) => o.provider !== keep).map((o) => PROVIDER_LABELS[o.provider]);
      const current =
        known.join(", ") || TRACKER_DEFS.find((d) => d.key !== keep && isConnected(d))?.name;
      return current ? `Couldn't disconnect ${current}.` : COULDNT_CONNECT;
    }
    applyOwned(fresh);

    const otherMatches = TRACKER_DEFS.filter((d) => d.key !== keep && d.providerMatch).map(
      (d) => d.providerMatch!,
    );
    const others = user.externalAccounts.filter((a) =>
      otherMatches.some((m) => (a.provider ?? "").toLowerCase().includes(m)),
    );
    try {
      for (const acc of others) await destroyAccount(acc);
      if (others.length) await user.reload();
    } catch {
      // Reverification cancelled, or removal failed.
      return "Couldn't switch trackers - disconnect the current one first.";
    }

    const rows = fresh.owned.filter((o) => o.provider !== keep);
    const failed: ProviderKey[] = [];
    for (const o of rows) {
      if (!(await postDisconnect(o.provider))) failed.push(o.provider);
    }
    if (rows.length) {
      await refreshOwnedOrDrop(rows.map((o) => o.provider).filter((k) => !failed.includes(k)));
    }
    if (!failed.length) return null;
    return `Couldn't disconnect ${failed.map((k) => PROVIDER_LABELS[k] ?? k).join(", ")}.`;
  }

  async function connect(t: TrackerDef) {
    if (!user) return;
    setTrackerError(t.key, "");
    setNotice("");
    setTrackerBusy(t.key, true);

    // Owned: hand off to our own OAuth start route. Nothing is disconnected
    // here, so backing out at the provider keeps the current tracker.
    if (t.auth === "owned") {
      window.location.assign(
        `/api/connect/${t.key}/start?returnTo=${encodeURIComponent(redirectPath)}`,
      );
      return; // navigating away - keep the button in its busy state.
    }

    try {
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
      if (!redirectUrl) {
        // Clerk accepted the call but gave us nowhere to send the browser. The
        // verification object usually says why. Nothing was removed yet.
        const why =
          externalAccount.verification?.error?.longMessage ||
          externalAccount.verification?.error?.message ||
          "";
        console.error(`[connect:${t.key}] no redirect url`, externalAccount.verification);
        setTrackerError(t.key, why || COULDNT_CONNECT);
        setTrackerBusy(t.key, false);
        return;
      }

      // One tracker at a time. Only now, with the OAuth URL in hand, do the
      // others come off: a connect Clerk refuses never costs the current one.
      // If one can't be removed (or the user cancels the reverification),
      // stop - don't connect both. The unverified record just created is
      // harmless, and the next attempt clears it.
      const blocked = await disconnectOtherTrackers(t.key);
      if (blocked) {
        setTrackerError(t.key, blocked);
        setTrackerBusy(t.key, false);
        return;
      }

      // externalVerificationRedirectURL is a URL object; send the browser to it.
      // Navigating away, so the button keeps its busy state.
      window.location.href = redirectUrl.toString();
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
          : clerkErrorMessage(err) || COULDNT_CONNECT,
      );
      setTrackerBusy(t.key, false);
    }
  }

  /** Disconnect either kind. Returns false when it couldn't be removed here. */
  async function disconnect(t: TrackerDef): Promise<boolean> {
    setTrackerError(t.key, "");
    setNotice("");
    setTrackerBusy(t.key, true);
    try {
      if (t.auth === "owned") {
        const ok = await postDisconnect(t.key);
        await refreshOwnedOrDrop(ok ? [t.key] : []);
        if (!ok) setTrackerError(t.key, `Couldn't disconnect ${t.name}.`);
        return ok;
      }
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
    // Owned connections count toward "loaded": the card must not paint "Choose
    // a tracker" and then jump to the Asana it was connected to all along.
    isLoaded: isLoaded && (ownedLoaded || !user),
    user,
    busy,
    errors,
    notice,
    owned,
    configured,
    setTrackerBusy,
    setTrackerError,
    isConnected,
    isAvailable,
    connectedAccount,
    pendingAccount,
    pendingError,
    connect,
    disconnect,
    refreshOwned,
    PROVIDER_LABELS,
  };
}
