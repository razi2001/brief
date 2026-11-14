"use client";

import Link from "next/link";
import RetryButton from "./RetryButton";
import { explainFilingError } from "@/lib/filing-errors";
import ArchiveButton from "./ArchiveButton";
import StatusBadge, { type StatusKind } from "./StatusBadge";
import { TrackerLogo } from "./TrackerLogo";
import { displayIdentifier } from "@/lib/ticket-sync";
import TicketIdText from "./TicketIdText";
import { PROVIDER_LABELS } from "./provider-labels";
import Elapsed from "./Elapsed";
import type { DashboardBrief } from "@/lib/brief-types";
import { TAG_COLORS, type Tag } from "@/lib/tags";
import { groupOfState } from "@/lib/status-group";

const NO_TAGS: Tag[] = [];
/** Tag labels a row shows before the rest fold into "+n". */
const MAX_TAG_LABELS = 2;

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

/**
 * What a brief is, read once for every place that shows one (a row, the latest
 * ticket's card, a card that needs you): its title, where a click goes, and
 * where it stands.
 */
export function briefFacts(b: DashboardBrief) {
  const ti = b.ticket ?? null;
  const isFiled = b.status === "filed";
  const isFailed = b.status === "failed";
  const isDraft = b.status === "drafted";
  const isProcessing = b.status === "processing" || b.status === "uploaded";

  // The brief opens inside the app: drafts under Drafts, the rest under Tickets.
  const writing = isProcessing && !!b.draft;
  const briefHref = b.share_id ? `/${isDraft || writing ? "drafts" : "tickets"}/${b.share_id}` : undefined;
  // A ticket the tracker no longer has: nothing to open there, so a click
  // falls back to the Brief page.
  const trackerHref = ti?.deleted ? undefined : ti?.url || b.ticket_url || undefined;
  // A filed ticket opens where it lives now - Linear, Jira, GitHub - in a new
  // tab. Everything else (drafts, filing, didn't file, a ticket the tracker
  // deleted) opens inside the app.
  const href = (isFiled && trackerHref) || briefHref;
  const hrefExternal = !!href && href !== briefHref;
  const providerName = PROVIDER_LABELS[b.provider ?? "linear"] ?? "Linear";

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

  // The mark: Brief's own states first, then the tracker's.
  const mark: { kind: StatusKind; color: string; name: string; tip?: string } = isProcessing
    ? { kind: "working", color: "#dd6936", name: writing ? "Writing" : "Filing" }
    : isFailed
      ? { kind: "failed", color: "#d14343", name: "Didn't file", tip: "Didn't file" }
      : isDraft
        ? { kind: "draft", color: "#8a8378", name: "Draft", tip: "Draft, not filed" }
        : {
            kind: ti?.deleted ? "closed" : groupOfState(ti?.stateName || "Done"),
            color: ti?.stateColor || "#2e7d32",
            name: ti?.stateName || "Filed",
            tip: ti?.deleted ? `Deleted in ${providerName}` : ti?.stateName || "Filed",
          };

  return { ti, isFiled, isFailed, isDraft, isProcessing, writing, briefHref, trackerHref, href, hrefExternal, providerName, title, mark };
}

function initial(name?: string): string {
  const n = (name ?? "").trim();
  return n ? n[0].toUpperCase() : "?";
}

/**
 * One line of the Tickets list: a status mark, the title, and on the right the
 * little that helps find it again (its id in the tracker, who has it, how old).
 * The mark says where the ticket stands (its name is in the tooltip), so the
 * row needs no status column. Brief's own states are the only ones written
 * out, because they are the ones that need you: a draft, one being filed, one
 * that didn't file (with its reason and a Retry).
 *
 * The whole row is the link (an absolute overlay); the checkbox, the id, a
 * tag's remove button, Retry and Archive sit above it, so using them never
 * opens the ticket. The checkbox and Archive show on hover.
 */
