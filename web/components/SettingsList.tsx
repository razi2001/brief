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
 * An open row's editor is indented under the label and drawn as a plain
 * hairline panel (globals.css .settings-row-body), not a floating card.
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
        const head = (
          <>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(221,105,54,.1)] text-accent">
              <SettingsGlyph icon={r.icon} size={17} />
            </span>
            <span className="w-28 shrink-0 text-sm text-ink sm:w-32">{r.label}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm">{r.summary}</span>
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
                className={`group flex w-full cursor-pointer items-center gap-3.5 px-5 py-4 text-left transition-colors ${
                  on ? "" : "hover:bg-[rgba(26,22,18,.025)]"
                }`}
              >
                {head}
                {r.action && !on && (
                  <span className="hidden shrink-0 text-xs text-muted transition-colors group-hover:text-accent sm:inline">
                    {r.action}
                  </span>
                )}
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`shrink-0 text-muted transition-transform duration-200 group-hover:text-accent ${on ? "rotate-90" : ""}`}
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            ) : (
              <div className="flex items-center gap-3.5 px-5 py-4">{head}</div>
            )}
            {on && (
              <div
                id={`${r.id}-body`}
                className="settings-row-body px-5 pb-5 sm:pl-[4.375rem]"
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
