import { after } from "next/server";
import type { currentUser } from "@clerk/nextjs/server";
import { getSignedInUser } from "@/lib/clerk-user";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardBrief, TicketInfo } from "@/lib/brief-types";
import { providerOf, ticketSnapshotPatch } from "@/lib/ticket-sync";
import type { ProviderKey } from "@/lib/tracker";
import { connectedProviders, resolveConnectedTrackers } from "@/lib/trackers/registry";

/**
 * Server-side helpers shared by the Dashboard (/dashboard) and Briefs (/briefs)
 * routes. Extracted from the original single-page dashboard so both views load
 * briefs, recover orphans, and live-sync tracker state through one code path.
 */

/** Minimal brief row shape selected from Supabase. */
export type BriefRow = {
  id: string;
  status: string;
  title: string | null;
  source_kind: string | null;
  created_at: string | null;
  updated_at: string | null;
  ticket_url: string | null;
  ticket_identifier: string | null;
  /** Last-known snapshot of the filed ticket (see 0004_ticket_snapshot.sql). */
  ticket_title: string | null;
  ticket_state_name: string | null;
  ticket_state_color: string | null;
  share_id: string | null;
  error: string | null;
  archived_at: string | null;
  /** Per-user sequential number ("brief-N"), assigned at creation (0007). */
  seq: number | null;
  /** Which tracker this was filed to, recorded at filing time (0009). Null on
   *  rows filed before that column existed - providerOf falls back to the url. */
  ticket_provider?: string | null;
};

export const BRIEF_COLUMNS =
  "id, status, title, source_kind, created_at, updated_at, ticket_url, ticket_identifier, ticket_title, ticket_state_name, ticket_state_color, share_id, error, archived_at, seq, ticket_provider";

/**
 * How long a brief may keep trying before we give up on it. A brief flips to
 * "processing" when filing starts and back to filed when it finishes; if the
 * worker is interrupted (dev restart, serverless timeout, hang) it would
 * otherwise spin forever. We give it up to 10 minutes to land, then quietly
 * mark it failed. Failed briefs are hidden from the UI (no nagging "didn't
 * file" - see the feed/dashboard), so this is just the retry ceiling.
 */
export const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000;

// Re-exported for existing imports; lives in ticket-sync.ts (pure, unit-tested).
export { providerOf };

/** Snapshot state written for a filed ticket its tracker no longer has. */
export const DELETED_STATE = "Deleted";
// Lighter than Draft's muted grey so the two never read alike in a filter list.
const DELETED_COLOR = "#c9c3b5";

/**
 * Known-deleted tickets are re-checked live at most once an hour per server
 * instance. Linear's trash can restore a ticket, so they aren't dropped for
 * good - but asking on every 30s poll would cost an extra round-trip per
 * deleted ticket for as long as its row sits in the feed.
 */
const DELETED_RECHECK_MS = 60 * 60 * 1000;
const deletedRecheckedAt = new Map<string, number>();
function dueForDeletedRecheck(identifier: string, now = Date.now()): boolean {
  const last = deletedRecheckedAt.get(identifier) ?? 0;
  if (now - last < DELETED_RECHECK_MS) return false;
  deletedRecheckedAt.set(identifier, now);
  return true;
}

/**
 * Flip any of the user's briefs that have been stuck in uploaded/processing
 * past ORPHAN_TIMEOUT_MS to "failed" (rendered with a Retry affordance).
 * Best-effort: never throws out of a page render.
 */
