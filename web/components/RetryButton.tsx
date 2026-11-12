"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { explainFilingError } from "@/lib/filing-errors";

/**
 * Subtle accent-text button shown on FAILED brief rows. POSTs to the
 * Clerk-authed retry route (same-origin, so the session cookie is sent), then
 * refreshes the dashboard on success or surfaces the error inline.
 */
export default function RetryButton({ briefId }: { briefId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${briefId}/retry`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `retry failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(explainFilingError(e instanceof Error ? e.message : String(e)));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/[0.06] px-2 py-0.5 font-medium text-accent transition-colors hover:bg-accent/[0.12] disabled:opacity-60"
      >
        {pending ? "Retrying…" : "Retry"}
      </button>
      {error && <span className="text-[#c62828]" title={error}>{error}</span>}
    </span>
  );
}
