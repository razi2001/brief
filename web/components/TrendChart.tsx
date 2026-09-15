"use client";

import { useState } from "react";

export type TrendDay = { date: string; count: number };

/**
 * Lightweight hand-rolled bar chart of tickets filed per day. No chart library:
 * just flex-grown bars sized by ratio against the period max, tinted in the
 * brand accent. Keeps the cream/editorial look and a tiny bundle.
 *
 * Reading a single day used to mean hovering and waiting for the browser's
 * native `title` tooltip. Instead, pointing at (or tabbing to) a bar swaps the
 * centre readout from the period total to that day - no floating tooltip to
 * position, nothing covering the chart, and it works from the keyboard.
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
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);

  const fmt = (iso: string) => {
    const dt = new Date(iso + "T00:00:00");
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const day = active === null ? null : days[active];

  return (
    <div className="card animate-rise px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-ink">Activity</h2>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
          {label}
        </span>
      </div>

      <div
        className={`mt-4 flex items-end gap-1 ${tall ? "h-52" : "h-20"}`}
        onMouseLeave={() => setActive(null)}
      >
        {days.map((d, i) => {
          const pct = (d.count / max) * 100;
          const on = active === i;
          return (
            <button
              key={d.date}
              type="button"
              // A bar is a real control so it can be tabbed to and read out,
              // rather than a div that only responds to a mouse.
              aria-label={`${d.count} filed on ${fmt(d.date)}`}
              className="group relative flex flex-1 cursor-default items-end rounded-t-[3px] outline-none"
              style={{ height: "100%" }}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span
                className={`w-full rounded-t-[3px] transition-[height,background-color] duration-200 ${
                  on ? "bg-accent" : "bg-accent/70 group-hover:bg-accent"
                }`}
                style={{ height: `${Math.max(pct, d.count > 0 ? 6 : 2)}%`, minHeight: 2 }}
              />
              {/* A hairline that reaches the full height of the plot, so the
                  hovered column is findable even on a day with no tickets. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 bottom-0 top-0 rounded-t-[3px] transition-colors ${
                  on ? "bg-[rgba(221,105,54,.08)]" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[0.625rem] text-muted">
        <span className={day ? "opacity-0" : "transition-opacity"}>
          {days.length > 0 ? fmt(days[0].date) : ""}
        </span>
        <span className="text-ink-2">
          {day ? (
            <>
              <span className="text-accent">{day.count} filed</span> · {fmt(day.date)}
            </>
          ) : (
            `${total} filed`
          )}
        </span>
        <span className={day ? "opacity-0" : "transition-opacity"}>
          {days.length > 0 ? fmt(days[days.length - 1].date) : ""}
        </span>
      </div>
    </div>
  );
}
