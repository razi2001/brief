"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SettingsGlyph, type SettingsIcon } from "./SettingsSection";

export type SettingsRow = {
  id: string;
  label: string;
  icon: SettingsIcon;
  /** What it is set to now, shown on the row. */
  summary: ReactNode;
  /** The editor, shown when the row is open. None: a plain row that doesn't open. */
  body?: ReactNode;
  /** What a click does ("Change", "Edit"), shown on the right of a closed row. */
  action?: string;
};

/**
 * Settings as one list: a row per setting with its current value, and a click
 * opens the editor in place (one at a time). A link to #id opens that row.
 *
 * An open row's editor is indented under the label, on a soft inset band
 * (globals.css .settings-row-body flattens the cards inside it).
 */
export default function SettingsList({ rows, initialOpen = null }: { rows: SettingsRow[]; initialOpen?: string | null }) {
  const [open, setOpen] = useState<string | null>(initialOpen);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (rows.some((r) => r.id === id && r.body)) setOpen(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [rows]);

  return (
    <div className="card overflow-hidden">
      {rows.map((r, i) => {
        const on = open === r.id && !!r.body;
        // Label left, current value right: the row reads like Linear's settings.
        const head = (
          <>
            <span className="grid h-6 w-6 shrink-0 place-items-center text-muted">
              <SettingsGlyph icon={r.icon} size={16} />
            </span>
            <span className="shrink-0 text-sm text-ink">{r.label}</span>
            <span className="ml-auto flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-[13px]">
              {r.summary}
            </span>
          </>
        );
        return (
          <section key={r.id} id={r.id} className={`scroll-mt-6 ${i > 0 ? "border-t hairline" : ""}`}>
            {r.body ? (
              <button
                type="button"
                onClick={() => setOpen(on ? null : r.id)}
                aria-expanded={on}
                aria-controls={`${r.id}-body`}
                title={on ? undefined : r.action}
                className="group flex h-12 w-full cursor-pointer items-center gap-2.5 px-4 text-left transition-colors hover:bg-surface-2"
              >
                {head}
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`shrink-0 text-muted/70 transition-transform duration-200 group-hover:text-ink-2 ${on ? "rotate-90" : ""}`}
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            ) : (
              // Same columns as an opening row, with the chevron's width kept
              // so values line up down the list.
              <div className="flex h-12 items-center gap-2.5 px-4">
                {head}
                <span aria-hidden="true" className="w-3.5 shrink-0" />
              </div>
            )}
            {on && (
              <div
                id={`${r.id}-body`}
                className="settings-row-body border-t hairline bg-surface-2/60 px-4 pt-4 pb-5 sm:pl-[3.25rem]"
              >
                {r.body}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
