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
  tile = false,
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
  /** A grid tile: the media sits in a fixed 16:10 frame so tiles line up. */
  tile?: boolean;
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
      className={`group/ev relative overflow-hidden rounded-xl border border-hairline bg-surface shadow-[0_1px_2px_rgba(26,22,18,0.04)] transition-[opacity,transform,border-color] duration-200 hover:border-[rgba(26,22,18,0.16)] ${
        leaving ? "scale-[0.99] opacity-0" : ""
      }`}
    >
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        {canRemove &&
          (confirming ? (
            <button
              type="button"
              onClick={remove}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#c62828]/30 bg-[#c62828] px-2.5 text-xs font-medium text-white shadow-sm transition hover:brightness-95"
            >
              Remove?
            </button>
          ) : (
            <button
              type="button"
              onClick={arm}
              title="Remove from this brief"
              aria-label="Remove evidence"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface/95 text-ink-2 opacity-0 shadow-sm backdrop-blur transition group-hover/ev:opacity-100 hover:bg-surface hover:text-[#c62828] focus-visible:opacity-100"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
              </svg>
            </button>
          ))}
      </div>
      {/* DownloadButton positions itself top-right; shift it left of Remove. */}
      <div className={canRemove ? "[&>button]:right-11" : undefined}>
        <DownloadButton url={url} filename={filename} />
      </div>
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Evidence ${index + 1}`}
          className={tile ? "aspect-[16/10] w-full bg-surface-2 object-contain" : "w-full"}
        />
      ) : kind === "replay" ? (
        <ReplayPlayer url={url} voiceUrl={voiceUrl} />
      ) : (
        <video src={url} controls className="w-full bg-ink" />
      )}
      <div className="flex items-center gap-2 border-t border-hairline px-3 py-2 text-xs text-muted">
        <span className="shrink-0 text-ink-2">
          {kind === "image" ? "Screenshot" : kind === "replay" ? "Replay" : "Recording"}
        </span>
        <span className="min-w-0 truncate font-mono text-[11px]">{filename}</span>
      </div>
    </div>
  );
}
