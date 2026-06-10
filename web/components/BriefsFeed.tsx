"use client";

import { useMemo, useState } from "react";
import AutoRefresh from "./AutoRefresh";
import BrandMark from "./BrandMark";
import FilterPopover, { type FilterOption } from "./FilterPopover";
import BriefCard, { type DashboardBrief } from "./BriefCard";

export type Counts = { filed: number; processing: number; failed: number };

// Synthetic (non-tracker-state) filter keys.
const KEY_PROCESSING = "__processing";
const KEY_FAILED = "__failed";
const KEY_FILED = "__filed"; // filed briefs with no live tracker state

function filterKeyOf(b: DashboardBrief): string {
  if (b.status === "failed") return KEY_FAILED;
  if (b.status === "processing" || b.status === "uploaded") return KEY_PROCESSING;
  if (b.status === "filed") {
    return b.ticket?.stateName ? `state:${b.ticket.stateName}` : KEY_FILED;
  }
  return KEY_PROCESSING;
}

function deriveOptions(briefs: DashboardBrief[]): FilterOption[] {
  const states = new Map<string, FilterOption>();
  let hasBareFiled = false;
  let hasProcessing = false;
  let hasFailed = false;

  for (const b of briefs) {
    if (b.status === "failed") hasFailed = true;
    else if (b.status === "processing" || b.status === "uploaded") hasProcessing = true;
    else if (b.status === "filed") {
      if (b.ticket?.stateName) {
        const key = `state:${b.ticket.stateName}`;
        if (!states.has(key)) {
          states.set(key, {
            key,
            label: b.ticket.stateName,
            color: b.ticket.stateColor || "#8a8378",
          });
        }
      } else {
        hasBareFiled = true;
      }
    }
  }

  const opts: FilterOption[] = [...states.values()];
  if (hasBareFiled) opts.push({ key: KEY_FILED, label: "Filed", color: "#2e7d32" });
  if (hasProcessing)
    opts.push({ key: KEY_PROCESSING, label: "In progress", color: "#dd6936" });
  if (hasFailed) opts.push({ key: KEY_FAILED, label: "Failed", color: "#c62828" });

  return opts;
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="card brief-card animate-rise mt-4 flex flex-col items-center gap-3 px-4 py-14 text-center">
      <BrandMark size={36} />
      <p className="font-display text-xl text-ink">
        {filtered ? "nothing matches." : "no briefs yet."}
      </p>
      <p className="max-w-xs text-sm text-muted">
        {filtered
          ? "no briefs in the selected statuses — adjust the filter to see more."
          : "hit ✦ in the extension, talk through a bug, and it lands here — written up and filed."}
      </p>
    </div>
  );
}

function SummaryLine({ counts }: { counts: Counts }) {
  const parts: { color: string; text: string; pulse?: boolean }[] = [];
  if (counts.filed > 0) parts.push({ color: "#2e7d32", text: `${counts.filed} filed` });
  if (counts.processing > 0)
    parts.push({ color: "#dd6936", text: `${counts.processing} in progress`, pulse: true });
  if (counts.failed > 0) parts.push({ color: "#c62828", text: `${counts.failed} didn't file` });

  if (parts.length === 0)
    return <p className="mt-1.5 font-mono text-xs text-muted">nothing yet</p>;

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${p.pulse ? "dot-pulse" : ""}`}
            style={{ backgroundColor: p.color }}
          />
          {p.text}
          {i < parts.length - 1 && <span className="ml-1.5 text-hairline">·</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * The Briefs feed: editorial heading + summary line, a funnel-icon filter
 * popover, and the rich brief cards. Optimistic archive (instant exit animation,
 * fire-and-forget POST) and AutoRefresh while anything is processing. Failed
 * briefs are hidden by default and surfaced via a quiet "didn't file — show".
 *
 * Extracted from the old DashboardTabs so it can live on its own /briefs route.
 */
export default function BriefsFeed({
  briefs,
  counts,
  isProcessing,
}: {
  briefs: DashboardBrief[];
  counts: Counts;
  isProcessing: boolean;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const onArchive = (id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setArchivedIds((prev) => new Set(prev).add(id));
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 280);
  };

  const liveBriefs = useMemo(
    () => briefs.filter((b) => !archivedIds.has(b.id)),
    [briefs, archivedIds],
  );

  const options = useMemo(() => deriveOptions(liveBriefs), [liveBriefs]);

  const defaultSelected = useMemo(
    () => new Set(options.filter((o) => o.key !== KEY_FAILED).map((o) => o.key)),
    [options],
  );

  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  const reconciled = useMemo(() => {
    const next = new Set<string>();
    const known = new Set(options.map((o) => o.key));
    for (const k of selected) if (known.has(k)) next.add(k);
    return next;
  }, [selected, options]);

  const isDefault = useMemo(() => {
    if (reconciled.size !== defaultSelected.size) return false;
    for (const k of reconciled) if (!defaultSelected.has(k)) return false;
    return true;
  }, [reconciled, defaultSelected]);

  const toggle = (key: string) =>
    setSelected(() => {
      const next = new Set(reconciled);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const reset = () => setSelected(new Set(defaultSelected));

  const enableFailed = () =>
    setSelected(() => new Set(reconciled).add(KEY_FAILED));

  const visible = liveBriefs.filter((b) => reconciled.has(filterKeyOf(b)));
  const filteredOut = liveBriefs.length - visible.length;

  const liveCounts = useMemo<Counts>(() => {
    const next = { ...counts };
    for (const b of briefs) {
      if (!archivedIds.has(b.id)) continue;
      const k = filterKeyOf(b);
      if (k === KEY_FAILED) next.failed = Math.max(0, next.failed - 1);
      else if (k === KEY_PROCESSING) next.processing = Math.max(0, next.processing - 1);
      else next.filed = Math.max(0, next.filed - 1);
    }
    return next;
  }, [counts, briefs, archivedIds]);

  const hiddenFailed = !reconciled.has(KEY_FAILED) ? liveCounts.failed : 0;

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none text-ink">Briefs</h1>
          <SummaryLine counts={liveCounts} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <AutoRefresh active={isProcessing} />
          <FilterPopover
            options={options}
            selected={reconciled}
            onToggle={toggle}
            onReset={reset}
            isDefault={isDefault}
            open={filterOpen}
            onOpenChange={setFilterOpen}
          />
        </div>
      </div>

      {hiddenFailed > 0 && (
        <p className="mt-3 font-mono text-xs text-muted">
          {hiddenFailed} didn&apos;t file —{" "}
          <button
            type="button"
            onClick={enableFailed}
            className="text-muted underline decoration-hairline underline-offset-2 transition-colors hover:text-accent"
          >
            show
          </button>
        </p>
      )}

      {visible.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {visible.map((b, i) => (
            <BriefCard
              key={b.id}
              brief={b}
              index={i}
              onArchive={onArchive}
              leaving={leaving.has(b.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState filtered={liveBriefs.length > 0 && filteredOut > 0} />
      )}
    </section>
  );
}
