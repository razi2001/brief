"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="text-accent no-underline hover:underline disabled:opacity-60"
      >
        {pending ? "retrying…" : "retry"}
      </button>
      {error && <span className="text-[#c62828]">{error}</span>}
    </span>
  );
}
