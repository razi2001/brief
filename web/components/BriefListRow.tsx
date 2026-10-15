"use client";

import Link from "next/link";
import RetryButton from "./RetryButton";
import ArchiveButton from "./ArchiveButton";
import StatusBadge from "./StatusBadge";
import { TrackerLogo } from "./TrackerLogo";
import { shortIdentifier } from "@/lib/ticket-sync";
import { PROVIDER_LABELS } from "./provider-labels";
import BrandMark from "./BrandMark";
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
 * column tracks (checkbox · id · title · status · assignee · updated · actions)
 * so every row's meta lands in the same column down the whole list - even when
 * a cell is empty, its track still holds the space.
 *
 * Every cell is a DIRECT grid child. Navigation for filed rows is a full-row
 * absolute overlay <a> (covers the row, but isn't a grid cell); the interactive
 * cells (checkbox, retry, archive) sit above it via `relative z-10`, so
 * clicking them never navigates. Processing rows show a live "Filing m:ss";
 * failed rows show a Retry; the exit animation (`brief-leaving`) lives here.
 */
export default function BriefListRow({
  brief: b,
  view = "tickets",
  onArchive,
  onArchiveFailed,
  leaving = false,
  selected = false,
  anySelected = false,
  onToggleSelect,
}: {
  brief: DashboardBrief;
  /** The list it's in: in Drafts a processing brief is being written, not filed. */
  view?: "tickets" | "drafts";
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
  // the brief opens inside the app: drafts under Drafts, the rest under Tickets
  const writing = isProcessing && view === "drafts";
  const briefHref = b.share_id ? `/${isDraft || writing ? "drafts" : "tickets"}/${b.share_id}` : undefined;
  // A ticket the tracker no longer has: nothing to open there, so the row and
  // its id chip fall back to the Brief page.
  const trackerHref = ti?.deleted ? undefined : ti?.url || b.ticket_url || undefined;
  // A filed ticket opens where it lives now - Linear, Jira, GitHub - in a new
  // tab. Everything else (drafts, filing, didn't file, a ticket the tracker
  // deleted) opens inside the app.
  const href = (isFiled && trackerHref) || briefHref;
  const asLink = !!href;
  const hrefExternal = !!href && href !== briefHref; // tracker link → new tab
  // Linear, Jira, GitHub - every tracker by its own name, so its id opens it there
  const providerName = PROVIDER_LABELS[b.provider ?? "linear"] ?? "Linear";
  // Empty for trackers with no readable key (Notion, Asana): the logo alone
  // still opens the ticket.
  const shortId = shortIdentifier(b.ticket_identifier, b.provider);

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
      className={`group animate-rise ticket-grid relative min-h-[42px] py-2 pl-3 pr-2.5 transition-colors max-sm:gap-x-2 max-sm:[grid-template-columns:1.5rem_5.25rem_minmax(0,1fr)_0.75rem_1.75rem] ${
        selected ? "bg-accent/[0.05] hover:bg-accent/[0.07]" : "hover:bg-surface-2"
      }${leaving ? " brief-leaving" : ""}`}
    >
      {isProcessing && <span aria-hidden className="queue-bar" />}

      {/* Full-row click target for filed rows. Absolutely positioned, so it
          covers the row without being a grid cell; interactive cells layer over
          it with `relative z-10`. */}
      {/* In-app pages go through the router (a plain <a> reloaded the whole
          app - the sidebar flickered and it felt slow); the tracker opens in a
          new tab. */}
      {asLink && href &&
        (hrefExternal ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`${title}, open in ${providerName}`}
            className="absolute inset-0"
          />
        ) : (
          <Link href={href} aria-label={title} className="absolute inset-0" />
        ))}

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
          className={`flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border transition-colors ${
            selected
              ? "border-accent bg-accent text-white"
              : "border-[rgba(26,22,18,0.22)] bg-surface text-transparent"
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
          // Filed → the row opens it here in the app; the tracker id (logo + id)
          // opens the ticket in Linear/Jira.
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {trackerHref ? (
              <a
                href={trackerHref}
                target="_blank"
                rel="noreferrer"
                title={`${b.ticket_identifier} - open in ${providerName}`}
                aria-label={`Open in ${providerName}`}
                className="relative z-10 inline-flex min-w-0 items-center gap-1.5 py-0.5 font-mono text-xs text-muted no-underline transition-colors hover:text-ink"
              >
                <TrackerLogo kind={b.provider ?? "linear"} size={12} />
                {shortId && <span className="truncate">{shortId}</span>}
              </a>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted">
                <TrackerLogo kind={b.provider ?? "linear"} size={12} />
                {shortId && <span className="truncate">{shortId}</span>}
              </span>
            )}
          </span>
        ) : isDraft || isProcessing ? (
          // No tracker id yet → its own Brief identity (brief-N), the way Linear
          // shows ENG-1. It opens the Brief page.
          briefHref ? (
            <Link
              href={briefHref}
              title="Open the Brief page"
              aria-label="Open the Brief page"
              className="relative z-10 inline-flex min-w-0 items-center gap-1.5 py-0.5 font-mono text-xs text-muted no-underline transition-colors hover:text-ink"
            >
              <BrandMark size={14} className="shrink-0 rounded-[3px]" />
              <span className="truncate">{b.seq ? `brief-${b.seq}` : "brief"}</span>
            </Link>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted">
              <BrandMark size={14} className="shrink-0 rounded-[3px]" />
              <span className="truncate">{b.seq ? `brief-${b.seq}` : "brief"}</span>
            </span>
          )
        ) : (
          <span aria-hidden />
        )}
      </div>

      {/* 3 · Title (+ inline error on failed rows) */}
      <div className={`min-w-0${dim}`}>
        <p className={`truncate text-[13.5px] leading-snug ${isFailed ? "text-[#c62828]" : "text-ink"}`}>
          {title}
        </p>
        {isFailed && b.error && <p className="mt-0.5 truncate text-xs text-muted">{b.error}</p>}
      </div>

      {/* 4 · Status (filing / didn't file / tracker state) */}
      <div className={`min-w-0${dim}`}>
        {isProcessing ? (
          <StatusBadge compact color="#dd6936">
            {writing ? "Writing" : "Filing"} <Elapsed since={b.updated_at || b.created_at} />
          </StatusBadge>
        ) : isFailed ? (
          <StatusBadge compact color="#c62828" title="Didn't file">
            Didn&apos;t file
          </StatusBadge>
        ) : isDraft ? (
          <StatusBadge compact color="#8a8378" title="Draft - not filed">
            Draft
          </StatusBadge>
        ) : (
          <StatusBadge
            compact
            color={ti?.stateColor || "#2e7d32"}
            title={ti?.deleted ? `Deleted in ${providerName}` : ti?.stateName || "Filed"}
          >
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
                className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-hairline"
              />
            ) : (
              <span
                title={ti.assignee.name}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cream-2 text-[10px] font-medium text-ink-2"
              >
                {initial(ti.assignee.name)}
              </span>
            )}
            <span className="truncate text-[13px] text-ink-2">{ti.assignee.name}</span>
          </>
        ) : (
          <span
            title="Unassigned"
            className="h-5 w-5 shrink-0 rounded-full border border-dashed border-[rgba(26,22,18,0.25)]"
          />
        )}
      </div>

      {/* 6 · Updated (hidden < sm) */}
      <span className={`hidden truncate text-xs tabular-nums text-muted sm:block${dim}`}>
        {relativeTime(b.created_at)}
      </span>

      {/* 7 · Row action - Archive is the only removal (acts like delete). Faint
          until hover; hidden while a batch selection is active (the floating
          bar handles that); the cell still holds its track. */}
      <div className="relative z-10 flex items-center justify-end gap-0.5">
        {!anySelected && (
          <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} />
        )}
      </div>
    </li>
  );
}
