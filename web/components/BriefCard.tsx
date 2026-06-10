"use client";

import RetryButton from "./RetryButton";
import ArchiveButton from "./ArchiveButton";
import SourceIcon from "./SourceIcon";
import { TrackerLogo } from "./TrackerLogo";
import type { LinearIssueInfo } from "@/lib/linear";

export type DashboardBrief = {
  id: string;
  status: string;
  source_kind?: string | null;
  created_at?: string | null;
  ticket_url?: string | null;
  ticket_identifier?: string | null;
  error?: string | null;
  /** Live Linear info, merged server-side when the ticket is synced. */
  linear?: LinearIssueInfo | null;
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

function Assignee({ a }: { a: NonNullable<LinearIssueInfo["assignee"]> }) {
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
 * A rich brief row. Filed briefs become a whole-card link to the ticket (opens
 * in a new tab) with an explicit "Open in Linear/Jira →" pill bottom-right and
 * the tracker logomark next to the identifier — so the card is obviously
 * interactive. Processing rows pulse + shimmer; failed rows are NOT links and
 * get a thin red left accent + a quiet ghost Retry. Titles render in Instrument
 * Serif; mono is reserved for status/source/meta/identifiers.
 */
export default function BriefCard({
  brief: b,
  index = 0,
}: {
  brief: DashboardBrief;
  index?: number;
}) {
  const li = b.linear ?? null;
  const isFiled = b.status === "filed";
  const isFailed = b.status === "failed";
  const isProcessing = b.status === "processing" || b.status === "uploaded";
  const synced = isFiled && !!li;

  const title =
    li?.title ||
    (isFailed
      ? "Couldn't file this one"
      : isProcessing
        ? "Writing the ticket…"
        : "Brief");

  const href = li?.url || b.ticket_url || undefined;
  const identifier = b.ticket_identifier || li?.identifier;
  const tracker = trackerOf(href);

  // The whole card is a link only when it's filed AND we have a destination.
  const asLink = isFiled && !!href;

  // Status badge inputs.
  const badge = synced
    ? { color: li!.stateColor, label: li!.stateName, pulse: false }
    : isFailed
      ? { color: "#c62828", label: "couldn't file", pulse: false }
      : isProcessing
        ? { color: "#dd6936", label: "in progress", pulse: true }
        : { color: "#8a8378", label: b.status, pulse: false };

  const className = `card brief-card animate-rise relative overflow-hidden px-[18px] py-[18px] ${
    asLink ? "brief-card-link block" : ""
  } ${isFailed ? "border-l-2 border-l-[rgba(198,40,40,.55)]" : ""}`;
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

      {/* Title — Instrument Serif */}
      <div className="relative mt-2.5 flex items-start justify-between gap-3">
        <p
          className={`min-w-0 flex-1 font-display text-[18px] leading-snug ${
            isFailed ? "text-[#c62828]" : "text-ink"
          }`}
        >
          {title}
        </p>
        {li?.assignee && <Assignee a={li.assignee} />}
      </div>

      {/* Bottom row: identifier (+ tracker logo) + filed date · open / retry */}
      <div className="relative mt-3 flex items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted">
          {identifier ? (
            <span className="inline-flex items-center gap-1.5">
              {asLink && <TrackerLogo kind={tracker.kind} size={14} />}
              <span className={`font-mono ${asLink ? "text-ink-2" : ""}`}>
                {identifier}
              </span>
            </span>
          ) : null}
          {li?.createdAt && (
            <>
              {identifier && <span className="text-hairline">·</span>}
              <span title={li.createdAt}>filed {shortDate(li.createdAt)}</span>
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

      {isFailed && b.error && (
        <p className="relative mt-2.5 border-t hairline pt-2.5 text-xs text-muted">
          {truncate(b.error)}
        </p>
      )}
    </>
  );

  // The archive control is always rendered as a SIBLING of the card element
  // (never a descendant of the <a>), absolutely positioned in the top-right.
  // Filed cards render the whole card as an <a>; nesting an interactive button
  // inside an anchor is invalid HTML and would also let the card link swallow
  // the click. Keeping it a sibling avoids both problems. It's faint by default
  // and lifts on hover/focus-within of the group.
  const archiveControl = (
    <div className="absolute right-2 top-2 z-10 rounded-full bg-cream/85 px-1.5 py-0.5 opacity-0 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      <ArchiveButton briefId={b.id} />
    </div>
  );

  if (asLink) {
    return (
      <div className="group relative">
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
    <div className="group relative">
      <div className={className} style={style}>
        {inner}
      </div>
      {archiveControl}
    </div>
  );
}
