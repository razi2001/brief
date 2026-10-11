"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AutoRefresh from "./AutoRefresh";
import BrandMark from "./BrandMark";
import RefreshButton from "./RefreshButton";
import { type FilterOption } from "./FilterPopover";
import ColumnFilter from "./ColumnFilter";
import BriefListRow from "./BriefListRow";
import type { DashboardBrief } from "@/lib/brief-types";

// "Updated" column presets (single-select) + their max-age windows.
const UPDATED_OPTIONS: FilterOption[] = [
  { key: "all", label: "Any time", color: "#c9c3b5" },
  { key: "1h", label: "Last hour", color: "#dd6936" },
  { key: "24h", label: "Last 24 hours", color: "#dd6936" },
  { key: "7d", label: "Last 7 days", color: "#dd6936" },
];
const RANGE_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

const assigneeKeyOf = (b: DashboardBrief): string => {
  const n = b.ticket?.assignee?.name?.trim();
  return n ? `a:${n}` : "__unassigned";
};
const titleTextOf = (b: DashboardBrief): string => b.ticket?.title || b.title || "";

// Module scope (like relativeTime): reads the clock here, not in render.
function isWithinRange(b: DashboardBrief, range: string): boolean {
  if (range === "all") return true;
  const t = new Date(b.created_at || "").getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= (RANGE_MS[range] ?? Infinity);
}

// ── Resizable columns ──────────────────────────────────────────────────
// Title is the flexible 1fr track (absorbs the slack); the rest are drag-
// resizable. Widths are CSS-var overrides set on the card container, so they
// cascade to the header AND every row from one place. Persisted per-browser.
type ColKey = "id" | "status" | "assignee" | "upd";
const COL_VAR: Record<ColKey, string> = {
  id: "--tk-id",
  status: "--tk-status",
  assignee: "--tk-assignee",
  upd: "--tk-upd",
};
const COL_DEFAULTS: Record<ColKey, number> = { id: 124, status: 112, assignee: 144, upd: 64 };
const COL_MIN: Record<ColKey, number> = { id: 56, status: 56, assignee: 64, upd: 48 };
const COL_MAX: Record<ColKey, number> = { id: 220, status: 200, assignee: 300, upd: 120 };
// Bumped suffix so the rebalanced defaults take effect over any older saved widths.
const COL_STORE_KEY = "tickets:colw:v7";

// A handle is a divider between two columns. Dragging right grows `inc` and/or
// shrinks `dec`; the dragged edge tracks the cursor (drag right → the column on
// the left gets wider). A side left undefined is the flexible Title track, which
// absorbs the change automatically.
type ResizeSpec = { inc?: ColKey; dec?: ColKey };

export type Counts = { filed: number; processing: number; failed: number; drafted: number };

// Synthetic (non-tracker-state) filter keys.
const KEY_PROCESSING = "__processing";
const KEY_FILED = "__filed"; // filed briefs with no live tracker state
const KEY_FAILED = "__failed"; // briefs that couldn't file (shown with a Retry)
const KEY_DRAFT = "__drafted"; // written up but not filed - opens the brief page

function filterKeyOf(b: DashboardBrief): string {
  if (b.status === "failed") return KEY_FAILED;
  if (b.status === "drafted") return KEY_DRAFT;
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
  let hasDraft = false;

  for (const b of briefs) {
    if (b.status === "failed") hasFailed = true;
    else if (b.status === "drafted") hasDraft = true;
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
  if (hasDraft) opts.push({ key: KEY_DRAFT, label: "Draft", color: "#8a8378" });
  if (hasProcessing)
    opts.push({ key: KEY_PROCESSING, label: "In progress", color: "#dd6936" });
  if (hasFailed)
    opts.push({ key: KEY_FAILED, label: "Didn't file", color: "#c62828" });

  return opts;
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="animate-rise mt-7 flex flex-col items-center gap-3 rounded-xl border border-dashed border-[rgba(26,22,18,0.14)] px-4 py-16 text-center">
      <BrandMark size={32} className="opacity-90" />
      <p className="text-[14px] font-medium text-ink">{filtered ? "Nothing matches" : "No tickets yet"}</p>
    </div>
  );
}

