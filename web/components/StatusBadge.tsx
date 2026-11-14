import type { ReactNode } from "react";
import type { StatusGroup } from "@/lib/status-group";

/** What a status mark can draw: a ticket's group, or one of Brief's own states. */
export type StatusKind = StatusGroup | "working" | "failed";

const hex = (color: string) => (/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8a8378");

/**
 * The mark before a status, drawn the way Linear draws its own: the shape says
 * where the ticket stands (a dashed ring is a draft, an open ring is to do, a
 * half-filled one is under way, a tick is done, a cross is dropped) and the
 * colour is the tracker's.
 */
export function StatusGlyph({ kind, color, size = 14 }: { kind: StatusKind; color: string; size?: number }) {
  const c = hex(color);
  const ring = <circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" />;
  const mark = { stroke: "#fff", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} fill="none" aria-hidden="true" className={`shrink-0 ${kind === "working" ? "animate-spin [animation-duration:1.1s]" : ""}`}>
      {kind === "draft" && <circle cx="7" cy="7" r="5.75" stroke={c} strokeWidth="1.5" strokeDasharray="2.2 2.3" strokeLinecap="round" />}
      {kind === "open" && ring}
      {kind === "progress" && (
        <>
          {ring}
          <path d="M7 3.6a3.4 3.4 0 0 1 0 6.8Z" fill={c} />
        </>
      )}
      {kind === "done" && (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="m4.4 7.2 1.8 1.8 3.5-3.9" {...mark} />
        </>
      )}
      {kind === "closed" && (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="m5 5 4 4M9 5 5 9" {...mark} />
        </>
      )}
      {kind === "failed" && (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="M7 4v3.4" {...mark} />
          <circle cx="7" cy="9.9" r="0.9" fill="#fff" />
        </>
      )}
      {kind === "working" && (
        <>
          <circle cx="7" cy="7" r="5.75" stroke={c} strokeOpacity="0.22" strokeWidth="1.5" />
          <path d="M7 1.25A5.75 5.75 0 0 1 12.75 7" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * A Linear-style status: a small mark in the state's colour and a quiet
 * sentence-case label beside it. The colour lives only in the mark, so a light
 * "Todo" grey still reads on the white surface and the label stays legible.
 * With a `kind` the mark is its glyph; without one, a plain dot.
 */
export default function StatusBadge({
  color,
  title,
  children,
  compact = false,
  iconOnly = false,
  kind,
}: {
  color: string;
  title?: string;
  children: ReactNode;
  /** Below sm, show just the mark (the label stays for screen readers). */
  compact?: boolean;
  /** Always just the mark: a list row, where the label would be one more column. */
  iconOnly?: boolean;
  kind?: StatusKind;
}) {
  const tint = hex(color);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2" title={title}>
      {kind ? (
        <StatusGlyph kind={kind} color={tint} />
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tint }} aria-hidden />
      )}
      <span className={iconOnly ? "sr-only" : `truncate text-[13px] text-ink-2${compact ? " max-sm:sr-only" : ""}`}>{children}</span>
    </span>
  );
}
