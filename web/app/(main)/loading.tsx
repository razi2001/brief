/**
 * Instant loading skeleton for the authed routes. Shown the moment you navigate
 * (the shared layout's shell stays put), then replaced when the page's data
 * resolves. Neutral enough to fit Dashboard, Briefs, and Connections.
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* heading placeholder */}
      <div className="h-8 w-40 rounded bg-cream-2" />

      {/* stat-strip / cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-[68px]" />
        ))}
      </div>

      {/* list rows */}
      <div className="mt-6 card overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-hairline px-4 py-3.5 last:border-b-0">
            <div className="h-2 w-2 shrink-0 rounded-full bg-cream-2" />
            <div className="h-3.5 flex-1 rounded bg-cream-2" />
            <div className="h-3 w-12 rounded bg-cream-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
