export type TrendDay = { date: string; count: number };

/**
 * Lightweight hand-rolled bar chart of tickets filed per day. No chart library:
 * just flex-grown bars sized by ratio against the period max, tinted in the
 * brand accent. Keeps the cream/editorial look and a tiny bundle. Pure props.
 */
export default function TrendChart({
  days,
  label = "Filed · last 14 days",
  tall = false,
}: {
  days: TrendDay[];
  label?: string;
  /**
   * Taller bars, for when this sits in a column beside the podium. It both
   * fills a column that would otherwise come up short and gives the bars room
   * to actually show a shape - at 80px a quiet fortnight is a row of stubs.
   */
  tall?: boolean;
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);

  const fmt = (iso: string) => {
    const dt = new Date(iso + "T00:00:00");
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="card animate-rise px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-ink">Activity</h2>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
      </div>

      <div className={`mt-4 flex items-end gap-1 ${tall ? "h-52" : "h-20"}`}>
        {days.map((d, i) => {
          const pct = (d.count / max) * 100;
          return (
            <div
              key={i}
              className="group relative flex flex-1 items-end"
              style={{ height: "100%" }}
              title={`${d.count} on ${fmt(d.date)}`}
            >
              <div
                className="w-full rounded-t-[3px] bg-accent/80 transition-[height] duration-300 group-hover:bg-accent"
                style={{ height: `${Math.max(pct, d.count > 0 ? 6 : 2)}%`, minHeight: 2 }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[0.625rem] text-muted">
        <span>{days.length > 0 ? fmt(days[0].date) : ""}</span>
        <span className="text-ink-2">{total} filed</span>
        <span>{days.length > 0 ? fmt(days[days.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}
