"use client";

import { useState } from "react";

/**
 * Subtle "archive" action for a brief. OPTIMISTIC + RELIABLE: clicking removes
 * the card instantly via `onArchive(id)`, then writes archived_at to the server.
 *
 * The write is NOT fire-and-forget - a plain dropped fetch was the archive bug:
 * if the page unloaded/navigated before it committed, or auth() hit a transient
 * Clerk error, the write was silently lost and the brief reappeared on the next
 * load. So we:
 *   - send with `keepalive: true` (survives an unload, like the extension's
 *     submitBrief), and
 *   - await the response and retry once on failure, and
 *   - if it still fails, call `onArchiveFailed(id)` to bring the card back -
 *     honest, immediate feedback instead of a silent loss that resurfaces later.
 *
 * Rendered as a SIBLING of the card link (never nested inside the <a>), so its
 * own click is captured here; stopPropagation/preventDefault keep it isolated.
 */
export default function ArchiveButton({
  briefId,
  onArchive,
  onArchiveFailed,
}: {
  briefId: string;
  onArchive?: (id: string) => void;
  onArchiveFailed?: (id: string) => void;
}) {
  const [done, setDone] = useState(false);

  async function postArchive(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/briefs/${briefId}/archive`, {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
        });
        if (res.ok) return true;
      } catch {
        // network blip - fall through to retry
      }
    }
    return false;
  }

  async function archive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (done) return;
    setDone(true);
    // Instant: remove the card from the parent's view right now.
    onArchive?.(briefId);
    // Reliable write. On definitive failure, restore the card and re-enable.
    const ok = await postArchive();
    if (!ok) {
      onArchiveFailed?.(briefId);
      setDone(false);
    }
  }

  return (
    <button
      type="button"
      onClick={archive}
      disabled={done}
      title="Archive"
      aria-label="Archive this ticket"
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[rgba(26,22,18,0.06)] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
    >
      <svg
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
      </svg>
    </button>
  );
}
