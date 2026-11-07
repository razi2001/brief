import Link from "next/link";
import Avatar from "./Avatar";
import { FunnelPills } from "./ActivityView";
import { ago, sourceLine, type PersonFacts, type TimelineItem } from "@/lib/activity";

// The server renders in UTC on Fly; the owner reads Paris time.
const TZ = "Europe/Paris";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ActivityTimeline({
  person: p,
  items,
  now,
  card,
}: {
  person: PersonFacts;
  items: TimelineItem[];
  now: number;
  /** The owner's "Show the bug card" control. */
  card?: React.ReactNode;
}) {
  const src = sourceLine(p.signup);
  return (
    <section>
      <Link href="/admin/activity" className="text-[13px] text-muted hover:text-ink">
        ← Activity
      </Link>
      <header className="mt-3 flex items-center gap-3">
        <Avatar name={p.name || p.email || "?"} imageUrl={p.image ?? undefined} size={36} />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">
            {p.name || p.email}
          </h1>
          {p.name && <p className="truncate text-[13px] text-muted">{p.email}</p>}
        </div>
      </header>
      <dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted">Signed up</dt>
        <dd className="text-ink-2">
          {when(p.createdAt)} ({ago(p.createdAt, now)})
        </dd>
        {src && (
          <>
            <dt className="text-muted">Came from</dt>
            <dd className="text-ink-2">{src}</dd>
          </>
        )}
        <dt className="text-muted">About</dt>
        <dd className="text-ink-2">{[p.role, p.source && `heard from ${p.source}`].filter(Boolean).join(", ") || "—"}</dd>
        <dt className="text-muted">Setup</dt>
        <dd>
          <FunnelPills p={p} />
        </dd>
        <dt className="text-muted">Last seen</dt>
        <dd className="text-ink-2">{p.lastSeen ? `${when(p.lastSeen)} (${ago(p.lastSeen, now)})` : "—"}</dd>
      </dl>
      {card && <div className="mt-4">{card}</div>}

      <div className="card mt-6 overflow-hidden p-0">
        <ol className="divide-y divide-hairline">
          {items.map((it, i) => (
            <li key={`${it.at}-${i}`} className="flex gap-4 px-4 py-2 text-[13px]">
              <time dateTime={it.at} className="w-[120px] shrink-0 tabular-nums text-muted">
                {when(it.at)}
              </time>
              <span className={it.bad ? "text-[#c62828]" : "text-ink"}>
                {it.text}
                {it.count && it.count > 1 ? <span className="text-muted"> ×{it.count}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
