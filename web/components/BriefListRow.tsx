"use client";

import RetryButton from "./RetryButton";
import ArchiveButton from "./ArchiveButton";
import CopyLinkButton from "./CopyLinkButton";
import StatusBadge from "./StatusBadge";
import { TrackerLogo } from "./TrackerLogo";
import Elapsed from "./Elapsed";
import type { DashboardBrief } from "@/lib/brief-types";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((new Date().getTime() - then) / 1000);
  if (s < 60) return "now";
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
 * One Linear-like row in the Briefs feed, laid out on the shared `.ticket-grid`
 * column tracks (checkbox · title · status · id · updated · assignee · actions)
 * so every row's meta lands in the same column down the whole list - even when
 * a cell is empty, its track still holds the space.
 *
 * Every cell is a DIRECT grid child. Navigation for filed rows is a full-row
 * absolute overlay <a> (covers the row, but isn't a grid cell); the interactive
 * cells (checkbox, retry, archive) sit above it via `relative z-10`, so
 * clicking them never navigates. Processing rows show a live "filing… m:ss";
 * failed rows show a Retry; the exit animation (`brief-leaving`) lives here.
 */
export default function BriefListRow({
  brief: b,
  onArchive,
  onArchiveFailed,
  leaving = false,
  selected = false,
  anySelected = false,
  onToggleSelect,
}: {
  brief: DashboardBrief;
  onArchive?: (id: string) => void;
  onArchiveFailed?: (id: string) => void;
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
  const isDraft = b.status === "drafted";
  const isProcessing = b.status === "processing" || b.status === "uploaded";

  // The row opens the Brief page (canonical view) for both drafts and filed
  // tickets; filed rows also get a "open in tracker" action. Old filed briefs
  // without a share link fall back to opening the tracker directly.
  const briefHref = b.share_id ? `/b/${b.share_id}` : undefined;
  const trackerHref = ti?.url || b.ticket_url || undefined;
  const href = briefHref || (isFiled ? trackerHref : undefined);
  const asLink = (isFiled || isDraft) && !!href;

  const title =
    ti?.title ||
    (isDraft ? b.ticket_title || undefined : undefined) ||
    b.title ||
    (isFailed
      ? "Couldn't file this one"
      : isProcessing
        ? "Writing the ticket…"
        : isDraft
          ? "Untitled draft"
          : b.source_kind
            ? `${b.source_kind} brief`
            : "Untitled brief");

  // Checkbox is faint until you hover the row; it stays visible once it's
  // checked or while any selection is active. Clicking it selects (never navigates).
  const boxVisible = selected || anySelected;
  // Archived rows recede - dim the content cells so they read as "put away" at a
  // glance, while the checkbox + hover actions (incl. restore) stay full strength.
  const dim = b.archived ? " opacity-55" : "";

  return (
    <li
      className={`group animate-rise ticket-grid relative py-3 pl-3 pr-2.5 transition-colors hover:bg-cream-2/30${
        leaving ? " brief-leaving" : ""
      }${selected ? " bg-cream-2/50" : ""}`}
    >
      {isProcessing && <span aria-hidden className="queue-bar" />}

      {/* Full-row click target for filed rows. Absolutely positioned, so it
          covers the row without being a grid cell; interactive cells layer over
          it with `relative z-10`. */}
      {asLink && (
        <a
          href={href}
          target={briefHref ? undefined : "_blank"}
          rel="noreferrer"
          aria-label={title}
          className="absolute inset-0"
        />
      )}

      {/* 1 · Checkbox (always reserves its track - no layout shift on hover) */}
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
        className={`relative z-10 flex items-center justify-center transition-opacity duration-150 ${
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

      {/* 2 · Tracker id, or Retry on a live failed brief */}
      <div className={`flex min-w-0 items-center${dim}`}>
        {isFailed && !b.archived ? (
          <span className="relative z-10">
            <RetryButton briefId={b.id} />
          </span>
        ) : !isFailed && b.ticket_identifier ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-[0.625rem] text-accent">
            <TrackerLogo kind={b.provider ?? "linear"} size={13} />
            <span className="truncate">{b.ticket_identifier}</span>
          </span>
        ) : isDraft ? (
          <span className="font-mono text-[0.625rem] uppercase tracking-wide text-muted">draft</span>
        ) : (
          <span className="font-mono text-[0.625rem] text-muted/50">—</span>
        )}
      </div>

      {/* 3 · Title (+ inline error on failed rows) */}
      <div className={`min-w-0${dim}`}>
        <p className={`truncate text-[0.625rem] leading-snug ${isFailed ? "text-[#c62828]" : "text-ink"}`}>
          {title}
        </p>
        {isFailed && b.error && (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted">{b.error}</p>
        )}
      </div>

      {/* 4 · Status - readable chip (filing / didn't file / tracker state) */}
      <div className={`min-w-0${dim}`}>
        {isProcessing ? (
          <StatusBadge color="#dd6936">
            filing… <Elapsed since={b.updated_at || b.created_at} />
          </StatusBadge>
        ) : isFailed ? (
          <StatusBadge color="#c62828" title="Didn't file">
            didn&apos;t file
          </StatusBadge>
        ) : isDraft ? (
          <StatusBadge color="#8a8378" title="Draft - not filed">
            draft
          </StatusBadge>
        ) : (
          <StatusBadge color={ti?.stateColor || "#2e7d32"} title={ti?.stateName || "Filed"}>
            {ti?.stateName || "Filed"}
          </StatusBadge>
        )}
      </div>

      {/* 5 · Assignee - avatar + name (hidden < sm) */}
      <div className={`hidden min-w-0 items-center gap-2 sm:flex${dim}`}>
        {ti?.assignee ? (
          <>
            {ti.assignee.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ti.assignee.avatarUrl}
                alt=""
                title={ti.assignee.name}
                className="h-5 w-5 shrink-0 rounded-full border border-hairline object-cover"
              />
            ) : (
              <span
                title={ti.assignee.name}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-hairline bg-cream-2 text-[0.625rem] text-ink-2"
              >
                {initial(ti.assignee.name)}
              </span>
            )}
            <span className="truncate text-[0.625rem] text-ink-2">{ti.assignee.name}</span>
          </>
        ) : (
          <span className="text-[0.625rem] text-muted/50">—</span>
        )}
      </div>

      {/* 6 · Updated (hidden < sm) */}
      <span className={`hidden truncate font-mono text-[0.625rem] text-muted sm:block${dim}`}>
        {relativeTime(b.created_at)}
      </span>

      {/* 7 · Row action - Archive is the only removal (acts like delete). Faint
          until hover; hidden while a batch selection is active (the floating bar
          handles that), but the cell still holds its track. */}
      <div className="relative z-10 flex items-center justify-end gap-0.5">
        {!anySelected && isFiled && trackerHref && (
          <a
            href={trackerHref}
            target="_blank"
            rel="noreferrer"
            title={`Open in ${b.provider === "jira" ? "Jira" : "Linear"}`}
            aria-label="Open in tracker"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-cream-2 hover:text-ink-2 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7" />
              <path d="M8 7h9v9" />
            </svg>
          </a>
        )}
        {!anySelected && (isFiled || isDraft) && b.share_id && (
          <CopyLinkButton path={`/b/${b.share_id}`} variant="icon" />
        )}
        {!anySelected && (
          <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} />
        )}
      </div>
    </li>
  );
}
