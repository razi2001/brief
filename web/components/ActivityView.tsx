import type { ReactNode } from "react";
import Link from "next/link";
import Avatar from "./Avatar";
import RefreshButton from "./RefreshButton";
import DailyChart from "./DailyChart";
import { BarList, SourcesTable, StatTile } from "./ActivityCharts";
import { ACCENT, NONE } from "./activity-colors";
import { FUNNEL, ago, funnelCounts, funnelOf, type Counted, type NudgeSummary, type PersonFacts, type SiteSummary } from "@/lib/activity";
import { RANGES, type Dashboard, type DayPoint, type Metric } from "@/lib/activity-stats";
import { signupChannel } from "@/lib/channels";

// Person takes the slack; the rest are fixed so every row lines up.
const GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_150px_84px_84px] sm:items-center sm:gap-x-4";

/** The five funnel steps as pills: filled once the person got there. */
export function FunnelPills({ p }: { p: PersonFacts }) {
  const f = funnelOf(p);
  return (
    <span className="inline-flex items-center gap-1" aria-label="Setup reached">
      {FUNNEL.map((s) => (
        <span
          key={s.key}
          title={`${s.label}: ${f[s.key] ? "yes" : "no"}`}
          className={`h-2 w-5 rounded-full ${f[s.key] ? "bg-accent" : "border border-hairline bg-surface-2"}`}
        />
      ))}
    </span>
  );
}

function Stat({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted">{label}</h3>
      <p className="mt-1 text-[26px] font-semibold tabular-nums leading-none text-ink">{n}</p>
    </div>
  );
}

function PersonRow({ p, now }: { p: PersonFacts; now: number }) {
  const via = signupChannel(p.signup);
  return (
    <li>
      <Link href={`/admin/activity/${p.id}`} className={`block px-4 py-2.5 hover:bg-surface-2/60 ${GRID}`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={p.name || p.email || "?"} imageUrl={p.image ?? undefined} size={22} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-ink">{p.name || p.email}</span>
            <span className="block truncate text-xs text-muted">
              {[p.name && p.email, p.role, via && `via ${via}`, p.source && `heard from ${p.source}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </span>
        <span className="mt-1.5 block sm:mt-0">
          <FunnelPills p={p} />
        </span>
        <span className="hidden text-[13px] tabular-nums text-muted sm:block" title="Signed up">
          {ago(p.createdAt, now)}
        </span>
        <span className="hidden text-[13px] tabular-nums text-muted sm:block" title="Last seen">
          {ago(p.lastSeen, now)}
        </span>
      </Link>
    </li>
  );
}

const TILES: [Metric, string, (p: DayPoint) => number][] = [
  ["visits", "Site visits", (p) => p.visits],
  ["signups", "Sign-ups", (p) => p.signups],
  ["active", "Active people", (p) => p.active],
  ["briefs", "Briefs", (p) => p.briefs],
  ["filed", "Tickets filed", (p) => p.filed],
];

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-9 text-[15px] font-semibold text-ink">{children}</h2>;
}

export default function ActivityView({
  people,
  site,
  dashboard,
  nudge,
  days,
  now,
}: {
  people: PersonFacts[];
  site: SiteSummary;
  dashboard: Dashboard;
  nudge: NudgeSummary;
  days: number;
  now: number;
}) {
  const counted = people.filter((p) => !p.admin);
  const counts = funnelCounts(counted);
  const funnel: Counted = [["Signed up", counted.length], ...FUNNEL.map((s) => [s.label, counts[s.key]] as [string, number])];
  const pct = (n: number) => `${counted.length ? Math.round((n / counted.length) * 100) : 0}%`;
  return (
    <section>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Activity</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex h-8 items-center rounded-lg border border-hairline bg-surface-2 p-0.5">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`/admin/activity?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={`inline-flex h-full items-center rounded-md px-2.5 text-[13px] font-medium ${
                  d === days ? "bg-surface text-ink shadow-[0_1px_2px_rgba(26,22,18,.08)]" : "text-ink-2/75 hover:text-ink"
                }`}
              >
                {d} days
              </Link>
            ))}
          </div>
          <RefreshButton />
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TILES.map(([key, label, of]) => (
          <StatTile key={key} label={label} total={dashboard.totals[key]} days={days} series={dashboard.daily.map(of)} />
        ))}
      </div>

      <H2>Every day</H2>
      <div className="mt-3">
        <DailyChart daily={dashboard.daily} />
      </div>

      <H2>Where people come from</H2>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="card overflow-hidden p-0">
          <h3 className="px-4 pt-3.5 text-xs font-medium text-muted">get-brief.app visits</h3>
          <SourcesTable rows={dashboard.sources} />
        </div>
        <div className="card p-4">
          <h3 className="mb-3 text-xs font-medium text-muted">Sign-ups said they heard from</h3>
          <BarList rows={dashboard.heard} color={(l) => (l === "No answer" ? NONE : ACCENT)} empty="No sign-ups" />
        </div>
      </div>

      <H2>Reminder popup · last 30 days</H2>
      <div className="card mt-3 grid grid-cols-2 gap-x-6 gap-y-5 p-4 sm:grid-cols-5">
        <Stat label="Shown" n={nudge.shown} />
        <Stat label="Started a brief" n={nudge.briefIt} />
        <Stat label="Closed" n={nudge.closed} />
        <Stat label="No action" n={nudge.noAction} />
        <Stat label="Briefs from it" n={nudge.briefs} />
      </div>

      <H2>get-brief.app</H2>
      <p className="mt-1 text-[13px] tabular-nums text-muted">
        {site.views} views · {site.mobile} on mobile
      </p>
      <div className="card mt-3 grid gap-x-8 gap-y-6 p-4 sm:grid-cols-3">
        <div className="min-w-0">
          <h3 className="mb-3 text-xs font-medium text-muted">Pages</h3>
          <BarList rows={site.pages} />
        </div>
        <div className="min-w-0">
          <h3 className="mb-3 text-xs font-medium text-muted">Clicks</h3>
          <BarList rows={site.clicks} />
        </div>
        <div className="min-w-0">
          <h3 className="mb-3 text-xs font-medium text-muted">Demo, page loads that reached</h3>
          <BarList rows={site.demo} limit={12} />
        </div>
      </div>

      <H2>Setup</H2>
      <div className="card mt-3 p-4">
        <BarList rows={funnel} max={counted.length || 1} suffix={pct} />
      </div>

      <H2>People</H2>
      <div className="card mt-3 overflow-hidden p-0">
        <div className={`hidden border-b border-hairline px-4 py-2 text-xs font-medium text-muted ${GRID}`}>
          <span>Person</span>
          <span>Setup</span>
          <span>Signed up</span>
          <span>Last seen</span>
        </div>
        <ul className="divide-y divide-hairline">
          {people.map((p) => (
            <PersonRow key={p.id} p={p} now={now} />
          ))}
        </ul>
      </div>
    </section>
  );
}
