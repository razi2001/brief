"use client";

import { useMemo, useState } from "react";
import AutoRefresh from "./AutoRefresh";
import Integrations from "./Integrations";
import BrandMark from "./BrandMark";
import FilterPopover, { type FilterOption } from "./FilterPopover";
import BriefCard, { type DashboardBrief } from "./BriefCard";

type Tab = "briefs" | "connections";

export type Counts = { filed: number; processing: number; failed: number };

// Synthetic (non-Linear) filter keys.
const KEY_PROCESSING = "__processing";
const KEY_FAILED = "__failed";
const KEY_FILED = "__filed"; // filed briefs with no live Linear state

/**
 * Map a brief to the filter key it belongs to. Synced filed briefs use their
 * Linear state name; filed-without-Linear fall back to a generic "Filed";
 * processing/uploaded and failed use the synthetic keys.
 */
function filterKeyOf(b: DashboardBrief): string {
  if (b.status === "failed") return KEY_FAILED;
  if (b.status === "processing" || b.status === "uploaded") return KEY_PROCESSING;
  if (b.status === "filed") {
    return b.ticket?.stateName ? `state:${b.ticket.stateName}` : KEY_FILED;
  }
  return KEY_PROCESSING;
}

/**
 * Derive the ordered, de-duplicated list of filter options present in the data
 * plus the always-available synthetic options. Linear states come first (in
 * first-seen order), then "In progress (uploading)", then "Failed".
 */
function deriveOptions(briefs: DashboardBrief[]): FilterOption[] {
  const states = new Map<string, FilterOption>();
  let hasBareFiled = false;
  let hasProcessing = false;
  let hasFailed = false;

  for (const b of briefs) {
    if (b.status === "failed") hasFailed = true;
    else if (b.status === "processing" || b.status === "uploaded")
      hasProcessing = true;
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
  if (hasBareFiled)
    opts.push({ key: KEY_FILED, label: "Filed", color: "#2e7d32" });
  if (hasProcessing)
    opts.push({
      key: KEY_PROCESSING,
      label: "In progress (uploading)",
      color: "#dd6936",
    });
  if (hasFailed)
    opts.push({ key: KEY_FAILED, label: "Failed", color: "#c62828" });

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

/** Slim colored-dot + count summary line that replaces the boxy stat cards. */
function SummaryLine({ counts }: { counts: Counts }) {
  const parts: { color: string; text: string; pulse?: boolean }[] = [];
  if (counts.filed > 0)
    parts.push({ color: "#2e7d32", text: `${counts.filed} filed` });
  if (counts.processing > 0)
    parts.push({
      color: "#dd6936",
      text: `${counts.processing} in progress`,
      pulse: true,
    });
  if (counts.failed > 0)
    parts.push({ color: "#c62828", text: `${counts.failed} didn't file` });

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
          {i < parts.length - 1 && (
            <span className="ml-1.5 text-hairline">·</span>
          )}
        </span>
      ))}
    </p>
  );
}

/**
 * Tabbed dashboard shell. A robust segmented control (no translateX trickery:
 * equal-width flex-1 buttons, the active one gets a raised white pill) switches
 * between the Briefs feed and the Connections tab (<Integrations/>). The Briefs
 * feed leads with an editorial heading + summary line, a funnel-icon filter
 * popover, and rich brief cards. AutoRefresh stays mounted in the Briefs tab so
 * processing briefs keep polling. Failed briefs are hidden by default and
 * surfaced via a quiet "didn't file — show" line.
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
  const [filterOpen, setFilterOpen] = useState(false);

  const options = useMemo(() => deriveOptions(briefs), [briefs]);

  // Default selection = everything EXCEPT Failed.
  const defaultSelected = useMemo(
    () => new Set(options.filter((o) => o.key !== KEY_FAILED).map((o) => o.key)),
    [options],
  );

  const [selected, setSelected] = useState<Set<string>>(defaultSelected);

  // Keep the selection valid as the option set changes across refreshes: drop
  // keys that disappeared and adopt newly-appeared non-failed keys (so a brief
  // moving to a brand-new Linear state stays visible) without resurrecting
  // user-deselected ones. We reconcile against the option set each render.
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
    setSelected((prev) => {
      // Start from the reconciled current view so toggles are stable.
      const next = new Set(reconciled);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const reset = () => setSelected(new Set(defaultSelected));

  const enableFailed = () =>
    setSelected(() => {
      const next = new Set(reconciled);
      next.add(KEY_FAILED);
      return next;
    });

  const visible = briefs.filter((b) => reconciled.has(filterKeyOf(b)));
  const filteredOut = briefs.length - visible.length;

  // Hidden-failures notice: only when failures exist AND are currently hidden.
  const hiddenFailed = !reconciled.has(KEY_FAILED) ? counts.failed : 0;

  return (
    <section className="mt-10">
      {/* Segmented tab control — equal-width buttons, raised active pill. */}
      <div
        role="tablist"
        aria-label="Dashboard sections"
        className="flex w-full max-w-[280px] gap-1 rounded-full bg-cream-2 p-1 shadow-[inset_0_0_0_1px_rgba(26,22,18,.12)]"
      >
        {(
          [
            { key: "briefs", label: "Briefs" },
            { key: "connections", label: "Connections" },
          ] as const
        ).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex-1 cursor-pointer rounded-full px-4 py-1.5 font-mono text-xs tracking-wide transition-[color,box-shadow,background-color] duration-200 ${
                active
                  ? "bg-[#fffdf8] text-ink shadow-[0_1px_3px_rgba(26,22,18,.12)]"
                  : "bg-transparent text-muted hover:text-ink-2"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Briefs tab */}
      {tab === "briefs" ? (
        <div className="mt-7">
          {/* Editorial heading + summary line */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-none text-ink">
                Activity
              </h2>
              <SummaryLine counts={counts} />
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

          {/* Quiet hidden-failures notice */}
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
                <BriefCard key={b.id} brief={b} index={i} />
              ))}
            </div>
          ) : (
            <EmptyState filtered={briefs.length > 0 && filteredOut > 0} />
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
