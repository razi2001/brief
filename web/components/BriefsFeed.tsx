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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const exitSelect = () => {
    setSelecting(false);
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

  // Both actions optimistically swipe the rows out, then fire the writes
  // (keepalive so they land even if the page changes).
  const runBatch = (endpoint: "archive" | "delete") => {
    const ids = [...selected];
    ids.forEach((id) => onArchive(id));
    ids.forEach((id) =>
      fetch(`/api/briefs/${id}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {}),
    );
    exitSelect();
  };
  const archiveSelected = () => runBatch("archive");
  const deleteSelected = () => {
    // Two-step confirm — delete is permanent.
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    runBatch("delete");
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none text-ink">Tickets</h1>
          <SummaryLine counts={liveCounts} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <AutoRefresh active={isProcessing} />
          <button
            type="button"
            onClick={() => (selecting ? exitSelect() : setSelecting(true))}
            className="font-mono text-xs tracking-wide text-muted no-underline transition-colors hover:text-ink"
          >
            {selecting ? "Cancel" : "Select"}
          </button>
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

      {/* Batch toolbar */}
      {selecting && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-hairline bg-cream-2/60 px-4 py-2.5">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-2 font-mono text-xs text-ink-2"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                allVisibleSelected ? "border-accent bg-accent text-cream" : "border-hairline text-transparent"
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12l5 5L20 6" />
              </svg>
            </span>
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={archiveSelected}
              disabled={selected.size === 0}
              className="rounded-md px-2.5 py-1 font-mono text-xs text-ink-2 transition-colors hover:bg-cream hover:text-ink disabled:opacity-40"
            >
              Archive
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="rounded-md px-2.5 py-1 font-mono text-xs text-[#c62828] transition-colors hover:bg-[rgba(198,40,40,.1)] disabled:opacity-40"
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {visible.length > 0 ? (
        <ul className="card mt-5 divide-y divide-hairline overflow-hidden">
          {visible.map((b) => (
            <BriefListRow
              key={b.id}
              brief={b}
              onArchive={onArchive}
              onArchiveFailed={onArchiveFailed}
              leaving={leaving.has(b.id)}
              selecting={selecting}
              selected={selected.has(b.id)}
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
