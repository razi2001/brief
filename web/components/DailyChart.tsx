"use client";

import { useState, type KeyboardEvent } from "react";
import type { DayPoint } from "@/lib/activity-stats";
import { ACCENT, ACCENT_LIGHT, LINKEDIN, NONE, OTHER_SITE, channelColor, shortDay } from "./activity-colors";

type Segment = { value: number; color: string };
type Row = {
  label: string;
  height: number;
  /** Left out where adding days up would count a person twice. */
  total?: (d: DayPoint[]) => number;
  /** Bottom first. */
  segments: (p: DayPoint) => Segment[];
  legend?: [string, string][];
};

const sum = (d: DayPoint[], f: (p: DayPoint) => number) => d.reduce((n, p) => n + f(p), 0);

// Small multiples on one day axis: each measure keeps its own scale.
const ROWS: Row[] = [
  {
    label: "Site visits",
    height: 88,
    total: (d) => sum(d, (p) => p.visits),
    segments: (p) => [
      { value: p.groups[0], color: LINKEDIN },
      { value: p.groups[1], color: OTHER_SITE },
      { value: p.groups[2], color: NONE },
    ],
    legend: [
      ["LinkedIn", LINKEDIN],
      ["Other sites", OTHER_SITE],
      ["No referrer", NONE],
    ],
  },
  { label: "Sign-ups", height: 44, total: (d) => sum(d, (p) => p.signups), segments: (p) => [{ value: p.signups, color: ACCENT }] },
  { label: "Active people", height: 44, segments: (p) => [{ value: p.active, color: ACCENT }] },
  {
    label: "Briefs",
    height: 44,
    total: (d) => sum(d, (p) => p.briefs),
    segments: (p) => [
      { value: p.filed, color: ACCENT },
      { value: p.briefs - p.filed, color: ACCENT_LIGHT },
    ],
    legend: [
      ["Filed", ACCENT],
      ["Not filed", ACCENT_LIGHT],
    ],
  },
];

function Legend({ items }: { items: [string, string][] }) {
  return (
    <span className="flex flex-wrap justify-end gap-x-3 gap-y-0.5">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
          {label}
        </span>
      ))}
    </span>
  );
}

/** Which days get a date under the axis: the last one, then every week (or two) back. */
function tickDays(n: number): Set<number> {
  const step = n <= 7 ? 1 : n <= 31 ? 7 : 14;
  const out = new Set<number>();
  for (let i = n - 1; i >= 0; i -= step) out.add(i);
  return out;
}

function Tip({ p }: { p: DayPoint }) {
  return (
    <div className="w-[190px] rounded-lg border border-hairline bg-surface px-3 py-2 text-[12px] leading-[1.5] text-ink-2 shadow-[0_6px_20px_rgba(26,22,18,.12)]">
      <p className="font-medium text-ink">{shortDay(p.day, true)}</p>
      <p className="mt-1 tabular-nums">
        <span className="text-ink">{p.visits}</span> site visits
      </p>
      {p.channels.slice(0, 5).map(([channel, n]) => (
        <p key={channel} className="flex items-center gap-1.5 pl-1 text-[11.5px] text-muted">
          <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: channelColor(channel) }} />
          <span className="truncate">{channel}</span>
          <span className="ml-auto tabular-nums">{n}</span>
        </p>
      ))}
      <p className="mt-1 tabular-nums">
        <span className="text-ink">{p.signups}</span> sign-ups
      </p>
      <p className="tabular-nums">
        <span className="text-ink">{p.active}</span> active people
      </p>
      <p className="tabular-nums">
        <span className="text-ink">{p.briefs}</span> briefs, <span className="text-ink">{p.filed}</span> filed
      </p>
    </div>
  );
}

