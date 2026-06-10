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

function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
 * A rich brief TILE for the dynamic card grid. Filed tiles become a whole-card
 * link to the ticket (opens in a new tab) with an explicit "Open in Linear/Jira
 * →" pill pinned bottom-right and the tracker logomark next to the identifier —
 * so the tile is obviously interactive. Processing tiles pulse + shimmer; failed
 * tiles are NOT links and get a red accent + a quiet ghost Retry. Titles render
 * in Instrument Serif (clamped to two lines); mono is reserved for
 * status/source/meta/identifiers.
 *
 * The tile is a `flex flex-col`; the meta/action row uses `mt-auto` so it sits
 * at the bottom and tiles in a row stay visually even.
 */
export default function BriefCard({
  brief: b,
  index = 0,
}: {
  brief: DashboardBrief;
  index?: number;
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
        : "Brief");

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

  const className = `card brief-card animate-rise relative flex h-full flex-col overflow-hidden px-[18px] py-[18px] ${
    asLink ? "brief-card-link" : ""
  } ${
    asLink
      ? "ring-1 ring-[rgba(221,105,54,.18)]"
      : isFailed
        ? "border-l-2 border-l-[rgba(198,40,40,.55)]"
        : ""
  }`;
  const style = { animationDelay: `${Math.min(index, 12) * 45}ms` };

  const inner = (
    <>
      {isProcessing && (
        <span
          aria-hidden="true"
          className="shimmer pointer-events-none absolute inset-0"
        />
      )}

      {/* Top row: status badge · source · relative time */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StatusBadge color={badge.color} label={badge.label} pulse={badge.pulse} />
          <span className="flex items-center gap-1.5 text-xs lowercase tracking-wide text-muted">
            <SourceIcon kind={b.source_kind} className="opacity-70" />
            {b.source_kind ?? "brief"}
          </span>
        </div>

        <span className="shrink-0 text-xs text-muted" title={b.created_at ?? ""}>
          {relativeTime(b.created_at)}
        </span>
      </div>

      {/* Title — Instrument Serif, clamped to two lines */}
      <div className="relative mt-3 flex items-start justify-between gap-3">
        <p
          className={`line-clamp-2 min-w-0 flex-1 font-display text-[19px] leading-snug ${
            isFailed ? "text-[#c62828]" : "text-ink"
          }`}
        >
          {title}
        </p>
        {ti?.assignee && <Assignee a={ti.assignee} />}
      </div>

      {/* Failed error — clamped, sits between title and the pinned bottom row */}
      {isFailed && b.error && (
        <p className="relative mt-2.5 line-clamp-2 text-xs text-muted">
          {truncate(b.error)}
        </p>
      )}

      {/* Bottom row, pinned to the tile bottom: identifier (+ logo) + filed
          date on the left · open / retry on the right. */}
      <div className="relative mt-auto flex items-center justify-between gap-3 pt-3.5 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted">
          {identifier ? (
            <span className="inline-flex items-center gap-1.5">
              {asLink && <TrackerLogo kind={tracker.kind} size={14} />}
              <span className={`font-mono ${asLink ? "text-ink-2" : ""}`}>
                {identifier}
              </span>
            </span>
          ) : null}
          {ti?.createdAt && (
            <>
              {identifier && <span className="text-hairline">·</span>}
              <span title={ti.createdAt}>filed {shortDate(ti.createdAt)}</span>
            </>
          )}
        </div>

        {asLink ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(221,105,54,.3)] bg-[rgba(221,105,54,.08)] px-2.5 py-1 font-mono text-[0.6875rem] tracking-wide text-accent">
            <TrackerLogo kind={tracker.kind} size={13} />
            Open in {tracker.name}
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
      <ArchiveButton briefId={b.id} />
    </div>
  );

  if (asLink) {
    return (
      <div className="group relative h-full">
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
    <div className="group relative h-full">
      <div className={className} style={style}>
        {inner}
      </div>
      {archiveControl}
    </div>
  );
}
