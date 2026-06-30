"use client";

import { useEffect } from "react";

/**
 * Reloads the page after a short delay - used on a brief page that's still
 * being written up (status 'processing'), so it resolves into the finished
 * ticket on its own without the viewer touching anything.
 */
export default function PollReload({ ms = 2500 }: { ms?: number }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return null;
}
