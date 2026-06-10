"use client";

import RetryButton from "./RetryButton";
import ArchiveButton from "./ArchiveButton";
import SourceIcon from "./SourceIcon";
import { TrackerLogo } from "./TrackerLogo";

/** Provider-agnostic live ticket info, merged server-side when synced. Covers
 *  both Linear (which can also carry an assignee) and Jira. */
export type TicketInfo = {
  title: string;
  url: string;
  stateName: string;
  stateColor: string;
  createdAt: string;
  assignee?: { name: string; avatarUrl?: string };
};

export type DashboardBrief = {
  id: string;
  status: string;
  source_kind?: string | null;
  created_at?: string | null;
  ticket_url?: string | null;
  ticket_identifier?: string | null;
  error?: string | null;
  /** Which tracker this brief was filed to (inferred from ticket_url). */
  provider?: "linear" | "jira";
  /** Live ticket info (Linear or Jira), merged server-side when synced. */
  ticket?: TicketInfo | null;
};

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function initial(name?: string): string {
  const n = (name ?? "").trim();
  return n ? n[0].toUpperCase() : "?";
}

/** Infer the tracker from a ticket URL. Defaults to Linear. */
function trackerOf(url?: string): { kind: "linear" | "jira"; name: string } {
  const u = (url ?? "").toLowerCase();
  if (u.includes("atlassian") || u.includes("jira"))
    return { kind: "jira", name: "Jira" };
  return { kind: "linear", name: "Linear" };
}

/** Resolve the provider for a brief: prefer the server-inferred field, else
 *  fall back to parsing the ticket URL. */
function providerOf(b: DashboardBrief): { kind: "linear" | "jira"; name: string } {
  if (b.provider === "jira") return { kind: "jira", name: "Jira" };
  if (b.provider === "linear") return { kind: "linear", name: "Linear" };
  return trackerOf(b.ticket_url ?? b.ticket?.url);
}

function Assignee({ a }: { a: NonNullable<TicketInfo["assignee"]> }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted"
      title={a.name}
    >
      {a.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.avatarUrl}
          alt=""
          className="h-5 w-5 rounded-full border border-hairline object-cover"
        />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-cream-2 text-[0.625rem] text-ink-2">
          {initial(a.name)}
        </span>
      )}
    </span>
  );
}

/** Soft status dot + small mono label. Used for both Linear states and the
 *  synthetic processing/failed states. */
function StatusBadge({
  color,
  label,
  pulse = false,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={label}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        <span
          className={`inline-block h-2 w-2 rounded-full ${pulse ? "dot-pulse" : ""}`}
          style={{ backgroundColor: color }}
        />
      </span>
      <span className="font-mono text-[0.6875rem] tracking-wide text-ink-2">
        {label}
      </span>
    </span>
  );
}

/**
 * A clean, professional brief card for the 2-column feed grid. Structure is
 * top→bottom: a single muted meta line (status chip · source · relative time),
 * a serif title clamped to two lines, then a footer pinned to the bottom with
 * the tracker logo + identifier on the left and a subtle "Open →" affordance on
 * the right. Filed cards are a whole-card link to the ticket; failed cards are a
 * plain div with a quiet ghost Retry in the footer.
 *
 * The footer is pure flex (`justify-between`, no absolute positioning); the
 * identifier gets `min-w-0` + `truncate` so it can never collide with the
 * affordance. Archive is an absolutely-positioned SIBLING of the card element,
 * never a descendant of the <a>, so it stays valid HTML and captures its own
 * click. The card is `flex h-full flex-col` with a min-height so a row stays
 * even. Processing cards pulse + shimmer; entrance is a staggered rise.
 */
