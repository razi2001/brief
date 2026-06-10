"use client";

import StatusPill from "./StatusPill";
import RetryButton from "./RetryButton";
import SourceIcon from "./SourceIcon";
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

function Assignee({ a }: { a: NonNullable<LinearIssueInfo["assignee"]> }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
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
      <span className="hidden sm:inline">{a.name}</span>
    </span>
  );
}

/**
 * A rich brief row. When a filed brief is synced to Linear we lead with the
 * live state-color dot + Linear title + workflow state; otherwise we fall back
 * to the brief's own status pill and source description. Processing rows
 * shimmer; failed rows get a red treatment + retry + truncated error.
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

  return (
    <div
      className={`card lift animate-rise relative overflow-hidden px-4 py-3.5 ${
        isFailed ? "border-[rgba(198,40,40,.3)]" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      {isProcessing && (
        <span
          aria-hidden="true"
          className="shimmer pointer-events-none absolute inset-0"
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {synced ? (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.625rem] uppercase tracking-[0.04em]"
              style={{
                color: li!.stateColor,
                borderColor: li!.stateColor + "59",
                backgroundColor: li!.stateColor + "1a",
              }}
              title={li!.stateName}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: li!.stateColor }}
              />
              {li!.stateName}
            </span>
          ) : (
            <StatusPill status={b.status} />
          )}

          <span className="flex items-center gap-1.5 text-xs lowercase tracking-wide text-muted">
            <SourceIcon kind={b.source_kind} className="opacity-70" />
            {b.source_kind ?? "brief"}
          </span>
        </div>

        <span className="shrink-0 text-xs text-muted" title={b.created_at ?? ""}>
          {relativeTime(b.created_at)}
        </span>
      </div>

      <div className="relative mt-2 flex items-start justify-between gap-3">
        <p
          className={`min-w-0 flex-1 text-sm leading-snug ${
            isFailed ? "text-[#c62828]" : "text-ink"
          }`}
        >
          {title}
        </p>
        {li?.assignee && <Assignee a={li.assignee} />}
      </div>

      <div className="relative mt-2 flex items-center justify-between gap-3 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-muted">
          {identifier && href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent no-underline hover:underline"
            >
              {identifier} →
            </a>
          ) : identifier ? (
            <span className="font-mono">{identifier}</span>
          ) : null}
          {li?.createdAt && (
            <>
              {identifier && <span className="text-hairline">·</span>}
              <span title={li.createdAt}>filed {shortDate(li.createdAt)}</span>
            </>
          )}
        </div>

        {isFailed && (
          <div className="flex shrink-0 items-center">
            <RetryButton briefId={b.id} />
          </div>
        )}
      </div>

      {isFailed && b.error && (
        <p className="relative mt-2 border-t hairline pt-2 text-xs text-[#c62828]/80">
          {truncate(b.error)}
        </p>
      )}
    </div>
  );
}
