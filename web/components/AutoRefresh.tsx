"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the server-rendered feed in sync without a manual reload:
 *  - polls fast (intervalMs) while at least one brief is still in a
 *    non-terminal state, so "filed"/"failed" lands as it happens,
 *  - polls slow (idleIntervalMs) otherwise, so live tracker state (status
 *    changes, tickets filed from the extension) keeps flowing in,
 *  - refreshes immediately when the tab regains focus (throttled), which is
 *    exactly when a stale feed gets noticed.
 *
 * Renders the "updating…" hint only while actively processing.
 */
export default function AutoRefresh({
  active,
  intervalMs = 7000,
  idleIntervalMs = 30000,
}: {
  active: boolean;
  intervalMs?: number;
  idleIntervalMs?: number;
}) {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const every = active ? intervalMs : idleIntervalMs;
    if (!every) return;
    const id = setInterval(() => {
      lastRefresh.current = Date.now();
      router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [active, intervalMs, idleIntervalMs, router]);

  useEffect(() => {
    const onFocus = () => {
      // Throttle: alt-tabbing back and forth shouldn't hammer the server.
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefresh.current < 5000) return;
      lastRefresh.current = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  if (!active) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
      <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      Updating…
    </span>
  );
}
