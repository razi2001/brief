"use client";

export type Counts = { filed: number; processing: number; failed: number };

type Stat = {
  key: keyof Counts;
  label: string;
  value: number;
  ring: string; // border tint
  text: string; // number tint
  dot: string; // indicator dot color
};

/**
 * Three editorial stat cards (Filed / In progress / Failed) with big
 * Instrument-Serif numbers. Clicking a card is purely visual emphasis — the
 * filter chips own the list filtering. Cards lift on hover and rise on mount.
 */
export default function StatCards({ counts }: { counts: Counts }) {
  const stats: Stat[] = [
    {
      key: "filed",
      label: "Filed",
      value: counts.filed,
      ring: "border-[rgba(46,125,50,.3)]",
      text: "text-[#2e7d32]",
      dot: "bg-[#2e7d32]",
    },
    {
      key: "processing",
      label: "In progress",
      value: counts.processing,
      ring: "border-[rgba(221,105,54,.35)]",
      text: "text-accent",
      dot: "bg-accent",
    },
    {
      key: "failed",
      label: "Failed",
      value: counts.failed,
      ring: "border-[rgba(198,40,40,.3)]",
      text: "text-[#c62828]",
      dot: "bg-[#c62828]",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((s, i) => (
        <div
          key={s.key}
          className={`card lift animate-rise border ${s.ring} px-3 py-4 sm:px-4 sm:py-5`}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${s.dot} ${
                s.key === "processing" && s.value > 0 ? "animate-pulse" : ""
              }`}
            />
            <span className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">
              {s.label}
            </span>
          </div>
          <div
            className={`mt-1.5 font-display text-4xl leading-none tabular-nums sm:text-5xl ${
              s.value > 0 ? s.text : "text-ink-2"
            }`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
