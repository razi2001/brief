"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While a brief is still being written/filed (status 'processing'/'uploaded'),
 * softly re-fetch the server component on an interval so it resolves into the
 * finished ticket on its own. Uses router.refresh() (not a full page reload),
 * so there's no white flash, no scroll jump, and client state is preserved -
 * the content just updates in place.
 */
export default function PollReload({ ms = 2500 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [ms, router]);
  return null;
}
