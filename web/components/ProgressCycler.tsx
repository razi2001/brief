"use client";

import { useEffect, useState } from "react";

/**
 * A gentle status line that cycles through plausible progress messages while a
 * long action runs (writing the draft, filing to a tracker). No boxy spinner -
 * a soft pulsing dot + text that fades as it swaps, so the wait feels alive and
 * natural instead of a generic loader. The messages are illustrative of the
 * work happening, not a live trace.
 */
export default function ProgressCycler({
  messages,
  intervalMs = 2600,
  className = "",
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), intervalMs);
    return () => clearInterval(t);
  }, [messages.length, intervalMs]);

  return (
    <span className={`inline-flex items-center gap-2 text-sm text-ink-2 ${className}`}>
      <span className="dot-pulse h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      {/* key change re-triggers the fade each time the message swaps */}
      <span key={i} className="status-swap">
        {messages[i]}
      </span>
    </span>
  );
}
