import type { ReactNode } from "react";

/**
 * A Linear-style status: a small solid dot in the state's colour and a quiet
 * sentence-case label beside it. The colour lives only in the dot, so a light
 * "Todo" grey still reads on the white surface and the label stays legible.
 */
export default function StatusBadge({
  color,
  title,
  children,
  compact = false,
}: {
  color: string;
  title?: string;
  children: ReactNode;
  /** Below sm, show just the dot (the label stays for screen readers). */
  compact?: boolean;
}) {
  const tint = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8a8378";
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2" title={title}>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: tint, boxShadow: `0 0 0 2.5px ${tint}26` }}
        aria-hidden
      />
      <span className={`truncate text-[13px] text-ink-2${compact ? " max-sm:sr-only" : ""}`}>{children}</span>
    </span>
  );
}
