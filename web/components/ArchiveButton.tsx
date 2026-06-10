"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Subtle "archive" action for a brief row. POSTs to the Clerk-authed archive
 * route (same-origin, so the session cookie is sent), then refreshes the
 * dashboard so the brief drops out of the feed. Surfaces errors inline.
 *
 * Rendered as a SIBLING of the card link (never nested inside the <a>) and
 * absolutely positioned by the card, so its own click is captured here and
 * never navigates the card. stopPropagation/preventDefault keep it isolated.
 */
export default function ArchiveButton({ briefId }: { briefId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${briefId}/archive`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `archive failed (${res.status})`);
      }
      router.refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[0.6875rem] text-[#c62828]">{error}</span>}
      <button
        type="button"
        onClick={archive}
        disabled={pending}
        title="Archive this brief"
        className="font-mono text-[0.6875rem] tracking-wide text-muted no-underline transition-opacity hover:text-ink-2 hover:underline disabled:opacity-60"
      >
        {pending ? "archiving…" : "archive"}
      </button>
    </span>
  );
}
