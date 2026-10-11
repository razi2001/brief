/**
 * Loading skeletons shaped like the page they stand in for, so a navigation
 * shows the right outline instantly instead of a list that turns into
 * something else.
 */
const bar = "rounded bg-surface-2";

/** Home: the title, the ROI card with its four numbers, the leaderboard. */
export function HomeSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className={`h-7 w-24 ${bar}`} />
        <div className={`h-8 w-28 rounded-lg bg-surface-2`} />
      </div>
      <div className="card mt-7 overflow-hidden px-7 pb-0 pt-6">
        <div className={`h-3.5 w-36 ${bar}`} />
        <div className="mt-4 grid grid-cols-2 gap-6 pb-6 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className={`h-3 w-20 ${bar}`} />
              <div className={`mt-2 h-10 w-20 ${bar}`} />
              <div className={`mt-2 h-3 w-24 ${bar}`} />
            </div>
          ))}
        </div>
        <div className="-mx-7 h-[112px] bg-[linear-gradient(180deg,transparent_45%,#fff_45%)]" />
      </div>
      <div className="card mt-4 h-[300px]" />
    </div>
  );
}

/** One ticket or draft: the breadcrumb, then the sheet with its title and body. */
export function BriefSkeleton() {
  return (
    <div className="animate-pulse">
      <div className={`h-4 w-64 ${bar}`} />
      <div className="card mt-4 overflow-hidden">
        <div className="mx-auto w-full max-w-[720px] px-5 pb-14 pt-9 sm:px-10 sm:pt-12">
          <div className={`h-3.5 w-40 ${bar}`} />
          <div className={`mt-6 h-8 w-[85%] ${bar}`} />
          <div className={`mt-3 h-8 w-[55%] ${bar}`} />
          <div className="mt-6 flex gap-3">
            <div className="h-9 w-36 rounded-lg bg-surface-2" />
            <div className="h-9 w-20 rounded-lg bg-surface-2" />
          </div>
          <div className="mt-8 flex flex-col gap-3 border-t border-hairline pt-8">
            {["100%", "94%", "70%", "0", "30%", "88%", "62%"].map((w, i) =>
              w === "0" ? <div key={i} className="h-3" /> : <div key={i} className={`h-3.5 ${bar}`} style={{ width: w }} />,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
