import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import AutoRefresh from "@/components/AutoRefresh";
import RefreshButton from "@/components/RefreshButton";
import StatStrip, { type Stat } from "@/components/StatStrip";
import TrendChart, { type TrendDay } from "@/components/TrendChart";
import StatusBreakdown, { type StatusSegment } from "@/components/StatusBreakdown";
import TicketList from "@/components/TicketList";
import Podium from "@/components/Podium";
import {
  recoverOrphans,
  getTrackerContext,
  attachTicketInfo,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";
import { getLeaderboards, getOrg, warmOrgMemberships } from "@/lib/org-server";
import { showPodium } from "@/lib/podium";

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

  // All of the user's (non-archived) briefs - cheap, single user. Used for
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
  // 'uploaded' = unfiled draft (managed in the extension) - not "in progress".
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
  const dashboardBriefs = await attachTicketInfo(userId, list, ctx.connected, 60, admin);
  const filedBriefs = dashboardBriefs.filter((b) => b.status === "filed");
  // Recent tickets includes in-progress ones (filing now) so a just-queued ticket
  // shows up immediately with its name; drafts ('uploaded') and failed are excluded.
  const recent = dashboardBriefs
    .filter((b) => b.status === "filed" || b.status === "processing")
    .slice(0, 4);

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

  // The org leaderboard. Scoped to whichever tracker workspace this user's
  // token resolves to - never to anything the request asked for. Best-effort:
  // no org, or an aggregate that fails, simply means no podium.
  const org = await getOrg(userId, admin);
  // Both ranges up front: switching between them is a client-side swap, not a
  // navigation that would re-run the live tracker sync for every ticket.
  const boards = org
    ? await getLeaderboards(org.key, userId, admin)
    : { month: [], all: [] };

  // Colleagues who have filed but never opened Brief have no cached membership,
  // so they are missing from the leaderboard through no fault of their own.
  // Resolve a few of them after the response is sent - costs this render
  // nothing, and the org fills itself in over a handful of loads.
  if (org) after(() => warmOrgMemberships(admin));

  const hasBriefs = list.length > 0;
  // First-run onboarding lives on its own page. Send not-yet-onboarded users
  // there; users who already have filed tickets predate the wizard - never
  // nag them with it.
  if (!!ctx.user && !ctx.onboarded && filed.length === 0) redirect("/welcome");

  return (
    <>
      {/* Live status: always kept in sync - fast poll while anything is
          filing, slow background poll otherwise, instant refresh on tab
          focus. Manual refresh stays for impatient moments. */}
      <div className="mb-3 flex items-center justify-end gap-2">
        <AutoRefresh active={processing.length > 0} />
        <RefreshButton />
      </div>
      <StatStrip stats={stats} />

      {hasBriefs ? (
        <>
          {/* The podium leads when there is one - it is the thing people come
              back for - and takes half the width beside the trend, which
              leaves the status breakdown full width underneath. With no
              podium the original trend|breakdown pair stands as it was, so
              neither layout ever has a lone half-width card. */}
          {org && (showPodium(boards.month) || showPodium(boards.all)) ? (
            <>
              {/* items-start so each card keeps its natural height - stretching
                  them to match left a large empty area under the shorter one. */}
              <div className="mt-6 grid grid-cols-1 items-start gap-5 md:grid-cols-2">
                <Podium
                  month={boards.month}
                  all={boards.all}
                  orgName={org.name}
                />
                <TrendChart days={days} />
              </div>
              {segments.length > 0 && (
                <div className="mt-5">
                  <StatusBreakdown segments={segments} />
                </div>
              )}
            </>
          ) : (
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
          )}

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

      {/* Onboarding done (or skipped) but nothing captured yet - one quiet
          pointer at the extension instead of a blank page. */}
      {!hasBriefs && (
        <div className="card mt-10 px-5 py-10 text-center">
          <p className="font-display text-xl text-ink">no tickets yet.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
            hit ✦ in the extension, talk through a bug, and it lands here -
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
