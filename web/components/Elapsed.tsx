"use client";

import { useEffect, useState } from "react";

/** m:ss elapsed since `since`, ticking once a second. */
function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${`${s}`.padStart(2, "0")}`;
}

/**
 * Live "filing… m:ss" elapsed counter for a processing brief, so it never looks
 * frozen. Starts from `since` (when the brief entered processing) and updates
 * each second on the client. The value is clock-derived, so server and client
 * first paints differ by a beat — harmless here, so the span suppresses the
 * hydration warning and the interval keeps it current.
 */
export default function Elapsed({ since }: { since?: string | null }) {
  const start = since ? new Date(since).getTime() : NaN;
  const [now, setNow] = useState<number>(() => new Date().getTime());

  useEffect(() => {
    if (Number.isNaN(start)) return;
    const id = setInterval(() => setNow(new Date().getTime()), 1000);
    return () => clearInterval(id);
  }, [start]);

  if (Number.isNaN(start)) return null;
  return (
    <span suppressHydrationWarning className="tabular-nums">
      {format(now - start)}
    </span>
  );
}
