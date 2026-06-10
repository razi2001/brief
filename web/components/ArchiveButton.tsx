"use client";

import { useState } from "react";

/**
 * Subtle "archive" action for a brief row. OPTIMISTIC: clicking removes the
 * card instantly via the parent's `onArchive(id)` (which drops it from the
 * rendered list), then fires the archive POST in the background — we don't
 * await it and we don't refresh. The archive route is best-effort; the next
 * real load reflects the true server state. If the POST fails, the card simply
 * reappears on the next load, which is fine.
 *
 * Rendered as a SIBLING of the card link (never nested inside the <a>) and
 * absolutely positioned by the card, so its own click is captured here and
 * never navigates the card. stopPropagation/preventDefault keep it isolated.
 */
export default function ArchiveButton({
  briefId,
  onArchive,
}: {
  briefId: string;
  onArchive?: (id: string) => void;
}) {
  const [done, setDone] = useState(false);

  function archive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (done) return;
    setDone(true);
    // Instant: remove the card from the parent's view right now.
    onArchive?.(briefId);
    // Fire-and-forget the server write — no await, no refresh.
    fetch(`/api/briefs/${briefId}/archive`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {});
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
