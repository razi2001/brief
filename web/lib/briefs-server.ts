import { currentUser } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getLinearToken, getIssuesByIdentifiers } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, getJiraIssues } from "@/lib/jira";
import type { DashboardBrief, TicketInfo } from "@/lib/brief-types";

/**
 * Server-side helpers shared by the Dashboard (/dashboard) and Briefs (/briefs)
 * routes. Extracted from the original single-page dashboard so both views load
 * briefs, recover orphans, and live-sync tracker state through one code path.
 */

/** Minimal brief row shape selected from Supabase. */
export type BriefRow = {
  id: string;
  status: string;
  source_kind: string | null;
  created_at: string | null;
  updated_at: string | null;
  ticket_url: string | null;
  ticket_identifier: string | null;
  error: string | null;
};

export const BRIEF_COLUMNS =
  "id, status, source_kind, created_at, updated_at, ticket_url, ticket_identifier, error";

/**
 * How long a brief may sit in a non-terminal state before we treat it as
 * orphaned and flip it to "failed" (retryable). A brief flips to "processing"
 * when filing starts and back to filed/failed when it finishes; if the worker
 * is interrupted (dev restart, serverless timeout, hang) it would otherwise
 * spin forever. Fail-fast: 90s — long enough for a normal agent run, short
 * enough that nothing appears stuck.
 */
export const ORPHAN_TIMEOUT_MS = 90_000;

/** Infer the tracker a filed brief went to, from its ticket URL. */
export function providerOf(url?: string | null): "linear" | "jira" {
  const u = (url ?? "").toLowerCase();
  return u.includes("atlassian") || u.includes("jira") ? "jira" : "linear";
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
    await admin
      .from("briefs")
      .update({
        status: "failed",
        error: "Processing timed out — retry.",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .in("status", ["uploaded", "processing"])
      .lt("updated_at", cutoff);
  } catch {
    // Recovery is opportunistic — swallow failures so the feed still renders.
  }
}

export type TrackerContext = {
  user: Awaited<ReturnType<typeof currentUser>>;
  hasLinear: boolean;
  hasJira: boolean;
  trackerConnected: boolean;
  ticketGuidance: string;
  greetingName: string;
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
  };
}

/**
 * Live status sync per provider, then merge into provider-agnostic
 * DashboardBrief objects. Best-effort and fully contained: if a tracker isn't
 * connected, there are no filed identifiers, or the token/fetch fails, the
 * brief renders without live info — never breaks the page.
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

  return list.map((b) => {
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
    }
    return {
      id: b.id,
      status: b.status,
      source_kind: b.source_kind ?? null,
      created_at: b.created_at ?? null,
      updated_at: b.updated_at ?? null,
      ticket_url: b.ticket_url ?? null,
      ticket_identifier: b.ticket_identifier ?? null,
      error: b.error ?? null,
      provider,
      ticket,
    };
  });
}
