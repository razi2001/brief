import type { ReactNode } from "react";

/** Shared pieces of the Settings page (see SettingsList): icons, labels, buttons. */

export type SettingsIcon = "tracker" | "team" | "rules" | "replay";

const PATHS: Record<SettingsIcon, ReactNode> = {
  tracker: (
    <>
      <path d="M9 7H6a3 3 0 0 0 0 6h3M15 7h3a3 3 0 0 1 0 6h-3" />
      <path d="M8 10h8" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5M17.5 14.5a5.5 5.5 0 0 1 3 4.5" />
    </>
  ),
  rules: (
    <>
      <path d="M5 6h14M5 12h14M5 18h9" />
    </>
  ),
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l2.5 2" />
    </>
  ),
};

export function SettingsGlyph({ icon, size = 16 }: { icon: SettingsIcon; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[icon]}
    </svg>
  );
}

/** A block's label inside an open row: sentence case, Linear-quiet. */
export function Eyebrow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[13px] font-medium text-ink-2">{children}</span>
      {aside}
    </div>
  );
}

/** The page's primary button: compact, accent (globals.css .btn-accent). */
export const buttonClass =
  "btn-accent h-8 shrink-0 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:filter-none";

/** Quiet secondary button (globals.css .btn). */
export const ghostButtonClass =
  "btn h-8 shrink-0 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45";

/** The two-option switch ("team" / "my own"): a compact segmented control. */
export const segmentedClass = "inline-flex rounded-lg bg-[rgba(26,22,18,.05)] p-0.5";
export function segmentClass(on: boolean): string {
  return `h-6 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-colors ${
    on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(26,22,18,.12)]" : "text-muted hover:text-ink-2"
  }`;
}

/** Text fields on this page: white, hairline, accent focus ring. */
export const fieldFocusClass = "focus:border-accent/50 focus:ring-[3px] focus:ring-accent/20";

/** The blast-radius confirmations (team defaults, team sites). */
export const dialogBackdropClass =
  "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(26,22,18,.32)] px-4";
export const dialogPanelClass = "ai-float w-full max-w-md rounded-xl border hairline bg-surface p-5";
