import StatusPill from "./StatusPill";
import RetryButton from "./RetryButton";

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

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type Brief = {
  id: string;
  status: string;
  source_kind?: string | null;
  created_at?: string | null;
  ticket_url?: string | null;
  ticket_identifier?: string | null;
  error?: string | null;
};

/**
 * One row in the recent-briefs list: status pill + source label + relative
 * time, with the filed ticket link or truncated error underneath.
 */
export default function BriefRow({ brief: b }: { brief: Brief }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <StatusPill status={b.status} />
          <span className="text-xs lowercase tracking-wide text-muted">
            {b.source_kind ?? "—"}
          </span>
        </div>
        <span className="text-xs text-muted">{relativeTime(b.created_at)}</span>
      </div>
      <div className="mt-2 text-sm text-ink-2">
        {b.status === "filed" && b.ticket_url ? (
          <a
            href={b.ticket_url}
            target="_blank"
            rel="noreferrer"
            className="text-accent no-underline hover:underline"
          >
            {b.ticket_identifier ?? "view ticket"} →
          </a>
        ) : b.status === "failed" ? (
          <span className="flex items-center justify-between gap-3">
            {b.error ? (
              <span className="text-[#c62828]">{truncate(b.error)}</span>
            ) : (
              <span className="text-[#c62828]">failed</span>
            )}
            <RetryButton briefId={b.id} />
          </span>
        ) : b.status === "processing" ? (
          <span className="text-muted">writing the ticket…</span>
        ) : (
          <span className="text-muted">queued</span>
        )}
      </div>
    </div>
  );
}
