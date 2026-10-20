import Link from "next/link";
import Avatar from "./Avatar";
import RefreshButton from "./RefreshButton";
import {
  FUNNEL,
  ago,
  funnelCounts,
  funnelOf,
  sourceLine,
  type Counted,
  type PersonFacts,
  type SiteSummary,
} from "@/lib/activity";

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

function List({ title, rows, empty = "None yet" }: { title: string; rows: Counted; empty?: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-medium text-muted">{title}</h3>
      {rows.length > 0 ? (
        <ul className="mt-1.5 space-y-1 text-[13px]">
          {rows.slice(0, 8).map(([label, n]) => (
            <li key={label} className="flex justify-between gap-3">
              <span className="truncate text-ink-2">{label}</span>
              <span className="tabular-nums text-ink">{n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] text-muted">{empty}</p>
      )}
    </div>
  );
}

function PersonRow({ p, now }: { p: PersonFacts; now: number }) {
  const src = sourceLine(p.signup);
  return (
    <li>
      <Link href={`/admin/activity/${p.id}`} className={`block px-4 py-2.5 hover:bg-surface-2/60 ${GRID}`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={p.name || p.email || "?"} imageUrl={p.image ?? undefined} size={22} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-ink">{p.name || p.email}</span>
            <span className="block truncate text-xs text-muted">
              {[p.name && p.email, p.role, src].filter(Boolean).join(" · ")}
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

export default function ActivityView({
  people,
  site,
  days,
  now,
}: {
  people: PersonFacts[];
  site: SiteSummary;
  days: number;
  now: number;
}) {
  const counts = funnelCounts(people);
  return (
    <section>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Activity</h1>
        <RefreshButton />
      </header>

      <div className="mt-6 flex items-center justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">get-brief.app</h2>
        <div className="inline-flex h-8 items-center rounded-lg border border-hairline bg-surface-2 p-0.5">
          {[7, 30].map((d) => (
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
      </div>
      <div className="card mt-3 grid gap-x-6 gap-y-5 p-4 sm:grid-cols-3">
        <div>
          <h3 className="text-xs font-medium text-muted">Page views</h3>
          <p className="mt-1 text-[26px] font-semibold tabular-nums leading-none text-ink">{site.views}</p>
          <p className="mt-1.5 text-[13px] tabular-nums text-muted">{site.mobile} on mobile</p>
        </div>
        <List title="Pages" rows={site.pages} />
        <List title="Came from" rows={site.referrers} />
        <List title="utm source" rows={site.sources} />
        <List title="Clicks" rows={site.clicks} />
        <List title="Demo, page loads that reached" rows={site.demo} />
      </div>

      <h2 className="mt-8 text-[15px] font-semibold text-ink">People</h2>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums text-muted">
        <span>{people.length} sign-ups</span>
        {FUNNEL.map((s) => (
          <span key={s.key}>
            {counts[s.key]} {s.label.toLowerCase()}
          </span>
        ))}
      </p>
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
