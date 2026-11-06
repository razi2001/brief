/** The Requests tab's outline while its list loads: title, composer, a few rows. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[720px] animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className="h-8 w-28 rounded-md bg-surface-2" />
        <div className="h-8 w-24 rounded-lg bg-surface-2" />
      </div>
      <div className="card mt-6 h-[58px]" />
      <div className="card mt-4 overflow-hidden p-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
            <div className="h-12 w-11 shrink-0 rounded-lg bg-surface-2" />
            <div className="flex-1 pt-1">
              <div className="h-3.5 rounded bg-surface-2" style={{ width: `${72 - i * 9}%` }} />
              <div className="mt-2 h-3 w-24 rounded bg-surface-2" />
            </div>
            <div className="h-5 w-20 shrink-0 rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
