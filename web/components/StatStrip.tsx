import type { ReactNode } from "react";

export type Stat = {
  label: string;
  value: number | string;
  /** Colored dot next to the value. */
  color?: string;
  /** Pulse the dot (for "in progress"). */
  pulse?: boolean;
  hint?: ReactNode;
};

/**
 * Compact strip of headline numbers for the Dashboard. Each stat is a small
 * card: big serif value, mono label, optional colored status dot. Responsive
 * grid that collapses to two columns on narrow screens.
 */
export default function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s, i) => (
        <div
          key={i}
          className="card animate-rise px-4 py-3.5"
          style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
        >
          <div className="flex items-center gap-1.5">
            {s.color && (
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${s.pulse ? "dot-pulse" : ""}`}
                style={{ backgroundColor: s.color }}
              />
            )}
            <span className="font-display text-3xl leading-none text-ink">
              {s.value}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}