export default function BriefCard({
  brief: b,
  index = 0,
  onArchive,
  leaving = false,
}: {
  brief: DashboardBrief;
  index?: number;
  onArchive?: (id: string) => void;
  /** When true the card plays its exit animation (fade + scale + lift) just
   *  before the parent removes it from the list. */
  leaving?: boolean;
}) {
  const ti = b.ticket ?? null;
  const isFiled = b.status === "filed";
  const isFailed = b.status === "failed";
  const isProcessing = b.status === "processing" || b.status === "uploaded";
  const synced = isFiled && !!ti;

  const title =
    ti?.title ||
    (isFailed
      ? "Couldn't file this one"
      : isProcessing
        ? "Writing the ticket…"
        : b.source_kind
          ? `${b.source_kind} brief`
          : "Untitled brief");

  const href = ti?.url || b.ticket_url || undefined;
  const identifier = b.ticket_identifier ?? undefined;
  const tracker = providerOf(b);

  // The whole tile is a link only when it's filed AND we have a destination.
  const asLink = isFiled && !!href;

  // Status badge inputs.
  const badge = synced
    ? { color: ti!.stateColor || "#8a8378", label: ti!.stateName || "filed", pulse: false }
    : isFailed
      ? { color: "#c62828", label: "couldn't file", pulse: false }
      : isProcessing
        ? { color: "#dd6936", label: "in progress", pulse: true }
        : { color: "#8a8378", label: b.status, pulse: false };

  const className = `card brief-card animate-rise relative flex h-full min-h-[160px] flex-col overflow-hidden p-5 ${
    asLink ? "brief-card-link" : ""
  } ${
    asLink
      ? "ring-1 ring-[rgba(221,105,54,.18)]"
      : isFailed
        ? "border-l-2 border-l-[rgba(198,40,40,.55)]"
        : ""
  }`;
  const style = { animationDelay: `${Math.min(index, 12) * 45}ms` };

  // Outer wrapper class — the exit animation lives here so the whole tile
  // (card + archive control) fades/scales/lifts out together.
  const wrapperClass = `group relative h-full${leaving ? " brief-leaving" : ""}`;

  const inner = (
    <>
      {isProcessing && (
        <span
          aria-hidden="true"
          className="shimmer pointer-events-none absolute inset-0"
        />
      )}

      {/* Meta row: status chip (left) · source + relative time (right).
          One tidy line, no wrapping. */}
      <div className="relative flex items-center justify-between gap-2 pr-6">
        <StatusBadge color={badge.color} label={badge.label} pulse={badge.pulse} />
        <span className="flex min-w-0 shrink items-center gap-1.5 truncate font-mono text-[0.6875rem] tracking-wide text-muted">
          <SourceIcon kind={b.source_kind} size={12} className="shrink-0 opacity-70" />
          <span className="truncate lowercase">{b.source_kind ?? "brief"}</span>
          {b.created_at && (
            <>
              <span className="text-hairline">·</span>
              <span className="shrink-0" title={b.created_at}>
                {relativeTime(b.created_at)}
              </span>
            </>
          )}
        </span>
      </div>

      {/* Title — Instrument Serif, clamped to two lines */}
      <div className="relative mt-3 flex items-start justify-between gap-3">
        <p
          className={`line-clamp-2 min-w-0 flex-1 font-display text-[18px] leading-snug ${
            isFailed ? "text-[#c62828]" : "text-ink"
          }`}
        >
          {title}
        </p>
        {ti?.assignee && <Assignee a={ti.assignee} />}
      </div>

      {/* Failed error — clamped, sits between title and the pinned footer */}
      {isFailed && b.error && (
        <p className="relative mt-2.5 line-clamp-2 text-xs text-muted">
          {truncate(b.error)}
        </p>
      )}

      {/* Footer, pinned to the bottom. Pure flex, no absolute positioning:
          tracker logo + identifier on the left (min-w-0 + truncate so it can
          never collide), a subtle "Open →" / ghost Retry on the right. */}
      <div className="relative mt-auto flex items-center justify-between gap-3 pt-4 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          {identifier ? (
            <>
              <TrackerLogo kind={tracker.kind} size={16} />
              <span className="min-w-0 truncate font-mono text-accent">
                {identifier}
              </span>
            </>
          ) : (
            !isFailed && (
              <span className="truncate font-mono text-[0.6875rem] tracking-wide text-muted">
                {badge.label}
              </span>
            )
          )}
        </div>

        {asLink ? (
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.75rem] tracking-wide text-accent">
            Open
            <span className="open-arrow inline-block">→</span>
          </span>
        ) : (
          isFailed && (
            <div className="flex shrink-0 items-center">
              <RetryButton briefId={b.id} />
            </div>
          )
        )}
      </div>
    </>
  );

  // The archive control is always rendered as a SIBLING of the card element
  // (never a descendant of the <a>), absolutely positioned in the top-right.
  // Filed tiles render the whole tile as an <a>; nesting an interactive button
  // inside an anchor is invalid HTML and would also let the tile link swallow
  // the click. Keeping it a sibling avoids both problems. It's faint by default
  // and lifts on hover/focus-within of the group.
  const archiveControl = (
    <div className="absolute right-2 top-2 z-10 rounded-full bg-cream/85 px-1.5 py-0.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      <ArchiveButton briefId={b.id} onArchive={onArchive} />
    </div>
  );

  if (asLink) {
    return (
      <div className={wrapperClass}>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={className}
          style={style}
          aria-label={`Open ${identifier ?? "ticket"} in ${tracker.name}`}
        >
          {inner}
        </a>
        {archiveControl}
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <div className={className} style={style}>
        {inner}
      </div>
      {archiveControl}
    </div>
  );
}
