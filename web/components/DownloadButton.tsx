"use client";

import { useState } from "react";

const ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);

/**
 * Downloads an evidence asset. Fetches the (signed) URL as a blob and saves it
 * with a sensible filename; if a cross-origin fetch is blocked, falls back to
 * opening the asset so the viewer can still save it. Used to grab a screenshot
 * or recording to attach in another tracker.
 */
export default function DownloadButton({
  url,
  filename,
  variant = "overlay",
}: {
  url: string;
  filename: string;
  variant?: "overlay" | "pill";
}) {
  const [busy, setBusy] = useState(false);

  async function download(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch {
      window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  }

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="btn disabled:opacity-60"
      >
        {ICON}
        Download
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      title="Download"
      aria-label="Download asset"
      className="absolute right-2.5 top-2.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface/95 text-ink-2 opacity-0 shadow-sm backdrop-blur transition group-hover/ev:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100 disabled:opacity-60"
    >
      {ICON}
    </button>
  );
}
