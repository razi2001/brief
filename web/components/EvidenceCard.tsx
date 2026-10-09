"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DownloadButton from "./DownloadButton";
import ReplayPlayer from "./ReplayPlayer";

/**
 * One evidence asset (screenshot / recording) on the brief page. Everyone can
 * view + download; the owner can remove it - a two-step control (click →
 * "Remove?") so a stray hover-click never destroys evidence. Removal is
 * optimistic (the card collapses immediately) with the server delete behind
 * it; a failure brings the card back.
 */
export default function EvidenceCard({
  briefId,
  url,
  filename,
  path,
  kind,
  voiceUrl,
  canRemove,
  index,
}: {
  briefId: string;
  url: string;
  filename: string;
  /** Storage-relative path (e.g. "screenshots/abc.png") - the delete target. */
  path: string;
  kind: "image" | "video" | "replay";
  voiceUrl?: string;
  canRemove: boolean;
  index: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (gone) return null;

  function arm() {
    setConfirming(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirming(false), 2600);
  }

  async function remove() {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    setLeaving(true);
    setTimeout(() => setGone(true), 240);
    try {
      const res = await fetch(`/api/briefs/${briefId}/evidence`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      // Honest feedback: the delete failed, so the card comes back.
      setGone(false);
      setLeaving(false);
    }
  }

  return (
    <div
      className={`group/ev relative overflow-hidden rounded-xl border border-hairline bg-cream/40 transition-[opacity,transform] duration-200 ${
        leaving ? "scale-[0.99] opacity-0" : ""
      }`}
    >
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        {canRemove &&
          (confirming ? (
            <button
              type="button"
              onClick={remove}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#c62828]/30 bg-[#c62828] px-2.5 text-xs font-medium text-white shadow-sm transition hover:brightness-95"
            >
              Remove?
            </button>
          ) : (
            <button
              type="button"
              onClick={arm}
              title="Remove from this brief"
              aria-label="Remove evidence"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-cream/90 text-ink-2 opacity-0 shadow-sm backdrop-blur transition group-hover/ev:opacity-100 hover:bg-cream hover:text-[#c62828] focus-visible:opacity-100"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
              </svg>
            </button>
          ))}
      </div>
      {/* DownloadButton positions itself top-right; shift it left of Remove. */}
      <div className={canRemove ? "[&>button]:right-12" : undefined}>
        <DownloadButton url={url} filename={filename} />
      </div>
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Evidence ${index + 1}`} className="w-full" />
      ) : kind === "replay" ? (
        <ReplayPlayer url={url} voiceUrl={voiceUrl} />
      ) : (
        <video src={url} controls className="w-full bg-ink" />
      )}
    </div>
  );
}
