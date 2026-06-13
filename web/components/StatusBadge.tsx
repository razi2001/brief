import type { ReactNode } from "react";

/**
 * A status chip that actually reads: a color-tinted pill (state color at low
 * alpha) with a solid colored dot and a DARK label. The old version coloured
 * the text itself with the tracker state colour - fine for a red "didn't file",
 * but a light "Todo" grey vanished on the cream. Here the colour lives in the
 * dot + tint while the label stays ink-dark, so every state is legible and the
 * hue still pops.
 */
export default function StatusBadge({
  color,
  title,
  children,
}: {
  color: string;
  title?: string;
  children: ReactNode;
}) {
  const tint = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8a8378";
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{ backgroundColor: `${tint}1f`, borderColor: `${tint}59` }}
      title={title}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} aria-hidden />
      <span className="truncate font-mono text-[0.625rem] font-medium text-ink-2">{children}</span>
    </span>
  );
}
