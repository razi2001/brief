"use client";

import { useState } from "react";
import AutoRefresh from "./AutoRefresh";
import Integrations from "./Integrations";
import BrandMark from "./BrandMark";
import StatCards, { type Counts } from "./StatCards";
import FilterChips, { type BriefFilter } from "./FilterChips";
import BriefCard, { type DashboardBrief } from "./BriefCard";

type Tab = "briefs" | "connections";

function matchesFilter(b: DashboardBrief, f: BriefFilter): boolean {
  if (f === "all") return true;
  if (f === "filed") return b.status === "filed";
  if (f === "failed") return b.status === "failed";
  // "processing" bucket also includes freshly uploaded briefs.
  return b.status === "processing" || b.status === "uploaded";
}

function EmptyState({ filter }: { filter: BriefFilter }) {
  const copy: Record<BriefFilter, string> = {
    all: "hit ✦ in the extension, talk through a bug, and it lands here — written up and filed.",
    processing: "nothing in flight right now. record a bug and watch it write itself.",
    filed: "no filed tickets yet. once Brief files one, it shows up here with its live status.",
    failed: "no failures — clean run. nice.",
  };
  return (
    <div className="card animate-rise mt-4 flex flex-col items-center gap-3 px-4 py-14 text-center">
      <BrandMark size={36} />
      <p className="font-display text-xl text-ink">
        {filter === "all" ? "no briefs yet." : "nothing here."}
      </p>
      <p className="max-w-xs text-sm text-muted">{copy[filter]}</p>
    </div>
  );
}

/**
 * Tabbed dashboard shell. A segmented control with a sliding accent pill
 * switches between the Briefs feed (stat cards + live filter chips + rich
 * rows) and the Connections tab (the existing <Integrations/> section).
 * AutoRefresh stays mounted in the Briefs tab so processing briefs keep
 * polling regardless of which tab is focused first.
 */
export default function DashboardTabs({
  briefs,
  counts,
  isProcessing,
}: {
  briefs: DashboardBrief[];
  counts: Counts;
  isProcessing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("briefs");
  const [filter, setFilter] = useState<BriefFilter>("all");

  const visible = briefs.filter((b) => matchesFilter(b, filter));

  const chipCounts: Partial<Record<BriefFilter, number>> = {
    all: briefs.length,
    processing: counts.processing,
    filed: counts.filed,
    failed: counts.failed,
  };

  return (
    <section className="mt-10">
      {/* Segmented tab control */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="relative inline-flex rounded-full border border-hairline bg-cream-2/60 p-1"
      >
        {/* Sliding pill */}
        <span
          aria-hidden="true"
          className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-[#fffdf8] shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            transform: tab === "briefs" ? "translateX(0)" : "translateX(100%)",
          }}
        />
        {(
          [
            { key: "briefs", label: "Briefs" },
            { key: "connections", label: "Connections" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`relative z-10 cursor-pointer rounded-full px-5 py-1.5 text-xs uppercase tracking-[0.08em] transition-colors duration-200 ${
              tab === t.key ? "text-ink" : "text-muted hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Briefs tab */}
      {tab === "briefs" ? (
        <div className="mt-6">
          <StatCards counts={counts} />

          <div className="mt-6 flex items-center justify-between gap-3">
            <FilterChips active={filter} onChange={setFilter} counts={chipCounts} />
            <AutoRefresh active={isProcessing} />
          </div>

          {visible.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {visible.map((b, i) => (
                <BriefCard key={b.id} brief={b} index={i} />
              ))}
            </div>
          ) : (
            <EmptyState filter={filter} />
          )}
        </div>
      ) : (
        <div className="mt-6 animate-rise">
          <Integrations />
        </div>
      )}
    </section>
  );
}
