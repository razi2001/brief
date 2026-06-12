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
  onUnarchive,
  onDelete,
  leaving = false,
  selected = false,
  anySelected = false,
  onToggleSelect,
}: {
  brief: DashboardBrief;
  onArchive?: (id: string) => void;
  onArchiveFailed?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  leaving?: boolean;
  /** This row is selected. */
  selected?: boolean;
  /** Any row is selected (keeps every checkbox visible while a selection is active). */
  anySelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const ti = b.ticket ?? null;
  const isFiled = b.status === "filed";
  const isFailed = b.status === "failed";
  const isProcessing = b.status === "processing" || b.status === "uploaded";

  const href = ti?.url || b.ticket_url || undefined;
  const asLink = isFiled && !!href;

  const title =
    ti?.title ||
    b.title ||
    (isFailed
      ? "Couldn't file this one"
      : isProcessing
        ? "Writing the ticket…"
        : b.source_kind
          ? `${b.source_kind} brief`
          : "Untitled brief");

  const inner = (
    <>
      {/* Title — smaller, and capped so it crops well before the status column. */}
      <div className="min-w-0 max-w-[60%] flex-1">
        <p className={`truncate text-[0.8125rem] leading-snug ${isFailed ? "text-[#c62828]" : "text-ink"}`}>
          {title}
        </p>
        {isFailed && b.error && (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted">{b.error}</p>
        )}
      </div>

      {/* Right meta */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {/* Status column — three distinct states. Failed must NOT borrow the
            green "Filed" look; it gets a red "didn't file" with the Retry. */}
        {isProcessing ? (
          <span className="w-[5.5rem] text-right font-mono text-[0.625rem] text-accent">
            filing… <Elapsed since={b.updated_at || b.created_at} />
          </span>
        ) : isFailed ? (
          <span
            className="w-[5.5rem] truncate text-right font-mono text-[0.625rem] text-[#c62828]"
            title="Didn't file"
          >
            didn&apos;t file
          </span>
        ) : (
          <span
            className="w-[5.5rem] truncate text-right font-mono text-[0.625rem]"
            style={{ color: ti?.stateColor || "#2e7d32" }}
            title={ti?.stateName || "Filed"}
          >
            {ti?.stateName || "Filed"}
          </span>
        )}
        {/* Retry only makes sense on a live (non-archived) failed brief —
            an archived one should be restored first. */}
        {isFailed && !b.archived && <RetryButton briefId={b.id} />}
        {!isFailed && b.ticket_identifier && (
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
    </>
  );

  const contentClass = "flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 no-underline";

  // Checkbox is faint until you hover the row; it stays visible once it's
  // checked or while any selection is active. Clicking it selects (never navigates).
  const boxVisible = selected || anySelected;

  return (
    <li
      className={`group animate-rise relative flex items-stretch transition-colors hover:bg-cream-2/30${
        leaving ? " brief-leaving" : ""
      } ${selected ? "bg-cream-2/50" : ""}`}
    >
      {isProcessing && <span aria-hidden className="queue-bar" />}

      {/* Leading checkbox — always occupies space (no layout shift), shown on
          hover / when selected. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect?.(b.id);
        }}
        className={`flex shrink-0 items-center pl-4 pr-1 transition-opacity duration-150 ${
          boxVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <span
          className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
            selected ? "border-accent bg-accent text-cream" : "border-hairline bg-transparent text-transparent"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 6" />
          </svg>
        </span>
      </button>

      {asLink ? (
        <a href={href} target="_blank" rel="noreferrer" className={contentClass}>
          {inner}
        </a>
      ) : (
        <div className={contentClass}>{inner}</div>
      )}

      {/* Row actions — archive + delete, faint until hover. Hidden while a batch
          selection is active (the header icons handle batch ops then). */}
      {!anySelected && (
        <div className="flex shrink-0 items-center gap-0.5 pl-1 pr-2.5">
          {b.archived ? (
            <span className="mr-1 inline-flex items-center gap-1.5">
              <span className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-muted">
                archived
              </span>
              {onUnarchive && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUnarchive(b.id);
                  }}
                  className="font-mono text-[0.625rem] text-accent opacity-0 transition-opacity duration-150 hover:underline focus-visible:opacity-100 group-hover:opacity-100"
                >
                  restore
                </button>
              )}
            </span>
          ) : (
            <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete?.(b.id);
            }}
            title="Delete"
            aria-label="Delete this ticket"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[rgba(198,40,40,.1)] hover:text-[#c62828] focus-visible:opacity-100 group-hover:opacity-100"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
}