export default function BriefListRow({
  brief: b,
  onArchive,
  onArchiveFailed,
  leaving = false,
  selected = false,
  anySelected = false,
  onToggleSelect,
  tags = NO_TAGS,
  onRemoveTag,
}: {
  /** The tags it carries, shown as small labels after the title. */
  tags?: Tag[];
  /** Take one of its tags off. Without it the labels are read-only. */
  onRemoveTag?: (tagId: string) => void;
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
  const f = briefFacts(b);
  const { ti, isFailed, isDraft, isProcessing, writing, trackerHref, href, hrefExternal, providerName, title } = f;
  // Empty for trackers with no readable key (Notion, Asana), whose raw page id
  // or task gid stays out of the tooltip too.
  const shownId = displayIdentifier(b.ticket_identifier, b.provider);

  const boxVisible = selected || anySelected;
  const dim = b.archived ? " opacity-55" : "";
  const idClass = "inline-flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted";

  return (
    <li
      data-selected={selected ? "" : undefined}
      className={`list-row group overflow-hidden sm:pl-0 sm:pr-9 ${selected ? "bg-[var(--color-accent-soft)]" : ""}${leaving ? " brief-leaving" : ""}`}
    >
      {isProcessing && <span aria-hidden className="queue-bar" />}

      {/* The row is the link. In-app pages go through the router; the tracker
          opens in a new tab. */}
      {href &&
        (hrefExternal ? (
          <a href={href} target="_blank" rel="noreferrer" aria-label={`${title}, open in ${providerName}`} className="absolute inset-0" />
        ) : (
          <Link href={href} aria-label={title} className="absolute inset-0" />
        ))}

      {/* Checkbox, in the page's gutter: there on hover, and while selecting */}
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
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center transition-opacity duration-150 max-sm:hidden ${
          boxVisible ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        <span
          className={`flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border transition-colors ${
            selected ? "border-accent bg-accent text-white" : "border-[rgba(26,22,18,0.25)] bg-surface text-transparent"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 6" />
          </svg>
        </span>
      </button>

      {/* Where it stands: the mark, its name in the tooltip */}
      <span className={`flex shrink-0${dim}`}>
        <StatusBadge iconOnly kind={f.mark.kind} color={f.mark.color} title={f.mark.tip}>
          {f.mark.name}
        </StatusBadge>
      </span>

      {/* Title, its tags, and why it didn't file */}
      <div className={`min-w-0 flex-1${dim}`}>
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-[13.5px] leading-snug text-ink">{title}</p>
          {tags.length > 0 && (
            <span className="flex shrink-0 items-center gap-1 max-sm:hidden">
              {tags.slice(0, MAX_TAG_LABELS).map((t) => (
                <span
                  key={t.id}
                  className="group/t relative z-10 inline-flex max-w-[112px] items-center gap-1 rounded-full py-[1px] pl-1.5 pr-2 text-[11.5px] leading-[1.5] text-ink-2"
                  style={{ backgroundColor: `${TAG_COLORS[t.color]}24` }}
                  title={t.name}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TAG_COLORS[t.color] }} aria-hidden />
                  <span className="truncate">{t.name}</span>
                  {onRemoveTag && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveTag(t.id);
                      }}
                      title={`Remove ${t.name}`}
                      aria-label={`Remove ${t.name}`}
                      className="-mr-1 hidden h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-[rgba(26,22,18,0.1)] hover:text-ink focus-visible:flex group-hover/t:flex"
                    >
                      <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  )}
                </span>
              ))}
              {tags.length > MAX_TAG_LABELS && (
                <span className="text-[11.5px] tabular-nums text-muted" title={tags.slice(MAX_TAG_LABELS).map((t) => t.name).join(", ")}>
                  +{tags.length - MAX_TAG_LABELS}
                </span>
              )}
            </span>
          )}
        </div>
        {isFailed && b.error && (
          <p className="mt-0.5 truncate text-xs text-[#b3402f]" title={explainFilingError(b.error)}>
            {explainFilingError(b.error)}
          </p>
        )}
      </div>

      {/* Brief's own state, in words: only what needs you */}
      {isProcessing ? (
        <span className={`shrink-0 text-xs tabular-nums text-accent${dim}`}>
          {writing ? "Writing" : "Filing"} <Elapsed since={b.updated_at || b.created_at} />
        </span>
      ) : isFailed && !b.archived ? (
        <span className="relative z-10 shrink-0">
          <RetryButton briefId={b.id} />
        </span>
      ) : isDraft ? (
        <span className={`shrink-0 text-xs text-muted${dim}`}>Draft</span>
      ) : null}

      {/* Its id in the tracker, which opens it there */}
      {!isFailed && b.ticket_identifier && (
        <span className={`hidden shrink-0 sm:flex${dim}`}>
          {trackerHref ? (
            <a
              href={trackerHref}
              target="_blank"
              rel="noreferrer"
              title={shownId ? `${shownId} - open in ${providerName}` : `Open in ${providerName}`}
              aria-label={`Open in ${providerName}`}
              className={`${idClass} relative z-10 py-0.5 no-underline transition-colors hover:text-ink`}
            >
              <TrackerLogo kind={b.provider ?? "linear"} size={12} />
              <TicketIdText identifier={b.ticket_identifier} provider={b.provider} />
            </a>
          ) : (
            <span className={idClass}>
              <TrackerLogo kind={b.provider ?? "linear"} size={12} />
              <TicketIdText identifier={b.ticket_identifier} provider={b.provider} />
            </span>
          )}
        </span>
      )}

      {/* Who has it: the face only, the name in the tooltip */}
      <span className={`hidden w-5 shrink-0 sm:block${dim}`}>
        {ti?.assignee &&
          (ti.assignee.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ti.assignee.avatarUrl} alt="" title={ti.assignee.name} className="h-5 w-5 rounded-full object-cover ring-1 ring-hairline" />
          ) : (
            <span title={ti.assignee.name} className="flex h-5 w-5 items-center justify-center rounded-full bg-cream-2 text-[10px] font-medium text-ink-2">
              {initial(ti.assignee.name)}
            </span>
          ))}
      </span>

      {/* How old, and Archive in its place on hover (the bulk bar does it while selecting) */}
      <span className="relative flex h-7 w-9 shrink-0 items-center justify-end">
        <span className={`text-xs tabular-nums text-faint transition-opacity duration-150 ${anySelected ? "" : "sm:group-hover:opacity-0"}${dim}`}>
          {relativeTime(b.created_at)}
        </span>
        {!anySelected && (
          <span className="absolute inset-y-0 right-0 z-10 flex items-center max-sm:hidden">
            <ArchiveButton briefId={b.id} onArchive={onArchive} onArchiveFailed={onArchiveFailed} />
          </span>
        )}
      </span>
    </li>
  );
}
