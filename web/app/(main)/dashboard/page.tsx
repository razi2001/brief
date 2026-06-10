import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import GettingStarted from "@/components/GettingStarted";
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
  const processing = list.filter((b) => b.status === "processing" || b.status === "uploaded");
  const failed = list.filter((b) => b.status === "failed");

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
  const recent = filedBriefs.slice(0, 8);

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
    { label: "Didn't file", value: failed.length, color: "#c62828" },
  ];

  const hasBriefs = list.length > 0;
  const showGettingStarted = !ctx.trackerConnected || !hasBriefs || filed.length === 0;

  return (
    <>
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
                  href="/briefs"
                  className="font-mono text-xs tracking-wide text-accent no-underline hover:underline"
                >
                  All briefs →
                </Link>
              </div>
              <TicketList briefs={recent} />
            </section>
          )}
        </>
      ) : null}

      {showGettingStarted && (
        <GettingStarted
          trackerConnected={ctx.trackerConnected}
          hasBriefs={hasBriefs}
          hasFiled={filed.length > 0}
        />
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
