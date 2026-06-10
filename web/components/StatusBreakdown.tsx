export type StatusSegment = { label: string; count: number; color: string };

/**
 * Horizontal stacked bar of live ticket states (Todo / In Progress / Done …),
 * derived from the tracker sync, with a small legend. Pure props. Renders
 * nothing when there are no filed tickets to summarize.
 */
export default function StatusBreakdown({ segments }: { segments: StatusSegment[] }) {
  const total = segments.reduce((n, s) => n + s.count, 0);
  if (total === 0) return null;

  return (
    <div className="card animate-rise px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-ink">Ticket status</h2>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
          {total} filed
        </span>
      </div>

      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-cream-2">
        {segments.map((s, i) => (
          <div
            key={i}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
            <span className="text-muted">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
