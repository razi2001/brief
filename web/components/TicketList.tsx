import { TrackerLogo } from "./TrackerLogo";
import TicketIdText from "./TicketIdText";
import StatusBadge from "./StatusBadge";
import type { DashboardBrief } from "@/lib/brief-types";

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.round((Date.now() - then) / 1000);
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
 * A dense, Linear-like list of filed tickets: one row each - live status dot,
 * title, tracker logo + identifier, time, assignee avatar. Each row links to
 * the real ticket. Pure props; used on the Dashboard's "Recent tickets" panel.
 */
export default function TicketList({ briefs }: { briefs: DashboardBrief[] }) {
  if (briefs.length === 0) return null;

  return (
    <div className="card overflow-hidden p-0">
      {/* Column header - same .ticket-grid-ro tracks as the rows (and the same
          meta widths as the Tickets feed), so every column lines up. */}
      <div className="ticket-grid-ro border-b border-hairline px-4 py-2">
        <span className="text-xs font-medium text-muted">ID</span>
        <span className="text-xs font-medium text-muted">Title</span>
        <span className="text-xs font-medium text-muted">Status</span>
        <span className="hidden text-xs font-medium text-muted sm:block">Assignee</span>
        <span className="hidden text-xs font-medium text-muted sm:block">Updated</span>
      </div>
      <ul className="divide-y divide-hairline">
        {briefs.map((b) => {
          const ti = b.ticket;
          const isProcessing = b.status === "processing" || b.status === "uploaded";
          // A deleted ticket has nothing to open in the tracker - fall back to
          // its Brief page.
          const href = ti?.deleted
            ? b.share_id
              ? `/b/${b.share_id}`
              : undefined
            : ti?.url || b.ticket_url || undefined;
          const external = !!href && !href.startsWith("/");
          // While filing there's no tracker title yet - fall back to the brief's
          // name, then a generic label.
          const title =
            ti?.title || b.title || (isProcessing ? "Creating ticket…" : `${b.source_kind ?? "brief"} ticket`);
          const dot = isProcessing ? "#dd6936" : ti?.stateColor || "#2e7d32";
          const stateName = isProcessing ? "Creating…" : ti?.stateName || "Filed";
          const cells = (
            <>
              {/* 1 · Tracker id */}
              <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-muted">
                {!isProcessing && b.ticket_identifier ? (
                  <>
                    <TrackerLogo kind={b.provider ?? "linear"} size={12} />
                    <TicketIdText identifier={b.ticket_identifier} provider={b.provider} />
                  </>
                ) : (
                  <span aria-hidden />
                )}
              </span>
              {/* 2 · Title */}
              <span className="min-w-0 truncate text-[13.5px] text-ink">{title}</span>
              {/* 3 · Status */}
              <div className="min-w-0">
                <StatusBadge color={dot} title={stateName}>
                  {stateName}
                </StatusBadge>
              </div>
              {/* 4 · Assignee - avatar + name (hidden < sm) */}
              <span className="hidden min-w-0 items-center gap-2 sm:flex">
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
              </span>
              {/* 5 · Updated (hidden < sm) */}
              <span className="hidden truncate text-xs tabular-nums text-muted sm:block">
                {relativeTime(b.created_at)}
              </span>
            </>
          );
          return (
            <li key={b.id}>
              {href ? (
                <a
                  href={href}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
                  className="ticket-grid-ro min-h-[42px] px-4 py-2 no-underline transition-colors hover:bg-surface-2"
                >
                  {cells}
                </a>
              ) : (
                <div className="ticket-grid-ro min-h-[42px] px-4 py-2 transition-colors hover:bg-surface-2">{cells}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
