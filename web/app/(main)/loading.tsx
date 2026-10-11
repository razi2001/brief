/**
 * Instant loading skeleton for the authed routes. Shown the moment you navigate
 * (the shared layout's shell stays put), then replaced when the page's data
 * resolves. Neutral enough to fit Dashboard, Tickets, and Connections: a page
 * header, a quiet summary line and a hairline list.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="h-8 w-36 rounded-md bg-surface-2" />
        <div className="h-8 w-8 rounded-lg bg-surface-2" />
      </div>
      <div className="mt-3 h-3.5 w-52 rounded bg-surface-2" />

      {/* list */}
      <div className="card mt-6 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <div className="h-2.5 w-10 rounded bg-surface-2" />
          <div className="h-2.5 w-14 rounded bg-surface-2" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-[42px] items-center gap-4 border-b border-hairline px-4 last:border-b-0">
            <div className="h-3 w-16 shrink-0 rounded bg-surface-2" />
            <div className="h-3 flex-1 rounded bg-surface-2" style={{ maxWidth: `${70 - i * 6}%` }} />
            <div className="ml-auto h-2 w-2 shrink-0 rounded-full bg-cream-2" />
            <div className="h-3 w-12 shrink-0 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