function SummaryLine({ counts }: { counts: Counts }) {
  const parts: { color: string; text: string; pulse?: boolean }[] = [];
  if (counts.filed > 0) parts.push({ color: "#2e7d32", text: `${counts.filed} filed` });
  if (counts.drafted > 0) parts.push({ color: "#8a8378", text: `${counts.drafted} draft${counts.drafted > 1 ? "s" : ""}` });
  if (counts.processing > 0)
    parts.push({ color: "#dd6936", text: `${counts.processing} in progress`, pulse: true });
  if (counts.failed > 0)
    parts.push({ color: "#c62828", text: `${counts.failed} didn't file` });

  if (parts.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 tabular-nums">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${p.pulse ? "dot-pulse" : ""}`}
            style={{ backgroundColor: p.color }}
          />
          {p.text}
        </span>
      ))}
    </p>
  );
}

/**
 * The Briefs feed: editorial heading + summary line, a funnel-icon filter
 * popover, and the rich brief cards. Archive is the only removal action (it
 * behaves like a delete - archived briefs are never refetched). Optimistic and
 * reliable (keepalive POSTs); AutoRefresh while anything is processing. Failed
 * briefs are shown with their error and a Retry - and can be filtered out via
 * the "Didn't file" status option.
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
  // Optimistic state for this session. Archive is the ONLY removal action and
  // it behaves like a delete: the row swipes out and is gone (archived briefs
  // aren't fetched). `archivedIds` covers the gap until the next load.
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // Pending exit-animation timers, so a failed archive can cancel the commit
  // step and bring the row back cleanly.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addTo = (set: typeof setArchivedIds) => (id: string) =>
    set((prev) => new Set(prev).add(id));
  const dropFrom = (set: typeof setArchivedIds) => (id: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  // Swipe the row out, then commit (mark archived).
  const swipeOut = (id: string, commit: (id: string) => void) => {
    setLeaving((prev) => new Set(prev).add(id));
    const t = setTimeout(() => {
      commit(id);
      dropFrom(setLeaving)(id);
      exitTimers.current.delete(id);
    }, 340);
    exitTimers.current.set(id, t);
  };

  const onArchive = (id: string) => swipeOut(id, addTo(setArchivedIds));

  // The server write failed for good - undo the optimistic removal so the row
  // reappears immediately (honest feedback) instead of vanishing then coming
  // back on a later load.
  const onArchiveFailed = (id: string) => {
    const t = exitTimers.current.get(id);
    if (t) {
      clearTimeout(t);
      exitTimers.current.delete(id);
    }
    dropFrom(setLeaving)(id);
    dropFrom(setArchivedIds)(id);
  };

  // Hidden from the feed:
  //  - uploaded: a not-yet-filed capture the user is still composing in the
  //    extension (no written-up ticket yet).
  //  - archived (this session): archive = delete, so it drops out immediately
  //    (the server already excludes archived briefs from the fetch).
  // Drafts (written up, not filed) DO show - their row opens the brief page.
  const liveBriefs = useMemo(
    () => briefs.filter((b) => b.status !== "uploaded" && !archivedIds.has(b.id)),
    [briefs, archivedIds],
  );

  const options = useMemo(() => deriveOptions(liveBriefs), [liveBriefs]);

  // Track only the statuses the user EXPLICITLY hid - not the ones they keep.
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
  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Per-column filters (text search + checklists), AND-ed with status ──
  const [titleQuery, setTitleQuery] = useState("");
  const [idQuery, setIdQuery] = useState("");
  const [updatedRange, setUpdatedRange] = useState("all");
  const [assigneeDeselected, setAssigneeDeselected] = useState<Set<string>>(new Set());

  // Assignee options derived from what's present (mirrors the status model:
  // default shows all, a new assignee appears automatically).
  const assigneeOptions = useMemo<FilterOption[]>(() => {
    const m = new Map<string, FilterOption>();
    let hasUnassigned = false;
    for (const b of liveBriefs) {
      const n = b.ticket?.assignee?.name?.trim();
      if (n) {
        const k = `a:${n}`;
        if (!m.has(k)) m.set(k, { key: k, label: n, color: "#8a8378" });
      } else hasUnassigned = true;
    }
    const opts = [...m.values()];
    if (hasUnassigned) opts.push({ key: "__unassigned", label: "Unassigned", color: "#c9c3b5" });
    return opts;
  }, [liveBriefs]);

  const assigneeReconciled = useMemo(
    () => new Set(assigneeOptions.filter((o) => !assigneeDeselected.has(o.key)).map((o) => o.key)),
    [assigneeOptions, assigneeDeselected],
  );
  const toggleAssignee = (key: string) =>
    setAssigneeDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const reset = () => {
    setDeselected(new Set());
    setTitleQuery("");
    setIdQuery("");
    setUpdatedRange("all");
    setAssigneeDeselected(new Set());
  };

  // Drives the accent dot on each column header.
  const statusActive = options.some((o) => deselected.has(o.key));
  const assigneeActive = assigneeOptions.some((o) => assigneeDeselected.has(o.key));
  const titleActive = titleQuery.trim() !== "";
  const idActive = idQuery.trim() !== "";
  const updatedActive = updatedRange !== "all";
  const filtersActive = statusActive || assigneeActive || titleActive || idActive || updatedActive;

  const matchText = (hay: string, q: string) =>
    !q.trim() || hay.toLowerCase().includes(q.trim().toLowerCase());

  const visible = liveBriefs.filter(
    (b) =>
      reconciled.has(filterKeyOf(b)) &&
      assigneeReconciled.has(assigneeKeyOf(b)) &&
      matchText(titleTextOf(b), titleQuery) &&
      matchText(b.ticket_identifier || "", idQuery) &&
      isWithinRange(b, updatedRange),
  );

  // ── Column widths (drag a header divider to resize; double-click to reset) ──
  const [colW, setColW] = useState<Record<ColKey, number>>(COL_DEFAULTS);
  // One-time, post-mount load of persisted widths. Defaults render on the server
  // and first client paint (no hydration mismatch); saved widths apply after.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COL_STORE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration-safe prefs load
      if (raw) setColW((w) => ({ ...w, ...(JSON.parse(raw) as Partial<Record<ColKey, number>>) }));
    } catch {}
  }, []);
  const persist = (w: Record<ColKey, number>) => {
    try {
      localStorage.setItem(COL_STORE_KEY, JSON.stringify(w));
    } catch {}
  };
  const startResize = (spec: ResizeSpec) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const base = { ...colW };
    const { inc, dec } = spec;
    const onMove = (ev: PointerEvent) => {
      let d = Math.round(ev.clientX - startX);
      // Clamp the drag so neither side passes its min/max (Title flex absorbs
      // any side that's undefined, so it has no clamp).
      let maxPos = Infinity;
      let maxNeg = Infinity;
      if (inc) {
        maxPos = Math.min(maxPos, COL_MAX[inc] - base[inc]);
        maxNeg = Math.min(maxNeg, base[inc] - COL_MIN[inc]);
      }
      if (dec) {
        maxPos = Math.min(maxPos, base[dec] - COL_MIN[dec]);
        maxNeg = Math.min(maxNeg, COL_MAX[dec] - base[dec]);
      }
      d = Math.min(maxPos, Math.max(-maxNeg, d));
      setColW((w) => {
        const next = { ...w };
        if (inc) next[inc] = base[inc] + d;
        if (dec) next[dec] = base[dec] - d;
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setColW((w) => {
        persist(w);
        return w;
      });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };
  const resetCols = (...keys: ColKey[]) =>
    setColW((w) => {
      const next = { ...w };
      keys.forEach((k) => (next[k] = COL_DEFAULTS[k]));
      persist(next);
      return next;
    });
  const gridVars = {
    [COL_VAR.id]: `${colW.id}px`,
    [COL_VAR.status]: `${colW.status}px`,
    [COL_VAR.assignee]: `${colW.assignee}px`,
    [COL_VAR.upd]: `${colW.upd}px`,
  } as CSSProperties;

  // A draggable divider pinned to the right edge of a header cell. `spec` says
  // which column(s) it resizes; double-click resets those to their defaults.
  const resizeHandle = (spec: ResizeSpec) => {
    const keys = [spec.inc, spec.dec].filter(Boolean) as ColKey[];
    return (
      <span
        onPointerDown={startResize(spec)}
        onDoubleClick={() => resetCols(...keys)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize column"
        title="Drag to resize, double-click to reset"
        className="group/rz absolute -right-[10px] top-0 z-20 hidden h-full w-[16px] cursor-col-resize touch-none sm:block"
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 rounded bg-hairline transition-colors group-hover/rz:bg-accent" />
      </span>
    );
  };

  const liveCounts = useMemo<Counts>(() => {
    const next = { ...counts };
    const bump = (b: DashboardBrief, delta: number) => {
      const k = filterKeyOf(b);
      if (k === KEY_PROCESSING) next.processing = Math.max(0, next.processing + delta);
      else if (k === KEY_FAILED) next.failed = Math.max(0, next.failed + delta);
      else if (k === KEY_DRAFT) next.drafted = Math.max(0, next.drafted + delta);
      else next.filed = Math.max(0, next.filed + delta);
    };
    for (const b of briefs) {
      // Server counts cover the active set; subtract this session's optimistic
      // archives (removed from view).
      if (archivedIds.has(b.id)) bump(b, -1);
    }
    return next;
  }, [counts, briefs, archivedIds]);

  // ---- Batch selection (archive / delete many) ----
  // No "select mode": a checkbox shows on row hover; selecting any row reveals
  // the toolbar. `selected` drives everything.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anySelected = selected.size > 0;

  const clearSelection = () => setSelected(new Set());
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

  // Archive a set of ids: optimistic swipe-out first, then a reliable write
  // (keepalive so it lands even if the page changes). Per-row archive goes
  // through ArchiveButton; this handles the batch case.
  const archiveSelected = () => {
    const ids = [...selected];
    ids.forEach((id) => onArchive(id));
    ids.forEach((id) =>
      fetch(`/api/briefs/${id}/archive`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {}),
    );
    clearSelection();
  };

  return (
    <section>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Tickets</h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Global escape hatch: clear every column filter at once. Only shown
              when something is actually filtered (incl. when the list is empty,
              so you're never stuck). Filtering itself lives in the column heads. */}
          {filtersActive && (
            <button
              type="button"
              onClick={reset}
              title="Clear all filters"
              className="btn h-8"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
                <path d="M3 3l18 18" />
              </svg>
              Clear filters
            </button>
          )}
          <AutoRefresh active={isProcessing} />
          <RefreshButton />
        </div>
      </header>
      <div className="mt-3">
        <SummaryLine counts={liveCounts} />
      </div>

      {liveBriefs.length > 0 ? (
        <>
          {/* overflow-visible so the column-filter popovers can escape the card;
              the row list clips its own bottom corners instead. gridVars sets the
              resizable column widths once - they cascade to the header and rows. */}
          <div className="card mt-6 overflow-visible p-0" style={gridVars}>
            {/* Column header - a quiet, sticky row whose labels double as the
                per-column filter triggers. Built on the same .ticket-grid as the
                rows, so each label sits exactly above its column. */}
            <div className="ticket-grid sticky top-0 z-20 rounded-t-[11px] border-b border-hairline bg-surface/95 py-1.5 pl-3 pr-2.5 backdrop-blur max-sm:gap-x-2 max-sm:[grid-template-columns:1.5rem_5.25rem_minmax(0,1fr)_0.75rem_1.75rem]">
              <button
                type="button"
                role="checkbox"
                aria-checked={allVisibleSelected ? "true" : anySelected ? "mixed" : "false"}
                onClick={toggleSelectAll}
                title={allVisibleSelected ? "Deselect all" : `Select all (${visible.length})`}
                aria-label={allVisibleSelected ? "Deselect all" : "Select all"}
                className="flex items-center justify-center"
              >
                <span
                  className={`flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border transition-colors ${
                    allVisibleSelected || anySelected
                      ? "border-accent bg-accent text-white"
                      : "border-[rgba(26,22,18,0.22)] bg-surface text-transparent hover:border-muted"
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {allVisibleSelected ? <path d="M5 12l5 5L20 6" /> : anySelected ? <path d="M6 12h12" /> : null}
                  </svg>
                </span>
              </button>
              <div className="relative min-w-0">
                <ColumnFilter
                  label="ID"
                  kind="search"
                  active={idActive}
                  value={idQuery}
                  onChange={setIdQuery}
                  placeholder="RAZ-…"
                />
                {resizeHandle({ inc: "id" })}
              </div>
              <div className="relative min-w-0">
                <ColumnFilter
                  label="Title"
                  kind="search"
                  active={titleActive}
                  value={titleQuery}
                  onChange={setTitleQuery}
                  placeholder="Search title…"
                />
                {/* Drag right to extend the title (shrinks Status). */}
                {resizeHandle({ dec: "status" })}
              </div>
              <div className="relative min-w-0 max-sm:col-span-2 max-sm:-ml-4">
                <ColumnFilter
                  label="Status"
                  kind="checklist"
                  active={statusActive}
                  options={options}
                  selected={reconciled}
                  onToggle={toggle}
                  onReset={() => setDeselected(new Set())}
                />
                {resizeHandle({ inc: "status", dec: "assignee" })}
              </div>
              <div className="relative hidden min-w-0 sm:block">
                <ColumnFilter
                  label="Assignee"
                  kind="checklist"
                  align="right"
                  active={assigneeActive}
                  options={assigneeOptions}
                  selected={assigneeReconciled}
                  onToggle={toggleAssignee}
                  onReset={() => setAssigneeDeselected(new Set())}
                />
                {resizeHandle({ inc: "assignee", dec: "upd" })}
              </div>
              <div className="relative hidden min-w-0 sm:block">
                <ColumnFilter
                  label="Updated"
                  kind="checklist"
                  single
                  align="right"
                  active={updatedActive}
                  options={UPDATED_OPTIONS}
                  selected={new Set([updatedRange])}
                  onToggle={(k) => setUpdatedRange(k)}
                />
              </div>
              <span aria-hidden className="max-sm:hidden" />
            </div>
            {visible.length > 0 ? (
              <ul className="divide-y divide-hairline overflow-hidden rounded-b-[11px]">
                {visible.map((b) => (
                  <BriefListRow
                    key={b.id}
                    brief={b}
                    onArchive={onArchive}
                    onArchiveFailed={onArchiveFailed}
                    leaving={leaving.has(b.id)}
                    selected={selected.has(b.id)}
                    anySelected={anySelected}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </ul>
            ) : (
              // Filtered down to nothing - but the header (and its filters) stay
              // put, plus a Clear button, so you can always get back.
              <div className="animate-rise flex flex-col items-center gap-3 px-4 py-14 text-center">
                <p className="text-[14px] font-medium text-ink">Nothing matches</p>
                {filtersActive && (
                  <button type="button" onClick={reset} className="btn">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
                      <path d="M3 3l18 18" />
                    </svg>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Floating bulk-action bar - slides up from the bottom when any row
              is selected. Sticky (not fixed) so it floats over a long list but
              rests below a short one; the wrapper is click-through, the pill
              isn't. */}
          {anySelected && (
            <div className="pointer-events-none sticky bottom-4 z-20 mt-3 flex justify-center">
              <div className="animate-bar-rise pointer-events-auto flex items-center gap-1 rounded-[10px] border border-[rgba(245,241,232,0.12)] bg-ink px-1.5 py-1 text-cream shadow-[0_10px_34px_rgba(26,22,18,0.3)]">
                <span className="px-2 text-[13px] tabular-nums text-cream/90">{selected.size} selected</span>
                <span className="mx-0.5 h-4 w-px bg-cream/20" />
                <button
                  type="button"
                  onClick={archiveSelected}
                  title="Archive selected"
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-cream/90 transition-colors hover:bg-cream/10 hover:text-cream"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
                  </svg>
                  Archive
                </button>
                <span className="mx-0.5 h-4 w-px bg-cream/20" />
                <button
                  type="button"
                  onClick={clearSelection}
                  title="Clear selection"
                  aria-label="Clear selection"
                  className="inline-flex items-center justify-center rounded-md p-1.5 text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState filtered={false} />
      )}
    </section>
  );
}
