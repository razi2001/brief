import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import BrandMark from "@/components/BrandMark";
import AutoRefresh from "@/components/AutoRefresh";
import GettingStarted from "@/components/GettingStarted";
import Integrations from "@/components/Integrations";
import BriefRow from "@/components/BriefRow";

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

  const greetingName =
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "there";

  // Getting-started state, derived purely from existing data.
  const trackerConnected = hasLinear || hasJira;
  const hasBriefs = (briefs?.length ?? 0) > 0;
  const hasFiled = (briefs ?? []).some((b) => b.status === "filed");
  // Show the checklist until the user is fully set up: a tracker is connected
  // AND at least one brief has been filed. Otherwise (no tracker, or no briefs)
  // we keep guiding them.
  const showGettingStarted = !trackerConnected || !hasBriefs || !hasFiled;

  return (
    <AppShell headerRight={<UserButton />}>
      <h1 className="font-display text-4xl sm:text-5xl leading-tight text-ink">
        hey {greetingName},
        <br />
        <span className="text-ink-2">here&apos;s the </span>
        <em className="italic text-accent">brief</em>.
      </h1>

      {showGettingStarted && (
        <GettingStarted
          trackerConnected={trackerConnected}
          hasBriefs={hasBriefs}
          hasFiled={hasFiled}
        />
      )}

      {/* Integrations */}
      <Integrations />

      {/* Recent briefs */}
      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-[0.15em] text-muted">Recent briefs</h2>
          <AutoRefresh active={isProcessing} />
        </div>

        {briefs && briefs.length > 0 ? (
          <div className="mt-3 flex flex-col gap-3">
            {briefs.map((b) => (
              <BriefRow key={b.id} brief={b} />
            ))}
          </div>
        ) : (
          <div className="card mt-3 flex flex-col items-center gap-3 px-4 py-12 text-center">
            <BrandMark size={36} />
            <p className="font-display text-xl text-ink">no briefs yet.</p>
            <p className="max-w-xs text-sm text-muted">
              hit ✦ in the extension, talk through a bug, and it lands here —
              written up and filed.
            </p>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-16 border-t hairline pt-6 text-center">
        <p className="text-xs text-muted">
          <a
            href="https://get-brief.app"
            target="_blank"
            rel="noreferrer"
            className="text-muted no-underline hover:text-accent hover:underline"
          >
            get-brief.app
          </a>{" "}
          · what&apos;s the brief?
        </p>
      </footer>
    </AppShell>
  );
}
