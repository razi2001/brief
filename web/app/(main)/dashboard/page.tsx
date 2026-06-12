import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import OnboardingClient from "@/components/OnboardingClient";
import StatStrip, { type Stat } from "@/components/StatStrip";
import TrendChart, { type TrendDay } from "@/components/TrendChart";
import StatusBreakdown, { type StatusSegment } from "@/components/StatusBreakdown";
import TicketList from "@/components/TicketList";
import {
  recoverOrphans,
  getTrackerContext,
  attachTicketInfo,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";

/** Local YYYY-MM-DD key for a timestamp (day bucketing for the trend chart). */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The last `n` calendar days (oldest → newest), each zero-initialized. */
function buildDays(n: number): TrendDay[] {
  const out: TrendDay[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push({ date: dayKey(d), count: 0 });
  }
  return out;
}

export default async function Dashboard() {
  const userId = await requireUserId();
  const ctx = await getTrackerContext();

  const admin = createAdminSupabase();
  await recoverOrphans(admin, userId);

  // All of the user's (non-archived) briefs — cheap, single user. Used for
  // counts and the trend; live tracker state is fetched only for the recent
  // filed subset inside attachTicketInfo.
  const { data } = await admin
    .from("briefs")
    .select(BRIEF_COLUMNS)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  const list = (data ?? []) as BriefRow[];

  const filed = list.filter((b) => b.status === "filed");
  // 'uploaded' = unfiled draft (managed in the extension) — not "in progress".
  const processing = list.filter((b) => b.status === "processing");

  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = filed.filter(
    (b) => b.created_at && new Date(b.created_at).getTime() >= weekAgo,
  ).length;

  // Trend: filed per day over the last 14 days.
  const days = buildDays(14);
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const b of filed) {
    if (!b.created_at) continue;
    const idx = dayIndex.get(dayKey(new Date(b.created_at)));
    if (idx !== undefined) days[idx].count++;
  }

  // Live ticket info for the recent filed subset → recent list + status breakdown.
  const dashboardBriefs = await attachTicketInfo(userId, list, ctx.hasLinear, ctx.hasJira, 60);
  const filedBriefs = dashboardBriefs.filter((b) => b.status === "filed");
  // Recent tickets includes in-progress ones (filing now) so a just-queued ticket
  // shows up immediately with its name; drafts ('uploaded') and failed are excluded.
  const recent = dashboardBriefs
    .filter((b) => b.status === "filed" || b.status === "processing")
    .slice(0, 8);

  // Status breakdown: group filed tickets by their live tracker state.
  const segMap = new Map<string, StatusSegment>();
  for (const b of filedBriefs) {
    const label = b.ticket?.stateName ?? "Filed";
    const color = b.ticket?.stateColor || "#2e7d32";
    const seg = segMap.get(label);
    if (seg) seg.count++;
    else segMap.set(label, { label, count: 1, color });
  }
  const segments = [...segMap.values()].sort((a, b) => b.count - a.count);

  const stats: Stat[] = [
    { label: "Tickets filed", value: filed.length, color: "#2e7d32" },
    { label: "This week", value: thisWeek, color: "#dd6936" },
    {
      label: "In progress",
      value: processing.length,
      color: "#dd6936",
      pulse: processing.length > 0,
    },
  ];

  const hasBriefs = list.length > 0;
  // First-run wizard: shown until the user finishes/skips it. Users who already
  // have filed tickets predate the wizard — never nag them with it.
  const showOnboarding = !!ctx.user && !ctx.onboarded && filed.length === 0;

  return (
    <>
      {/* Live status: while anything is filing, poll so the user can watch a
          just-queued ticket move from "in progress" to "filed" without reloading. */}
      {processing.length > 0 && (
        <div className="mb-3 flex justify-end">
          <AutoRefresh active />
        </div>
      )}
      <StatStrip stats={stats} />

      {hasBriefs ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <TrendChart days={days} />
            {segments.length > 0 ? (
              <StatusBreakdown segments={segments} />
            ) : (
              <div className="card flex items-center justify-center px-4 py-4 text-center text-sm text-muted">
                Connect a tracker to see live ticket status.
              </div>
            )}
          </div>

          {recent.length > 0 && (
            <section className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-2xl text-ink">Recent tickets</h2>
                <Link
                  href="/tickets"
                  className="font-mono text-xs tracking-wide text-accent no-underline hover:underline"
                >
                  All tickets →
                </Link>
              </div>
              <TicketList briefs={recent} />
            </section>
          )}
        </>
      ) : null}

      {showOnboarding && (
        <OnboardingClient initialRole={ctx.role} greetingName={ctx.greetingName} />
      )}

      {/* Onboarding done (or skipped) but nothing captured yet — one quiet
          pointer at the extension instead of a blank page. */}
      {!hasBriefs && !showOnboarding && (
        <div className="card mt-10 px-5 py-10 text-center">
          <p className="font-display text-xl text-ink">no tickets yet.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
            hit ✦ in the extension, talk through a bug, and it lands here —
            written up and filed.
          </p>
        </div>
      )}

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
    </>
  );
}
