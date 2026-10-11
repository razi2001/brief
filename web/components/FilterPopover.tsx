"use client";

import { useEffect, useId, useRef } from "react";

/**
 * A single selectable status in the filter. For Linear-state options we carry
 * the live `color` so the checklist can show a matching dot. The synthetic
 * "processing" and "failed" options use brand colors.
 */
export type FilterOption = {
  /** Stable key used in the selection set. */
  key: string;
  label: string;
  color: string;
};

/**
 * Funnel-icon button + popover checklist of statuses to SHOW. Multi-select,
 * outside-click / Esc to close, a Reset link, and an accent dot on the funnel
 * when the live selection differs from the default. Filtering itself lives in
 * the parent - this component only owns the open/close UI and selection.
 */
export default function FilterPopover({
  options,
  selected,
  onToggle,
  onReset,
  isDefault,
  open,
  onOpenChange,
  showArchived,
  onToggleArchived,
}: {
  options: FilterOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onReset: () => void;
  /** True when `selected` equals the default selection (hides the accent dot). */
  isDefault: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether archived tickets are currently shown. */
  showArchived: boolean;
  onToggleArchived: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Filter briefs"
        onClick={() => onOpenChange(!open)}
        className={`btn relative h-8 w-8 justify-center !p-0 ${
          open ? "bg-surface-2 text-ink" : ""
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
        </svg>
        {!isDefault && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-surface"
          />
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          className="animate-rise absolute right-0 z-20 mt-1.5 w-[220px] rounded-[10px] border border-hairline bg-surface p-1.5"
          style={{ boxShadow: "0 1px 2px rgba(26,22,18,.05), 0 12px 32px -8px rgba(26,22,18,.2)" }}
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-xs text-muted">Show</span>
            <button
              type="button"
              onClick={onReset}
              className="text-xs text-muted no-underline transition-colors hover:text-accent"
            >
              Reset
            </button>
          </div>

          <ul className="flex flex-col">
            {options.map((o) => {
              const checked = selected.has(o.key);
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => onToggle(o.key)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                        checked
                          ? "border-accent bg-accent text-white"
                          : "border-[rgba(26,22,18,0.22)] bg-surface text-transparent"
                      }`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12l5 5L20 6" />
                      </svg>
                    </span>
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: o.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                      {o.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Archived toggle - separate from status; off by default each visit. */}
          <div className="mt-1.5 border-t hairline pt-1.5">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showArchived}
              onClick={onToggleArchived}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  showArchived
                    ? "border-accent bg-accent text-white"
                    : "border-[rgba(26,22,18,0.22)] bg-surface text-transparent"
                }`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12l5 5L20 6" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                Show archived
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
