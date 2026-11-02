// The static pieces of /admin/activity's charts: number tiles, bar lists and
// the source table. The per-day chart has hover, so it lives in DailyChart.

import type { Counted } from "@/lib/activity";
import type { SourceRow, Total } from "@/lib/activity-stats";
import { ACCENT, channelColor } from "./activity-colors";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(23 - (v / max) * 21).toFixed(2)}`);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-2 block h-6 w-full" aria-hidden>
      <polygon points={`0,24 ${pts.join(" ")} 100,24`} fill={ACCENT} fillOpacity={0.1} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A period total, its change against the period before, and its days as a sparkline. */
export function StatTile({ label, total, days, series }: { label: string; total: Total; days: number; series: number[] }) {
  const diff = total.before === null ? null : total.value - total.before;
  return (
    <div className="card min-w-0 p-3.5">
      <p className="truncate text-xs font-medium text-muted">{label}</p>
      <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.01em] text-ink">
        {total.value.toLocaleString("en-US")}
      </p>
      <p className="mt-1.5 truncate text-[12px] text-muted" title={`Previous ${days} days: ${total.before ?? "not logged"}`}>
        {diff === null ? (
          " "
        ) : diff === 0 ? (
          `Same as previous ${days}d`
        ) : (
          <>
            <span className={diff > 0 ? "text-[#0c8a0c]" : "text-[#c03636]"}>
              {diff > 0 ? "▲" : "▼"} {Math.abs(diff)}
            </span>{" "}
            vs previous {days}d
          </>
        )}
      </p>
      <Sparkline values={series} />
    </div>
  );
}

/** Label, bar, number: one row per entry, longest bar = the biggest. */
export function BarList({
  rows,
  color = () => ACCENT,
  max: forcedMax,
  suffix,
  limit = 8,
  empty = "None yet",
}: {
  rows: Counted;
  color?: (label: string) => string;
  max?: number;
  suffix?: (n: number) => string;
  limit?: number;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-[13px] text-muted">{empty}</p>;
  const max = forcedMax ?? Math.max(1, ...rows.map((r) => r[1]));
  return (
    <ul className="space-y-2">
      {rows.slice(0, limit).map(([label, n]) => (
        <li key={label} className="text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-ink-2">{label}</span>
            <span className="shrink-0 tabular-nums text-ink">
              {n}
              {suffix && <span className="ml-1.5 text-muted">{suffix(n)}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, (n / max) * 100)}%`, background: color(label) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const COLS = "grid grid-cols-[minmax(0,1fr)_repeat(4,44px)] items-center gap-x-2 sm:grid-cols-[minmax(0,1fr)_repeat(4,72px)]";

/** Each channel's visits and what they led to. */
export function SourcesTable({ rows }: { rows: SourceRow[] }) {
  if (!rows.length) return <p className="p-4 text-[13px] text-muted">No visits yet</p>;
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <div>
      <div className={`${COLS} border-b border-hairline px-4 py-2 text-[11px] font-medium leading-tight text-muted`}>
        <span>Source</span>
        <span className="text-right">Visits</span>
        <span className="text-right">Sign-up clicks</span>
        <span className="text-right">Chrome clicks</span>
        <span className="text-right">Sign-ups</span>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.channel} className={`${COLS} px-4 py-2 text-[13px] tabular-nums`}>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: channelColor(r.channel) }} />
                <span className="truncate text-ink">{r.channel}</span>
              </span>
              <span className="mt-1 block h-1.5 rounded-full bg-surface-2">
                {r.visits > 0 && (
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(2, (r.visits / max) * 100)}%`, background: channelColor(r.channel) }}
                  />
                )}
              </span>
            </span>
            <span className="text-right text-ink">{r.visits}</span>
            <span className={`text-right ${r.signupClicks ? "text-ink" : "text-muted/60"}`}>{r.signupClicks}</span>
            <span className={`text-right ${r.chromeClicks ? "text-ink" : "text-muted/60"}`}>{r.chromeClicks}</span>
            <span className={`text-right ${r.signups ? "font-medium text-ink" : "text-muted/60"}`}>{r.signups}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
