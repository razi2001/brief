"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The "more" button of a row or a page: three dots that open a short menu of
 * the actions that don't deserve a button of their own. Closes on Escape, on a
 * click outside, and when an action asks it to.
 */
export default function MoreMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`btn-ghost h-[30px] w-[30px] ${open ? "bg-[var(--color-pressed)] text-ink" : ""}`}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="menu absolute right-0 top-full z-40 mt-1 w-[216px] p-1"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * A menu action that asks once before it runs: the first click turns the line
 * into its question with Keep and the action.
 */
export function ConfirmItem({
  label,
  question,
  confirm,
  onConfirm,
  disabled = false,
}: {
  label: string;
  question: string;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => setAsking(true)}
        className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-[rgba(198,40,40,0.07)] hover:text-[#c62828]"
      >
        {label}
      </button>
    );
  }
  return (
    <div className="px-2 pb-1 pt-1.5">
      <p className="text-[13px] text-ink">{question}</p>
      <div className="mt-2 flex justify-end gap-1">
        <button type="button" onClick={() => setAsking(false)} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-ink">
          Keep
        </button>
        <button type="button" onClick={onConfirm} disabled={disabled} className="rounded-md px-2 py-1 text-[13px] font-medium text-[#c62828] hover:bg-[rgba(198,40,40,0.08)] disabled:opacity-50">
          {confirm}
        </button>
      </div>
    </div>
  );
}