/** One column per day: visits by source, sign-ups, active people and briefs. Hover a day for its numbers. */
export default function DailyChart({ daily }: { daily: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = daily.length;
  const ticks = tickDays(n);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.min(n - 1, Math.max(0, (h ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <div className="card p-4">
      <div
        className="relative outline-none"
        tabIndex={0}
        role="group"
        aria-label="Per-day chart. Use the arrow keys to read a day."
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? n - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
      >
        {ROWS.map((row) => {
          const max = Math.max(1, ...daily.map((p) => row.segments(p).reduce((s, x) => s + x.value, 0)));
          const total = row.total?.(daily);
          // Room for the 2px gaps between stacked pieces.
          const scale = row.height - 4;
          return (
            <div key={row.label} className="mt-5 first:mt-0">
              <div className="flex items-end justify-between gap-3">
                <p className="shrink-0 whitespace-nowrap text-[12px] font-medium text-ink-2">
                  {row.label}
                  {total !== undefined && <span className="ml-1.5 font-normal tabular-nums text-muted">{total}</span>}
                </p>
                {row.legend && <Legend items={row.legend} />}
              </div>
              <div className="relative mt-1.5 flex border-b border-[#d9d2c6]" style={{ height: row.height }}>
                <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-hairline" />
                <span className="pointer-events-none absolute -top-[7px] right-0 bg-surface pl-1 text-[10px] tabular-nums leading-none text-muted">
                  {max}
                </span>
                {daily.map((p, i) => {
                  const segs = row.segments(p).filter((s) => s.value > 0);
                  return (
                    <div
                      key={p.day}
                      className={`flex h-full min-w-0 flex-1 flex-col-reverse items-center gap-[2px] px-px ${
                        hover === i ? "bg-ink/[.05]" : ""
                      }`}
                    >
                      {segs.map((s, j) => (
                        <span
                          key={j}
                          className={`block w-full max-w-[18px] shrink-0 ${j === segs.length - 1 ? "rounded-t-[3px]" : ""}`}
                          style={{ height: Math.max(2, Math.round((s.value / max) * scale)), background: s.color }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Hit areas: a whole day column, across every row. */}
        <div className="absolute inset-0 flex">
          {daily.map((p, i) => (
            <div key={p.day} className="h-full flex-1" onPointerEnter={() => setHover(i)} />
          ))}
        </div>

        {hover !== null && daily[hover] && (
          <div
            className="pointer-events-none absolute top-6 z-10"
            style={
              hover < n / 2
                ? { left: `calc(${((hover + 1) / n) * 100}% + 8px)` }
                : { right: `calc(${((n - hover) / n) * 100}% + 8px)` }
            }
          >
            <Tip p={daily[hover]} />
          </div>
        )}
      </div>

      <div className="relative mt-1.5 h-4 text-[11px] tabular-nums text-muted">
        {daily.map((p, i) =>
          ticks.has(i) ? (
            <span
              key={p.day}
              className="absolute top-0 whitespace-nowrap"
              style={
                i === n - 1
                  ? { right: 0 }
                  : i === 0
                    ? { left: 0 }
                    : { left: `${((i + 0.5) / n) * 100}%`, transform: "translateX(-50%)" }
              }
            >
              {shortDay(p.day)}
            </span>
          ) : null,
        )}
      </div>

      <details className="mt-3 text-[12px]">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">Visits</th>
                <th className="py-1 text-right font-medium">LinkedIn</th>
                <th className="py-1 text-right font-medium">Sign-ups</th>
                <th className="py-1 text-right font-medium">Active</th>
                <th className="py-1 text-right font-medium">Briefs</th>
                <th className="py-1 text-right font-medium">Filed</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {[...daily].reverse().map((p) => (
                <tr key={p.day} className="border-t border-hairline">
                  <td className="py-1">{shortDay(p.day, true)}</td>
                  <td className="py-1 text-right">{p.visits}</td>
                  <td className="py-1 text-right">{p.groups[0]}</td>
                  <td className="py-1 text-right">{p.signups}</td>
                  <td className="py-1 text-right">{p.active}</td>
                  <td className="py-1 text-right">{p.briefs}</td>
                  <td className="py-1 text-right">{p.filed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
