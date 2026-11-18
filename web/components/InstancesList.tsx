import type { InstanceRow } from "@/lib/telemetry-server";

const ago = (days: number) => (days === 0 ? "today" : `${days}d`);

/** Self-hosted instances from their anonymous daily heartbeat (TELEMETRY.md). */
export default function InstancesList({ instances }: { instances: InstanceRow[] }) {
  if (instances.length === 0) return null;
  const live = instances.filter((i) => i.ageDays < 3);
  return (
    <section className="mt-12">
      <h2 className="text-[15px] font-medium text-ink">Self-hosted</h2>
      <p className="mt-1 flex flex-wrap gap-x-4 text-[13px] tabular-nums text-muted">
        <span>{live.length} live</span>
        <span>{live.reduce((n, i) => n + i.users, 0)} people</span>
        <span>{live.reduce((n, i) => n + i.filed7d, 0)} filed this week</span>
      </p>
      <div className="card mt-4 overflow-hidden p-0">
        <div className="hidden grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_minmax(0,1fr)_56px] gap-x-4 border-b border-hairline px-4 py-2 text-xs font-medium text-muted sm:grid">
          <span>Instance</span>
          <span>Version</span>
          <span>People</span>
          <span>Filed 7d</span>
          <span>Failed 7d</span>
          <span>Trackers</span>
          <span>Seen</span>
        </div>
        <ul className="divide-y divide-hairline">
          {instances.map((i) => (
            <li
              key={i.instance}
              className="grid grid-cols-[minmax(0,1fr)_64px_64px_64px_64px_minmax(0,1fr)_56px] items-center gap-x-4 px-4 py-2 text-[12.5px] tabular-nums text-ink-2"
            >
              <span className="truncate font-mono text-muted">{i.instance.slice(0, 8)}</span>
              <span>{i.version}</span>
              <span>{i.users}</span>
              <span>{i.filed7d}</span>
              <span className={i.failed7d ? "text-[#c62828]" : ""}>{i.failed7d}</span>
              <span className="truncate">{i.trackers.join(", ")}</span>
              <span className="text-muted">{ago(i.ageDays)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
