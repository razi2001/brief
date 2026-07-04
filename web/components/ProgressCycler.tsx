"use client";

import { useEffect, useState } from "react";

/** Illustrative steps while the AI writes the draft. Not a live trace - a
 *  natural, moving status. Shared by the assistant rail and the visitor view. */
export const WRITING_STEPS = [
  "Reading your evidence…",
  "Pulling out what happened…",
  "Structuring the report…",
  "Writing it up clearly…",
];

/** Illustrative steps while the draft is filed to a tracker. */
export const FILING_STEPS = [
  "Connecting to your tracker…",
  "Checking the workspace…",
  "Finding the right team…",
  "Choosing the right labels…",
  "Setting the priority…",
  "Creating the ticket…",
];

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
  bare = false,
}: {
  messages: string[];
  intervalMs?: number;
  className?: string;
  /** Hide the leading pulse dot (the caller supplies its own indicator). */
  bare?: boolean;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), intervalMs);
    return () => clearInterval(t);
  }, [messages.length, intervalMs]);

  return (
    <span className={`inline-flex items-center gap-2 text-sm text-ink-2 ${className}`}>
      {!bare && <span className="dot-pulse h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
      {/* key change re-triggers the fade each time the message swaps */}
      <span key={i} className="status-swap">
        {messages[i]}
      </span>
    </span>
  );
}
