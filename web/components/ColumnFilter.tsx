"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ChecklistOption = { key: string; label: string; color?: string };

/**
 * A column-header filter: the header LABEL itself is the trigger (with a tiny
 * funnel that turns into an accent dot when the column is filtered). Clicking
 * opens an anchored popover. Two shapes:
 *   - kind="search"    → a text input (Title, ID)
 *   - kind="checklist" → multi-select options, or single-select (`single`) for
 *                        the Updated time-range presets.
 * Self-contained open/close (outside-click + Esc). Filtering itself lives in
 * the parent; this only owns the trigger UI and emits changes.
 */
export default function ColumnFilter({
  label,
  active,
  align = "left",
  kind,
  // search
  value,
  onChange,
  placeholder,
  // checklist
  options,
  selected,
  onToggle,
  single = false,
  onReset,
  footer,
}: {
  label: string;
  /** A filter is applied on this column (shows the accent dot). */
  active: boolean;
  align?: "left" | "right";
  kind: "search" | "checklist";
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  options?: ChecklistOption[];
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  single?: boolean;
  onReset?: () => void;
  /** Extra content rendered below the checklist (e.g. a "Show archived" toggle). */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    if (kind === "search") inputRef.current?.focus();
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, kind]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        title={`Filter by ${label.toLowerCase()}`}
        className={`group/cf flex w-full min-w-0 items-center gap-1 font-mono text-[0.5625rem] uppercase tracking-wider transition-colors ${
          active ? "text-accent" : "text-muted hover:text-ink"
        }`}
      >
        <span className="truncate">{label}</span>
        {active ? (
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        ) : (
          <svg
            aria-hidden
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 opacity-0 transition-opacity group-hover/cf:opacity-60"
          >
            <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />
          </svg>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          className={`card animate-rise absolute z-30 mt-2 ${align === "right" ? "right-0" : "left-0"} ${
            kind === "search" ? "w-[200px]" : "w-[200px]"
          } p-2`}
          style={{ background: "#fbf8f1", backdropFilter: "none", boxShadow: "0 12px 32px rgba(26,22,18,.16)" }}
        >
          {kind === "search" ? (
            <div className="flex items-center gap-1.5 rounded-md border border-hairline bg-cream/60 px-2">
              <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={value ?? ""}
                onChange={(e) => onChange?.(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-transparent py-1.5 font-mono text-[0.75rem] text-ink placeholder:text-muted/70 focus:outline-none"
              />
              {value && (
                <button
                  type="button"
                  onClick={() => onChange?.("")}
                  aria-label="Clear"
                  className="shrink-0 text-muted transition-colors hover:text-ink"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </div>
          ) : (
            <>
              {onReset && (
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[0.625rem] uppercase tracking-[0.12em] text-muted">{label}</span>
                  <button
                    type="button"
                    onClick={onReset}
                    className="text-[0.6875rem] text-muted no-underline transition-colors hover:text-accent hover:underline"
                  >
                    Reset
                  </button>
                </div>
              )}
              <ul className="flex max-h-[260px] flex-col overflow-y-auto">
                {(options ?? []).map((o) => {
                  const checked = selected?.has(o.key) ?? false;
                  return (
                    <li key={o.key}>
                      <button
                        type="button"
                        role={single ? "menuitemradio" : "menuitemcheckbox"}
                        aria-checked={checked}
                        onClick={() => onToggle?.(o.key)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-cream-2/60"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${
                            single ? "rounded-full" : "rounded"
                          } ${checked ? "border-accent bg-accent text-cream" : "border-hairline bg-transparent text-transparent"}`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12l5 5L20 6" />
                          </svg>
                        </span>
                        {o.color && (
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-2">{o.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {footer && <div className="mt-1.5 border-t hairline pt-1.5">{footer}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
