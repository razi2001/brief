"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls the current route while at least one brief is still in a non-terminal
 * state (uploaded/processing), so the dashboard reflects "filed"/"failed"
 * without a manual reload. Renders nothing and sets no interval when inactive.
 */
export default function AutoRefresh({
  active,
  intervalMs = 7000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  if (!active) return null;

  return (
    <span className="text-xs text-muted" aria-live="polite">
      updating…
    </span>
  );
}
