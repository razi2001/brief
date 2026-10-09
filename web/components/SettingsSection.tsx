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

/** Small uppercase label over a block inside a section. */
export function Eyebrow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[0.6875rem] uppercase tracking-[0.12em] text-muted">{children}</span>
      {aside}
    </div>
  );
}

/** The page's one button style: compact, accent. */
export const buttonClass =
  "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg bg-accent px-4 text-xs tracking-[0.02em] text-cream transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-cream-2 disabled:text-muted disabled:hover:brightness-100";

/** Quiet secondary button. */
export const ghostButtonClass =
  "inline-flex h-9 shrink-0 cursor-pointer items-center rounded-lg border hairline px-4 text-xs text-ink-2 transition hover:border-ink/30 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
