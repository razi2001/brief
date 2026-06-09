import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import BrandMark from "@/components/BrandMark";
import AutoRefresh from "@/components/AutoRefresh";

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

type BriefStatus = "uploaded" | "processing" | "filed" | "failed";

function StatusPill({ status }: { status: string }) {
  const s = status as BriefStatus;
  const styles: Record<string, string> = {
    filed: "border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]",
    failed: "border-[rgba(198,40,40,.35)] bg-[rgba(198,40,40,.1)] text-[#c62828]",
    processing: "border-hairline bg-cream-2 text-muted",
    uploaded: "border-hairline bg-cream-2 text-ink-2",
  };
  return (
    <span className={`pill ${styles[s] ?? styles.uploaded}`}>
      {s === "processing" && (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted" />
      )}
      {status}
    </span>
  );
}

export default async function Dashboard() {
  const userId = await requireUserId();
  const user = await currentUser();
  const hasLinear = !!user?.externalAccounts?.some((a) => (a.provider ?? "").toLowerCase().includes("linear"));
  const hasJira = !!user?.externalAccounts?.some((a) => (a.provider ?? "").toLowerCase().includes("atlassian"));

  const admin = createAdminSupabase();
  const { data: briefs } = await admin
    .from("briefs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  const isProcessing = (briefs ?? []).some(
    (b) => b.status === "uploaded" || b.status === "processing",
  );

  const connections = [
    { key: "linear", name: "Linear", connected: hasLinear },
    { key: "jira", name: "Jira", connected: hasJira },
  ];

  const greetingName =
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  return (
    <AppShell headerRight={<UserButton />}>
      <h1 className="font-display text-4xl sm:text-5xl leading-tight text-ink">
        hey {greetingName},
        <br />
        <span className="text-ink-2">here&apos;s the </span>
        <em className="italic text-accent">brief</em>.
      </h1>

      {/* Connections */}
      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Connections</h2>
        <div className="mt-3 flex flex-col gap-3">
          {connections.map((c) => (
            <div
              key={c.key}
              className="card flex items-center justify-between px-4 py-3.5"
            >
              <span className="text-sm text-ink">{c.name}</span>
              {c.connected ? (
                <span className="pill border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]">
                  Connected ✓
                </span>
              ) : (
                <Link
                  href="/account"
                  className="text-xs tracking-wide text-accent no-underline hover:underline"
                >
                  Connect {c.name} →
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Recent briefs */}
      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Recent briefs</h2>
          <AutoRefresh active={isProcessing} />
        </div>

        {briefs && briefs.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {briefs.map((b) => (
              <div key={b.id} className="card px-4 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <StatusPill status={b.status} />
                    <span className="text-xs text-muted">{b.source_kind ?? "—"}</span>
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
                  ) : b.status === "failed" && b.error ? (
                    <span className="text-[#c62828]">{b.error}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card mt-3 flex flex-col items-center gap-3 px-4 py-12 text-center">
            <BrandMark size={36} />
            <p className="text-sm text-muted">
              No briefs yet — record one with the extension.
            </p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
