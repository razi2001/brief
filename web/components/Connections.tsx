import Link from "next/link";

export type Connection = {
  key: string;
  name: string;
  connected: boolean;
};

const captions: Record<string, string> = {
  linear: "filing live",
  jira: "ready — connect to enable",
};

/**
 * Renders the connections array as tidy cards with a status pill. Linear and
 * Jira are both first-class; the per-tracker caption comes from `captions`.
 */
export default function Connections({
  connections,
}: {
  connections: Connection[];
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">
        Connections
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {connections.map((c) => (
          <div
            key={c.key}
            className="card flex items-center justify-between gap-3 px-4 py-3.5"
          >
            <div className="min-w-0">
              <p className="text-sm text-ink">{c.name}</p>
              <p className="mt-0.5 text-xs text-muted">
                {captions[c.key] ?? (c.connected ? "connected" : "not connected")}
              </p>
            </div>
            {c.connected ? (
              <span className="pill shrink-0 border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]">
                Connected ✓
              </span>
            ) : (
              <Link
                href="/account"
                className="shrink-0 text-xs tracking-wide text-accent no-underline hover:underline"
              >
                Connect →
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
