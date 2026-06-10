"use client";

import { useState } from "react";

/**
 * Subtle "archive" action for a brief. OPTIMISTIC + RELIABLE: clicking removes
 * the card instantly via `onArchive(id)`, then writes archived_at to the server.
 *
 * The write is NOT fire-and-forget — a plain dropped fetch was the archive bug:
 * if the page unloaded/navigated before it committed, or auth() hit a transient
 * Clerk error, the write was silently lost and the brief reappeared on the next
 * load. So we:
 *   - send with `keepalive: true` (survives an unload, like the extension's
 *     submitBrief), and
 *   - await the response and retry once on failure, and
 *   - if it still fails, call `onArchiveFailed(id)` to bring the card back —
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
        // network blip — fall through to retry
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
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={archive}
        disabled={done}
        title="Archive this brief"
        aria-label="Archive this brief"
        className="font-mono text-[0.6875rem] tracking-wide text-muted no-underline transition-opacity hover:text-ink-2 hover:underline disabled:opacity-60"
      >
        archive
      </button>
    </span>
  );
}
