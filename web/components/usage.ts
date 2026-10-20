import type { ClientEvent } from "@/lib/events";

/**
 * One activity-log event from the signed-in app (POST /api/events).
 * Fire-and-forget: sendBeacon survives the page navigating away, and
 * tracking never breaks the page.
 */
export function sendEvent(name: ClientEvent, props: Record<string, string | number | boolean> = {}): void {
  try {
    const body = JSON.stringify({ name, props });
    if (navigator.sendBeacon?.("/api/events", body)) return;
    void fetch("/api/events", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    /* nothing to do */
  }
}
