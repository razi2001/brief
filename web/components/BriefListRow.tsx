"use client";

import RetryButton from "./RetryButton";
import ArchiveButton from "./ArchiveButton";
import { TrackerLogo } from "./TrackerLogo";
import Elapsed from "./Elapsed";
import type { DashboardBrief } from "@/lib/brief-types";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((new Date().getTime() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
}

function initial(name?: string): string {
  const n = (name ?? "").trim();
  return n ? n[0].toUpperCase() : "?";
}

/**
 * One Linear-like row in the Briefs feed. Replaces the big 2-col card: a single
 * dense line — status dot, title, then right-aligned meta (tracker id, time,
 * assignee). Processing rows show a live "filing… m:ss" elapsed so nothing looks
 * frozen; failed rows show a Retry; filed rows link to the ticket. Archive is an
 * absolutely-positioned SIBLING of the row link (never nested in the <a>), faint
 * until hover. Exit animation (`brief-leaving`) lives on the <li> wrapper.
 */
export default function BriefListRow({
  brief: b,
  onArchive,
  onArchiveFailed,
  leaving = false,
}: {
  brief: DashboardBrief;
  onArchive?: (id: string) => void;
  onArchiveFailed?: (id: string) => void;
  leaving?: boolean;
}) {
  const ti = b.ticket ?? null;
  const isFiled = b.status === "filed";
  const isFailed = b.status === "failed";
  const isProcessing = b.status === "processing" || b.status === "uploaded";

  const href = ti?.url || b.ticket_url || undefined;
  const asLink = isFiled && !!href;

  const title =
    ti?.title ||
    (isFailed
      ? "Couldn't file this one"
      : isProcessing
        ? "Writing the ticket…"
        : b.source_kind
          ? `${b.source_kind} brief`
          : "Untitled brief");

  const dotColor = isFiled
    ? ti?.stateColor || "#2e7d32"
    : isProcessing
      ? "#dd6936"
      : "#c62828";

  const row = (
    <div className="relative flex items-center gap-3 px-4 py-3 pr-9 transition-colors hover:bg-cream-2/40">
      {isProcessing && <span aria-hidden className="shimmer pointer-events-none absolute inset-0" />}
      <span
        className={`relative h-2 w-2 shrink-0 rounded-full ${isProcessing ? "dot-pulse" : ""}`}
        style={{ backgroundColor: dotColor }}
        title={ti?.stateName || b.status}
      />

      <div className="relative min-w-0 flex-1">
        <p className={`truncate text-sm ${isFailed ? "text-[#c62828]" : "text-ink"}`}>{title}</p>
        {isFailed && b.error && (
          <p className="mt-0.5 truncate text-xs text-muted">{b.error}</p>
        )}
      </div>

      {/* Right meta */}
      <div className="relative flex shrink-0 items-center gap-3">
        {isProcessing && (
          <span className="font-mono text-[0.6875rem] text-accent">
            filing… <Elapsed since={b.updated_at || b.created_at} />
          </span>
        )}
        {isFailed && <RetryButton briefId={b.id} />}
        {b.ticket_identifier && (
          <span className="hidden items-center gap-1.5 font-mono text-[0.6875rem] text-accent sm:inline-flex">
            <TrackerLogo kind={b.provider ?? "linear"} size={13} />
            {b.ticket_identifier}
          </span>
        )}
        <span className="font-mono text-[0.625rem] text-muted">{relativeTime(b.created_at)}</span>
        {ti?.assignee &&
          (ti.assignee.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ti.assignee.avatarUrl}
              alt=""
              title={ti.assignee.name}
              className="h-5 w-5 rounded-full border border-hairline object-cover"
            />
          ) : (
            <span
              title={ti.assignee.name}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-cream-2 text-[0.625rem] text-ink-2"
            >
              {initial(ti.assignee.name)}
            </span>
          ))}
      </div>
    </div>
  );

  const archiveControl = (
    <div className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-cream/85 px-1.5 py-0.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} />
    </div>
  );

  return (
    <li className={`group relative${leaving ? " brief-leaving" : ""}`}>
      {asLink ? (
        <a href={href} target="_blank" rel="noreferrer" className="block no-underline">
          {row}
        </a>
      ) : (
        row
      )}
      {archiveControl}
    </li>
  );
}