export async function recoverOrphans(
  admin: SupabaseClient,
  userId: string,
  timeoutMs: number = ORPHAN_TIMEOUT_MS,
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();
    // Only 'processing' is a live filing run that can orphan. 'uploaded' means
    // a draft the user hasn't filed yet (e.g. a recording uploaded on stop) -
    // leave those alone; they're managed from the extension, not auto-failed.
    await admin
      .from("briefs")
      .update({
        status: "failed",
        error: "Processing timed out - retry.",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("status", "processing")
      .lt("updated_at", cutoff);
  } catch {
    // Recovery is opportunistic - swallow failures so the feed still renders.
  }
}

export type TrackerContext = {
  user: Awaited<ReturnType<typeof currentUser>>;
  /** Every tracker this account has connected. Brief files into one, but the
   *  UI still has to show which that is. */
  connected: ProviderKey[];
  trackerConnected: boolean;
  ticketGuidance: string;
  greetingName: string;
  /** Reporter role captured during onboarding ("" until answered). */
  role: string;
  /** How the user heard about Brief (onboarding attribution; "" until answered). */
  source: string;
  /** True once the first-run onboarding wizard was finished or skipped. */
  onboarded: boolean;
};

/**
 * Resolve the current Clerk user and which trackers are live-connected.
 * currentUser() calls Clerk's backend API; a transient error must NOT crash the
 * render, so we degrade to a null user and recover on the next load.
 */
export async function getTrackerContext(): Promise<TrackerContext> {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await getSignedInUser();
  } catch {
    /* render degraded rather than throwing out of the server render */
  }

  // Every tracker is a Clerk connected account, so this is already on the user
  // object - no extra round trip.
  const connected: ProviderKey[] = connectedProviders(user);

  const ticketGuidance = (user?.privateMetadata?.ticketGuidance as string) ?? "";
  const role = ((user?.privateMetadata?.role as string) ?? "").trim();
  const source = ((user?.privateMetadata?.source as string) ?? "").trim();
  const onboarded = !!user?.privateMetadata?.onboardedAt;
  const greetingName =
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  return {
    user,
    connected,
    trackerConnected: connected.length > 0,
    ticketGuidance,
    greetingName,
    role,
    source,
    onboarded,
  };
}

/**
 * Live status sync per provider, then merge into provider-agnostic
 * DashboardBrief objects. Best-effort and fully contained: if a tracker isn't
 * connected, there are no filed identifiers, or the token/fetch fails, the
 * brief renders without live info - never breaks the page.
 *
 * Briefs the live sync can't cover (outside `syncLimit`, tracker down, token
 * expired) fall back to the PERSISTED snapshot (ticket_title/state columns),
 * so a filed ticket keeps showing its real title and last-known status across
 * reloads instead of degrading to the brief name + "Filed". Whenever the live
 * fetch succeeds, changed snapshots are written back (fire-and-forget).
 *
 * `syncLimit` caps how many filed identifiers we fetch live state for (the
 * Dashboard may pass hundreds of historical briefs but only needs live state
 * for the recent ones).
 */
