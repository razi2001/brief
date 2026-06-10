import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, getIssuesByIdentifiers } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, getJiraIssues } from "@/lib/jira";
import AppShell from "@/components/AppShell";
import GettingStarted from "@/components/GettingStarted";
import DashboardTabs from "@/components/DashboardTabs";
import type { DashboardBrief, TicketInfo } from "@/components/BriefCard";

/** Infer the tracker a filed brief went to, from its ticket URL. */
function providerOf(url?: string | null): "linear" | "jira" {
  const u = (url ?? "").toLowerCase();
  return u.includes("atlassian") || u.includes("jira") ? "jira" : "linear";
}

export default async function Dashboard() {
  const userId = await requireUserId();
  // currentUser() calls Clerk's backend API; a transient error (rate limit,
  // network blip) must NOT crash the whole dashboard. Degrade to a null user
  // and recover on the next refresh.
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    /* render in a degraded state rather than throwing out of the server render */
  }
  // Account-level ticket guidance (Clerk privateMetadata), edited in the
  // Connections tab and applied by the server agent.
  const ticketGuidance = (user?.privateMetadata?.ticketGuidance as string) ?? "";
  // A connection only counts if it isn't a known-unverified (failed/abandoned)
  // OAuth attempt. If the verification status isn't exposed, fall back to presence.
  const isLive = (a: { verification?: { status?: string } | null }) => {
    const s = a.verification?.status;
    return s === undefined || s === "verified";
  };
  const matches = (a: { provider?: string }, p: string) => (a.provider ?? "").toLowerCase().includes(p);
  const hasLinear = !!user?.externalAccounts?.some((a) => matches(a, "linear") && isLive(a));
  const hasJira = !!user?.externalAccounts?.some((a) => matches(a, "atlassian") && isLive(a));

  const admin = createAdminSupabase();

  // Auto-recover orphaned briefs: a brief flips to 'processing' when filing
  // starts and back to filed/failed when it finishes. If the worker is
  // interrupted (dev restart, serverless timeout, hang) it stays 'processing'
  // forever. Anything stuck in 'processing' with no update for >4 minutes is
  // almost certainly orphaned, so we flip it to 'failed' (which the UI renders
  // with a Retry affordance). Best-effort: never throw out of the dashboard.
  try {
    const cutoff = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    await admin
      .from("briefs")
      .update({
        status: "failed",
        error: "Processing timed out — retry.",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("status", "processing")
      .lt("updated_at", cutoff);
  } catch {
    // Recovery is opportunistic — swallow failures so the feed still renders.
  }

  const { data: briefs } = await admin
    .from("briefs")
    .select("*")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const list = briefs ?? [];

  const isProcessing = list.some(
    (b) => b.status === "uploaded" || b.status === "processing",
  );

  // Live status sync per provider. Best-effort and fully contained: if a tracker
  // isn't connected, there are no filed identifiers, or the token/fetch fails,
  // we simply render without live info — never break the dashboard.
  //
  // Classify each filed brief by provider (from its ticket_url) and fetch live
  // titles + status from Linear (getIssuesByIdentifiers) and Jira
  // (getJiraIssues) independently, then merge both into a provider-agnostic
  // `ticket` field on each brief.
  const filed = list.filter((b) => b.status === "filed" && b.ticket_identifier);
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

  // Serializable briefs with their live ticket info merged in where available.
  const dashboardBriefs: DashboardBrief[] = list.map((b) => {
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
      ticket_url: b.ticket_url ?? null,
      ticket_identifier: b.ticket_identifier ?? null,
      error: b.error ?? null,
      provider,
      ticket,
    };
  });

  const counts = {
    filed: list.filter((b) => b.status === "filed").length,
    processing: list.filter((b) => b.status === "processing" || b.status === "uploaded").length,
    failed: list.filter((b) => b.status === "failed").length,
  };

  const greetingName =
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  // Getting-started state, derived purely from existing data.
  const trackerConnected = hasLinear || hasJira;
  const hasBriefs = list.length > 0;
  const hasFiled = list.some((b) => b.status === "filed");
  // Show the checklist until the user is fully set up: a tracker is connected
  // AND at least one brief has been filed. Otherwise (no tracker, or no briefs)
  // we keep guiding them.
  const showGettingStarted = !trackerConnected || !hasBriefs || !hasFiled;

  return (
    <AppShell headerRight={<UserButton />}>
      <h1 className="font-display text-4xl sm:text-5xl leading-tight text-ink">
        hey {greetingName},
        <br />
        <span className="text-ink-2">here&apos;s the </span>
        <em className="italic text-accent">brief</em>.
      </h1>

      {showGettingStarted && (
        <GettingStarted
          trackerConnected={trackerConnected}
          hasBriefs={hasBriefs}
          hasFiled={hasFiled}
        />
      )}

      {/* Tabbed experience: Briefs feed + Connections */}
      <DashboardTabs
        briefs={dashboardBriefs}
        counts={counts}
        isProcessing={isProcessing}
        ticketGuidance={ticketGuidance}
      />

      {/* Footer */}
      <footer className="mt-16 border-t hairline pt-6 text-center">
        <p className="text-xs text-muted">
          <a
            href="https://get-brief.app"
            target="_blank"
            rel="noreferrer"
            className="text-muted no-underline hover:text-accent hover:underline"
          >
            get-brief.app
          </a>{" "}
          · what&apos;s the brief?
        </p>
      </footer>
    </AppShell>
  );
}
