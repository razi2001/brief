import { TrackerLogo } from "./TrackerLogo";
import type { DashboardBrief } from "@/lib/brief-types";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
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
 * A dense, Linear-like list of filed tickets: one row each — live status dot,
 * title, tracker logo + identifier, time, assignee avatar. Each row links to
 * the real ticket. Pure props; used on the Dashboard's "Recent tickets" panel.
 */
export default function TicketList({ briefs }: { briefs: DashboardBrief[] }) {
  if (briefs.length === 0) return null;

  return (
    <div className="card overflow-hidden p-0">
      <ul className="divide-y divide-hairline">
        {briefs.map((b) => {
          const ti = b.ticket;
          const isProcessing = b.status === "processing" || b.status === "uploaded";
          const href = ti?.url || b.ticket_url || undefined;
          // While filing there's no tracker title yet — fall back to the brief's
          // name, then a generic label.
          const title =
            ti?.title || b.title || (isProcessing ? "Creating ticket…" : `${b.source_kind ?? "brief"} ticket`);
          const dot = isProcessing ? "#dd6936" : ti?.stateColor || "#2e7d32";
          const stateName = isProcessing ? "Creating…" : ti?.stateName || "Filed";
          const Row = (
            <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-cream-2/40">
              {/* Title — smaller, capped so it crops before the status column. */}
              <span className="min-w-0 max-w-[60%] flex-1 truncate text-[0.8125rem] text-ink">
                {title}
              </span>

              {/* Right meta (matches the Tickets feed) */}
              <div className="ml-auto flex shrink-0 items-center gap-3">
                {/* Status column */}
                <span
                  className="w-[5.5rem] truncate text-right font-mono text-[0.625rem]"
                  style={{ color: dot }}
                  title={stateName}
                >
                  {isProcessing ? "creating…" : stateName}
                </span>
                {!isProcessing && b.ticket_identifier && (
                  <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] text-accent sm:inline-flex">
                    <TrackerLogo kind={b.provider ?? "linear"} size={13} />
                    {b.ticket_identifier}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[0.625rem] text-muted">
                  {relativeTime(b.created_at)}
                </span>
                {ti?.assignee &&
                  (ti.assignee.avatarUrl ? (
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
                  ))}
              </div>
            </div>
          );
          return (
            <li key={b.id}>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" className="block no-underline">
                  {Row}
                </a>
              ) : (
                Row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
