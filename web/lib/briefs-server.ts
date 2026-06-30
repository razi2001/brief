import { currentUser } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLinearToken, getIssuesByIdentifiers } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, getJiraIssues } from "@/lib/jira";
import type { DashboardBrief, TicketInfo } from "@/lib/brief-types";
import { providerOf, ticketSnapshotPatch } from "@/lib/ticket-sync";

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
};

export const BRIEF_COLUMNS =
  "id, status, title, source_kind, created_at, updated_at, ticket_url, ticket_identifier, ticket_title, ticket_state_name, ticket_state_color, share_id, error, archived_at";

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
  hasLinear: boolean;
  hasJira: boolean;
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
    user = await currentUser();
  } catch {
    /* render degraded rather than throwing out of the server render */
  }

  // A connection only counts if it isn't a known-unverified (failed/abandoned)
  // OAuth attempt. If the verification status isn't exposed, fall back to presence.
  const isLive = (a: { verification?: { status?: string } | null }) => {
    const s = a.verification?.status;
    return s === undefined || s === "verified";
  };
  const matches = (a: { provider?: string }, p: string) =>
    (a.provider ?? "").toLowerCase().includes(p);
  const hasLinear = !!user?.externalAccounts?.some((a) => matches(a, "linear") && isLive(a));
  const hasJira = !!user?.externalAccounts?.some((a) => matches(a, "atlassian") && isLive(a));

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
    hasLinear,
    hasJira,
    trackerConnected: hasLinear || hasJira,
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
  hasLinear: boolean,
  hasJira: boolean,
  syncLimit = 60,
  admin?: SupabaseClient,
): Promise<DashboardBrief[]> {
  const filed = list
    .filter((b) => b.status === "filed" && b.ticket_identifier)
    .slice(0, syncLimit);
  const linearIdentifiers = filed
    .filter((b) => providerOf(b.ticket_url) === "linear")
    .map((b) => b.ticket_identifier as string);
  const jiraKeys = filed
    .filter((b) => providerOf(b.ticket_url) === "jira")
    .map((b) => b.ticket_identifier as string);

  let linearMap: Awaited<ReturnType<typeof getIssuesByIdentifiers>> = {};
  if (hasLinear && linearIdentifiers.length > 0) {
    try {
      const tok = await getLinearToken(userId);
      if (tok) linearMap = await getIssuesByIdentifiers(tok, linearIdentifiers);
    } catch {
      linearMap = {};
    }
  }

  let jiraMap: Awaited<ReturnType<typeof getJiraIssues>> = {};
  if (hasJira && jiraKeys.length > 0) {
    try {
      const tok = await getJiraAuth(userId);
      const cloud = tok ? await getJiraCloud(tok) : null;
      if (tok && cloud) jiraMap = await getJiraIssues(tok, cloud, jiraKeys);
    } catch {
      jiraMap = {};
    }
  }

  // Write back snapshots that the live sync moved (title edited, status
  // changed). Best-effort and non-blocking for the render path: failures are
  // swallowed; the next successful load retries naturally.
  const writeBacks: Array<PromiseLike<unknown>> = [];

  const out = list.map((b) => {
    const provider = providerOf(b.ticket_url);
    const key = b.ticket_identifier ?? undefined;
    let ticket: TicketInfo | null = null;
    if (key) {
      if (provider === "linear" && linearMap[key]) {
        const li = linearMap[key];
        ticket = {
          title: li.title,
          url: li.url,
          stateName: li.stateName,
          stateColor: li.stateColor,
          createdAt: li.createdAt,
          assignee: li.assignee,
        };
      } else if (provider === "jira" && jiraMap[key]) {
        ticket = jiraMap[key];
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
      ticket_url: b.ticket_url ?? null,
      ticket_identifier: b.ticket_identifier ?? null,
      share_id: b.share_id ?? null,
      error: b.error ?? null,
      provider,
      ticket,
    };
  });

  if (writeBacks.length) await Promise.allSettled(writeBacks);
  return out;
}
