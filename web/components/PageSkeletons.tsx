/**
 * Loading skeletons shaped like the page they stand in for, so a navigation
 * shows the right outline instantly instead of a list that turns into
 * something else.
 */
const bar = "rounded bg-surface-2";

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

/** The Guide: title and progress, then lesson cards (picture, title, blurb) by group. */
export function GuideSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className={`h-7 w-20 ${bar}`} />
          <div className={`mt-2.5 h-4 w-64 ${bar}`} />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40">
            <div className={`h-3 w-20 ${bar}`} />
            <div className="mt-2 h-1.5 rounded-full bg-surface-2" />
          </div>
          <div className="h-8 w-24 rounded-lg bg-surface-2" />
        </div>
      </div>
      {[2, 3].map((n, g) => (
        <div key={g} className="mt-10">
          <div className={`mb-4 h-5 w-32 ${bar}`} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="card overflow-hidden">
                <div className="aspect-[16/10] border-b hairline bg-surface-2/70" />
                <div className="px-4 py-3">
                  <div className={`h-4 w-40 ${bar}`} />
                  <div className={`mt-2.5 h-3 w-full ${bar}`} />
                  <div className={`mt-1.5 h-3 w-2/3 ${bar}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A Guide lesson: breadcrumb and title, the picture beside its steps. */
export function LessonSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className={`h-3.5 w-28 ${bar}`} />
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <div className={`mt-3 h-7 w-72 ${bar}`} />
          <div className={`mt-2.5 h-4 w-[60%] ${bar}`} />
        </div>
        <div className="mt-3 hidden h-8 w-32 rounded-full bg-surface-2 sm:block" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="aspect-[16/10] rounded-[16px] border hairline bg-surface-2/70" />
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 px-3 py-2.5">
              <div className="h-5 w-5 shrink-0 rounded-full bg-surface-2" />
              <div className="flex-1">
                <div className={`h-3.5 w-full ${bar}`} />
                <div className={`mt-2 h-3.5 w-2/3 ${bar}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Settings: the title, then Workspace and Tickets, two rows each (SettingsView). */
export function SettingsSkeleton() {
  const row = (w: string, sum: string, i: number) => (
    <div key={i} className={`flex h-12 items-center gap-2.5 px-4 ${i > 0 ? "border-t hairline" : ""}`}>
      <div className="h-4 w-4 shrink-0 rounded bg-surface-2" />
      <div className={`h-3.5 ${w} ${bar}`} />
      <div className={`ml-auto h-3 ${sum} ${bar}`} />
      <div className="h-3 w-3 shrink-0 rounded bg-surface-2" />
    </div>
  );
  return (
    <div className="w-full max-w-[720px] animate-pulse">
      <div className={`h-7 w-28 ${bar}`} />
      <div className={`mt-7 mb-2 h-3.5 w-20 ${bar}`} />
      <div className="card overflow-hidden">{[row("w-16", "w-36", 0), row("w-12", "w-20", 1)]}</div>
      <div className={`mt-8 mb-2 h-3.5 w-16 ${bar}`} />
      <div className="card overflow-hidden">{[row("w-24", "w-44", 0), row("w-16", "w-28", 1)]}</div>
    </div>
  );
}
