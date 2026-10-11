"use client";

import { useState } from "react";

/**
 * Copies the absolute URL for a path (built from the current origin, so it's
 * correct in dev and prod). Two looks:
 *   - "button": a labeled pill for the shareable brief page header.
 *   - "icon": a faint, hover-revealed icon that matches ArchiveButton in a
 *     ticket row (sits above the row's full-row link via the caller's z-10).
 */
export default function CopyLinkButton({
  path,
  variant = "button",
}: {
  path: string;
  variant?: "button" | "icon";
}) {
  const [done, setDone] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard blocked - no-op */
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={copy}
        title={done ? "Link copied" : "Copy share link"}
        aria-label="Copy share link"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[rgba(26,22,18,0.06)] hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
      >
        {done ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn"
    >
      {done ? (
        <>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 6" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
            <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
          </svg>
          Copy link
        </>
      )}
    </button>
  );
}
