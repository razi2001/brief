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
          ? "no tickets in the selected statuses — adjust the filter to see more."
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
  // Show archived tickets? Off by default — and because it's local state it
  // resets to off every time the page is (re)loaded.
  const [showArchived, setShowArchived] = useState(false);
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

  // Hidden from the feed:
  //  - failed: the system retries for up to 10 min, then quietly gives up.
  //  - uploaded: a not-yet-filed draft (e.g. a recording uploaded on stop) that
  //    the user files from the extension — it isn't a real ticket yet.
  //  - archived: only shown when the "Show archived" toggle is on.
  const liveBriefs = useMemo(
    () =>
      briefs.filter(
        (b) =>
          !archivedIds.has(b.id) &&
          b.status !== "failed" &&
          b.status !== "uploaded" &&
          (showArchived || !b.archived),
      ),
    [briefs, archivedIds, showArchived],
  );

  const options = useMemo(() => deriveOptions(liveBriefs), [liveBriefs]);

  // Track only the statuses the user EXPLICITLY hid — not the ones they keep.
  // Everything else is shown, so the default is "all" and a brand-new status
  // (e.g. a just-filed ticket's tracker state) appears automatically instead of
  // being filtered out. The user opts a status out by toggling it off.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  // The currently-shown keys = every present option minus the ones hidden.
  const reconciled = useMemo(
    () => new Set(options.filter((o) => !deselected.has(o.key)).map((o) => o.key)),
    [options, deselected],
  );

  // Default view = nothing hidden (all statuses shown) and archived not shown.
  const isDefault = useMemo(
    () => !showArchived && options.every((o) => !deselected.has(o.key)),
    [options, deselected, showArchived],
  );

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const reset = () => {
    setDeselected(new Set());
    setShowArchived(false);
  };

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

  // ---- Batch selection (archive / delete many) ----
  // No "select mode": a checkbox shows on row hover; selecting any row reveals
  // the toolbar. `selected` drives everything.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anySelected = selected.size > 0;

  const clearSelection = () => {
    setSelected(new Set());
    setConfirmDelete(false);
  };
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((b) => selected.has(b.id));
  const toggleSelectAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((b) => b.id)));

  // Fire a write for a set of ids, optimistically swiping the rows out first
  // (keepalive so it lands even if the page changes).
  const runIds = (ids: string[], endpoint: "archive" | "delete") => {
    ids.forEach((id) => onArchive(id));
    ids.forEach((id) =>
      fetch(`/api/briefs/${id}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {}),
    );
  };

  // Per-row single delete (one click, like archive).
  const deleteOne = (id: string) => runIds([id], "delete");

  const archiveSelected = () => {
    runIds([...selected], "archive");
    clearSelection();
  };
  const deleteSelected = () => {
    // Deleting many at once is permanent — one light confirm (the icon turns red).
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    runIds([...selected], "delete");
    clearSelection();
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none text-ink">Tickets</h1>
          <SummaryLine counts={liveCounts} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Batch action icons — appear next to the filter once you select rows. */}
          {anySelected && (
            <div className="animate-rise flex items-center gap-1.5 pr-1">
              <button
                type="button"
                onClick={toggleSelectAll}
                title={allVisibleSelected ? "Deselect all" : "Select all"}
                className="font-mono text-xs text-muted transition-colors hover:text-ink"
              >
                {selected.size}
              </button>
              <button
                type="button"
                onClick={archiveSelected}
                title="Archive selected"
                aria-label="Archive selected"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline text-muted transition-colors hover:bg-cream-2/70 hover:text-ink"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="4" rx="1" />
                  <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                title={confirmDelete ? `Delete ${selected.size} — click again to confirm` : "Delete selected"}
                aria-label="Delete selected"
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                  confirmDelete
                    ? "border-[rgba(198,40,40,.5)] bg-[rgba(198,40,40,.12)] text-[#c62828]"
                    : "border-hairline text-muted hover:bg-[rgba(198,40,40,.1)] hover:text-[#c62828]"
                }`}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
              <button
                type="button"
                onClick={clearSelection}
                title="Clear selection"
                aria-label="Clear selection"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:text-ink"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          )}
          <AutoRefresh active={isProcessing} />
          <FilterPopover
            options={options}
            selected={reconciled}
            onToggle={toggle}
            onReset={reset}
            isDefault={isDefault}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
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
              onDelete={deleteOne}
              leaving={leaving.has(b.id)}
              selected={selected.has(b.id)}
              anySelected={anySelected}
              onToggleSelect={toggleSelect}
            />
          ))}
        </ul>
      ) : (
        <EmptyState filtered={liveBriefs.length > 0 && filteredOut > 0} />
      )}
    </section>
  );
}
