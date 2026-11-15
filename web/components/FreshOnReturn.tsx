"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Server renders this tab has already put on screen. */
const shownRenders = new Set<string>();

/**
 * Pages are kept in the client router for a while (staleTimes in
 * next.config.ts), so a link back to one shows it at once. That copy may
 * predate what you just did elsewhere: a bug bash you created, a request you
 * posted. Each server render carries a fresh id; seeing an id a second time
 * means the page came from that cache, so it is asked again from the server.
 * Calls onRefresh (if given) when it does.
 */
export function useFreshOnReturn(renderId: string | undefined, onRefresh?: () => void) {
  const router = useRouter();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // (Strict mode runs this twice for one mount; only the first counts.)
    if (!renderId || handled.current === renderId) return;
    handled.current = renderId;
    if (shownRenders.has(renderId)) {
      onRefresh?.();
      router.refresh();
    } else {
      shownRenders.add(renderId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per render id
  }, [renderId, router]);
}

/** useFreshOnReturn for a server page: render it with crypto.randomUUID(). */
export default function FreshOnReturn({ renderId }: { renderId: string }) {
  useFreshOnReturn(renderId);
  return null;
}
