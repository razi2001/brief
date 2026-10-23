"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Server renders this tab has already put on screen. */
const shownRenders = new Set<string>();

/**
 * Keeps the server-rendered feed in sync without a manual reload:
 *  - polls fast (intervalMs) while at least one brief is still in a
 *    non-terminal state, so "filed"/"failed" lands as it happens,
 *  - polls slow (idleIntervalMs) otherwise, so live tracker state (status
 *    changes, tickets filed from the extension) keeps flowing in,
 *  - refreshes immediately when the tab regains focus (throttled), which is
 *    exactly when a stale feed gets noticed,
 *  - refreshes when the page comes back from the client cache (Back, or a
 *    link within staleTimes): it shows at once, but may predate a draft just
 *    created or edited elsewhere in the app.
 *
 * Renders the "updating…" hint only while actively processing.
 */
export default function AutoRefresh({
  active,
  intervalMs = 7000,
  idleIntervalMs = 30000,
  renderId,
}: {
  active: boolean;
  intervalMs?: number;
  idleIntervalMs?: number;
  /** Unique per server render; seeing one again is how a cached page shows. */
  renderId?: string;
}) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // (Strict mode runs this twice for one mount; only the first counts.)
    if (!renderId || handled.current === renderId) return;
    handled.current = renderId;
    if (shownRenders.has(renderId)) {
      lastRefresh.current = Date.now();
      router.refresh();
    } else {
      shownRenders.add(renderId);
    }
  }, [renderId, router]);

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
