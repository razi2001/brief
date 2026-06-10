"use client";

import { useMemo, useRef, useState } from "react";
import AutoRefresh from "./AutoRefresh";
import BrandMark from "./BrandMark";
import FilterPopover, { type FilterOption } from "./FilterPopover";
import BriefListRow from "./BriefListRow";
import type { DashboardBrief } from "@/lib/brief-types";

export type Counts = { filed: number; processing: number; failed: number };

// Synthetic (non-tracker-state) filter keys. Failed/"didn't file" briefs are not
// shown at all (see liveBriefs), so there's no failed key.
const KEY_PROCESSING = "__processing";
const KEY_FILED = "__filed"; // filed briefs with no live tracker state

function filterKeyOf(b: DashboardBrief): string {
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

  for (const b of briefs) {
    if (b.status === "processing" || b.status === "uploaded") hasProcessing = true;
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

  return opts;
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="card brief-card animate-rise mt-4 flex flex-col items-center gap-3 px-4 py-14 text-center">
      <BrandMark size={36} />
      <p className="font-display text-xl text-ink">
        {filtered ? "nothing matches." : "no tickets yet."}
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
 * Extracted from the old DashboardTabs so it can live on its own /tickets route.
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
  // Pending exit-animation timers, so a failed archive can cancel the
  // "commit to archivedIds" step and restore the card cleanly.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const onArchive = (id: string) => {
    setLeaving((prev) => new Set(prev).add(id));
    const t = setTimeout(() => {
      setArchivedIds((prev) => new Set(prev).add(id));
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      exitTimers.current.delete(id);
    }, 340);
    exitTimers.current.set(id, t);
  };

  // The server write failed for good — undo the optimistic removal so the card
  // reappears immediately (honest feedback) instead of vanishing then coming
  // back on a later load.
  const onArchiveFailed = (id: string) => {
    const t = exitTimers.current.get(id);
    if (t) {
      clearTimeout(t);
      exitTimers.current.delete(id);
    }
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setArchivedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Failed / "didn't file" briefs are never shown — they just drop out of the
  // feed (the system retries for up to 10 min, then quietly gives up).
  const liveBriefs = useMemo(
    () => briefs.filter((b) => !archivedIds.has(b.id) && b.status !== "failed"),
    [briefs, archivedIds],
  );

  const options = useMemo(() => deriveOptions(liveBriefs), [liveBriefs]);

  const defaultSelected = useMemo(
    () => new Set(options.map((o) => o.key)),
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

  const visible = liveBriefs.filter((b) => reconciled.has(filterKeyOf(b)));
  const filteredOut = liveBriefs.length - visible.length;

  const liveCounts = useMemo<Counts>(() => {
    const next = { ...counts, failed: 0 };
    for (const b of briefs) {
      if (!archivedIds.has(b.id)) continue;
      const k = filterKeyOf(b);
      if (k === KEY_PROCESSING) next.processing = Math.max(0, next.processing - 1);
      else next.filed = Math.max(0, next.filed - 1);
    }
    return next;
  }, [counts, briefs, archivedIds]);

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none text-ink">Tickets</h1>
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

      {visible.length > 0 ? (
        <ul className="card mt-5 divide-y divide-hairline overflow-hidden">
          {visible.map((b) => (
            <BriefListRow
              key={b.id}
              brief={b}
              onArchive={onArchive}
              onArchiveFailed={onArchiveFailed}
              leaving={leaving.has(b.id)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState filtered={liveBriefs.length > 0 && filteredOut > 0} />
      )}
    </section>
  );
}