export async function attachTicketInfo(
  userId: string,
  list: BriefRow[],
  connected: ProviderKey[],
  syncLimit = 60,
  admin?: SupabaseClient,
): Promise<DashboardBrief[]> {
  const filed = list
    .filter((b) => b.status === "filed" && b.ticket_identifier)
    .slice(0, syncLimit);

  // Group the filed tickets by the tracker they live in, so each provider is
  // asked once for all of its identifiers. A ticket already known to be deleted
  // keeps its snapshot and is only re-checked now and then; its row still
  // renders as deleted below.
  const byProvider = new Map<ProviderKey, string[]>();
  for (const b of filed) {
    const provider = providerOf(b.ticket_url, b.ticket_provider);
    if (!connected.includes(provider)) continue;
    if (
      b.ticket_state_name === DELETED_STATE &&
      !dueForDeletedRecheck(b.ticket_identifier as string)
    ) {
      continue;
    }
    const ids = byProvider.get(provider) ?? [];
    ids.push(b.ticket_identifier as string);
    byProvider.set(provider, ids);
  }

  // One live read per provider, all of them in parallel. A tracker that throws
  // contributes nothing and never takes the render down with it.
  const live = new Map<ProviderKey, { issues: Record<string, TicketInfo>; gone: Set<string> }>();
  const trackers = await resolveConnectedTrackers(userId, [...byProvider.keys()]);
  await Promise.all(
    [...byProvider.entries()].map(async ([provider, ids]) => {
      const tracker = trackers.get(provider);
      if (!tracker) return;
      try {
        const { issues, gone } = await tracker.getLiveIssues(ids);
        live.set(provider, { issues, gone: new Set(gone) });
      } catch (err) {
        console.warn(
          `[tickets] ${provider} live sync skipped:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  // Tickets the tracker no longer has. Their rows read "Deleted" (and the
  // snapshot remembers it) instead of a filing-time status frozen forever.
  // Logged once, when first noticed.
  for (const [provider, { gone }] of live) {
    const newlyGone = [...gone].filter(
      (id) => list.find((b) => b.ticket_identifier === id)?.ticket_state_name !== DELETED_STATE,
    );
    if (newlyGone.length) {
      console.warn(
        `[tickets] ${newlyGone.length} filed ticket(s) no longer exist in ${provider}: ${newlyGone.join(", ")}`,
      );
    }
  }

  // Write back snapshots that the live sync moved (title edited, status
  // changed). Best-effort and non-blocking for the render path: failures are
  // swallowed; the next successful load retries naturally.
  const writeBacks: Array<PromiseLike<unknown>> = [];

  const out = list.map((b) => {
    const provider = providerOf(b.ticket_url, b.ticket_provider);
    const key = b.ticket_identifier ?? undefined;
    let ticket: TicketInfo | null = null;
    if (key) {
      const found = live.get(provider);
      if (found?.issues[key]) {
        ticket = found.issues[key];
      } else if (found?.gone.has(key)) {
        ticket = {
          title: b.ticket_title ?? "",
          url: b.ticket_url ?? "",
          stateName: DELETED_STATE,
          stateColor: DELETED_COLOR,
          createdAt: b.created_at ?? "",
          deleted: true,
        };
      }
      if (ticket && admin) {
        const patch = ticketSnapshotPatch(b, ticket);
        if (patch) {
          writeBacks.push(
            admin.from("briefs").update(patch).eq("id", b.id).then(
              () => {},
              () => {},
            ),
          );
        }
      }
      // Live sync miss - synthesize from the persisted snapshot so the real
      // title and last-known status still render. Empty strings fall through
      // the components' display fallbacks ("Filed", brief name).
      if (!ticket && b.status === "filed" && (b.ticket_title || b.ticket_state_name)) {
        ticket = {
          title: b.ticket_title ?? "",
          url: b.ticket_url ?? "",
          stateName: b.ticket_state_name ?? "",
          stateColor: b.ticket_state_color ?? "#8a8378",
          createdAt: b.created_at ?? "",
          ...(b.ticket_state_name === DELETED_STATE ? { deleted: true } : {}),
        };
      }
    }
    return {
      id: b.id,
      status: b.status,
      title: b.title ?? null,
      archived: !!b.archived_at,
      source_kind: b.source_kind ?? null,
      created_at: b.created_at ?? null,
      updated_at: b.updated_at ?? null,
      // Where the ticket lives NOW - a moved ticket shows its new id at once,
      // not after the snapshot write-back lands.
      ticket_url: ticket?.url || b.ticket_url || null,
      ticket_identifier: ticket?.identifier || b.ticket_identifier || null,
      ticket_title: b.ticket_title ?? null,
      share_id: b.share_id ?? null,
      error: b.error ?? null,
      seq: b.seq ?? null,
      provider,
      ticket,
    };
  });

  if (writeBacks.length) await Promise.allSettled(writeBacks);
  return out;
}

/**
 * attachTicketInfo with a time budget. The live read from Linear/Jira is the
 * slowest thing on a page, and the snapshot it falls back to is usually what
 * it would say anyway - so wait `budgetMs` at most, then render the snapshot
 * and let the live read finish after the response (it writes the fresh status
 * back, so the next load has it).
 */
export async function attachTicketInfoFast(
  userId: string,
  list: BriefRow[],
  connected: ProviderKey[],
  admin: SupabaseClient,
  budgetMs = 700,
): Promise<DashboardBrief[]> {
  if (!list.some((b) => b.status === "filed" && b.ticket_identifier)) {
    return attachTicketInfo(userId, list, [], 0, admin);
  }
  const live = attachTicketInfo(userId, list, connected, 60, admin);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    live,
    new Promise<null>((r) => {
      timer = setTimeout(() => r(null), budgetMs);
    }),
  ]);
  clearTimeout(timer);
  if (first) return first;
  after(() => live.then(() => {}, () => {}));
  return attachTicketInfo(userId, list, [], 0, admin);
}

