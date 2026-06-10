"use client";

export type BriefFilter = "all" | "processing" | "filed" | "failed";

const CHIPS: { key: BriefFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "processing", label: "In progress" },
  { key: "filed", label: "Filed" },
  { key: "failed", label: "Failed" },
];

/**
 * Live filter chips for the brief feed. Active chip gets the accent fill; the
 * rest are quiet outlines. Counts (when provided) render as a subtle suffix.
 */
export default function FilterChips({
  active,
  onChange,
  counts,
}: {
  active: BriefFilter;
  onChange: (f: BriefFilter) => void;
  counts?: Partial<Record<BriefFilter, number>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((c) => {
        const isActive = active === c.key;
        const n = counts?.[c.key];
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={isActive}
            className={`pill cursor-pointer transition-all duration-200 ${
              isActive
                ? "border-accent bg-accent text-cream"
                : "border-hairline bg-transparent text-muted hover:border-[rgba(221,105,54,.4)] hover:text-ink"
            }`}
          >
            {c.label}
            {typeof n === "number" && (
              <span className={isActive ? "opacity-80" : "opacity-60"}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
