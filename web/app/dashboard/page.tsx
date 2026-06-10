import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, getIssuesByIdentifiers } from "@/lib/linear";
import AppShell from "@/components/AppShell";
import GettingStarted from "@/components/GettingStarted";
import DashboardTabs from "@/components/DashboardTabs";
import type { DashboardBrief } from "@/components/BriefCard";

export default async function Dashboard() {
  const userId = await requireUserId();
  const user = await currentUser();
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

  // Live Linear status sync. Best-effort and fully contained: if Linear isn't
  // connected, there are no filed identifiers, or the token/fetch fails, we
  // simply render without live info — never break the dashboard.
  let linearMap: Awaited<ReturnType<typeof getIssuesByIdentifiers>> = {};
  const filedIdentifiers = list
    .filter((b) => b.status === "filed" && b.ticket_identifier)
    .map((b) => b.ticket_identifier as string);
  if (hasLinear && filedIdentifiers.length > 0) {
    try {
      const tok = await getLinearToken(userId);
      if (tok) linearMap = await getIssuesByIdentifiers(tok, filedIdentifiers);
    } catch {
      linearMap = {};
    }
  }

  // Serializable briefs with their Linear info merged in where available.
  const dashboardBriefs: DashboardBrief[] = list.map((b) => ({
    id: b.id,
    status: b.status,
    source_kind: b.source_kind ?? null,
    created_at: b.created_at ?? null,
    ticket_url: b.ticket_url ?? null,
    ticket_identifier: b.ticket_identifier ?? null,
    error: b.error ?? null,
    linear: b.ticket_identifier ? (linearMap[b.ticket_identifier] ?? null) : null,
  }));

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
