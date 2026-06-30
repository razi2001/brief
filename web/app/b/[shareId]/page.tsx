import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { getTrackerContext } from "@/lib/briefs-server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { providerOf } from "@/lib/ticket-sync";
import BrandMark from "@/components/BrandMark";
import { TrackerLogo } from "@/components/TrackerLogo";
import Markdown from "@/components/Markdown";
import CopyLinkButton from "@/components/CopyLinkButton";
import ExportButtons from "@/components/ExportButtons";
import PollReload from "@/components/PollReload";

// Signed media URLs expire, so never cache the rendered page.
export const dynamic = "force-dynamic";

type ShareRow = {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  source_kind: string | null;
  created_at: string | null;
  ticket_url: string | null;
  ticket_identifier: string | null;
  ticket_title: string | null;
  ticket_state_name: string | null;
  ticket_state_color: string | null;
  ticket_body: string | null;
  storage_prefix: string;
};

const SHARE_COLUMNS =
  "id, user_id, status, title, source_kind, created_at, ticket_url, ticket_identifier, ticket_title, ticket_state_name, ticket_state_color, ticket_body, storage_prefix";

async function loadBrief(shareId: string): Promise<ShareRow | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("briefs")
    .select(SHARE_COLUMNS)
    .eq("share_id", shareId)
    .maybeSingle();
  return (data as ShareRow | null) ?? null;
}

/** Signed URLs (1h) for the evidence still kept in storage for this brief.
 *  Screenshots are stored under screenshots/<id>.png (multiple, each captioned),
 *  with a legacy top-level screenshot.png; the recording is kept when attached. */
async function loadMedia(
  prefix: string,
): Promise<{ screenshots: string[]; recording?: string }> {
  const admin = createAdminSupabase();
  const sign = async (p: string) => {
    const { data } = await admin.storage.from("briefs").createSignedUrl(p, 3600);
    return data?.signedUrl ?? null;
  };
  const out: { screenshots: string[]; recording?: string } = { screenshots: [] };

  // Multiple screenshots under screenshots/.
  const { data: shotList } = await admin.storage.from("briefs").list(`${prefix}/screenshots`);
  for (const o of (shotList ?? []).map((o) => o.name).sort()) {
    const url = await sign(`${prefix}/screenshots/${o}`);
    if (url) out.screenshots.push(url);
  }

  // Root: legacy single screenshot + the recording.
  const { data: rootList } = await admin.storage.from("briefs").list(prefix);
  const rootNames = new Set((rootList ?? []).map((o) => o.name));
  if (rootNames.has("screenshot.png")) {
    const url = await sign(`${prefix}/screenshot.png`);
    if (url) out.screenshots.push(url);
  }
  if (rootNames.has("recording.webm")) {
    out.recording = (await sign(`${prefix}/recording.webm`)) ?? undefined;
  }
  return out;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const brief = await loadBrief(shareId);
  const title = brief?.ticket_title || brief?.title || "Bug report";
  return {
    title: `${title} · Brief`,
    description: "A bug report captured and written up with Brief.",
    // Unguessable links, but keep them out of search indexes regardless.
    robots: { index: false, follow: false },
  };
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-muted">{label}</span>
      <span className="text-sm text-ink-2">{children}</span>
    </div>
  );
}

/** Shared "Captured with Brief" footer - the viral loop. */
function BriefFooter() {
  return (
    <footer className="mt-16 border-t border-hairline pt-6">
      <a
        href="https://cloud.get-brief.app"
        target="_blank"
        rel="noreferrer"
        className="group flex flex-wrap items-center justify-between gap-3 no-underline"
      >
        <span className="flex items-center gap-2.5">
          <BrandMark size={26} />
          <span className="text-sm text-muted">
            Captured with <span className="text-ink-2">Brief</span> — record a bug, file the perfect ticket in seconds.
          </span>
        </span>
        <span className="font-mono text-xs text-accent group-hover:underline">Try it free →</span>
      </a>
    </footer>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const brief = await loadBrief(shareId);
  if (!brief) notFound();

  // ── Still being written up ──
  if (brief.status === "processing" || brief.status === "uploaded") {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-20 sm:px-8">
        <PollReload />
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <BrandMark size={34} />
          <span
            className="h-7 w-7 animate-spin rounded-full border-2 border-hairline border-t-accent"
            aria-hidden
          />
          <p className="font-display text-2xl text-ink">Writing this up…</p>
          <p className="max-w-xs text-sm text-muted">
            Brief is turning {brief.title ? `"${brief.title}"` : "your capture"} into a clean ticket.
            This page updates on its own in a moment.
          </p>
        </div>
        <BriefFooter />
      </main>
    );
  }

  // ── Couldn't be written ──
  if (brief.status === "failed") {
    return (
      <main className="mx-auto w-full max-w-2xl px-5 py-20 sm:px-8">
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <BrandMark size={34} />
          <p className="font-display text-2xl text-ink">This one couldn&apos;t be written up.</p>
          <p className="max-w-xs text-sm text-muted">
            Something went wrong turning this capture into a ticket. Try again from the Brief extension.
          </p>
        </div>
        <BriefFooter />
      </main>
    );
  }

  // ── Filed or drafted: the full ticket page ──
  if (brief.status !== "filed" && brief.status !== "drafted") notFound();

  const isDraft = brief.status === "drafted";
  const viewerId = await getUserId();
  const isOwner = !!viewerId && viewerId === brief.user_id;

  // Which trackers the (signed-in) owner can export to. Only queried for the
  // owner of a draft - never for anonymous visitors.
  let hasLinear = false;
  let hasJira = false;
  if (isOwner && isDraft) {
    const ctx = await getTrackerContext();
    hasLinear = ctx.hasLinear;
    hasJira = ctx.hasJira;
  }

  const media = await loadMedia(brief.storage_prefix);
  const provider = providerOf(brief.ticket_url);
  const providerName = provider === "jira" ? "Jira" : "Linear";
  const title = brief.ticket_title || brief.title || "Bug report";
  const stateName = isDraft ? "Draft" : brief.ticket_state_name || "Filed";
  const stateColor = isDraft ? "#8a8378" : brief.ticket_state_color || "#2e7d32";

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      {/* ── Top bar: identifier · status · open in tracker · copy ── */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {!isDraft && brief.ticket_identifier && (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-accent">
              <TrackerLogo kind={provider} size={14} />
              {brief.ticket_identifier}
            </span>
          )}
          <span className="pill text-ink-2" title={stateName}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stateColor }} />
            {isDraft ? "Draft · not filed" : stateName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isDraft && brief.ticket_url && (
            <a
              href={brief.ticket_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-hairline bg-cream/60 px-3 py-1.5 text-xs text-ink-2 no-underline transition-colors hover:bg-cream-2/70 hover:text-ink"
            >
              <TrackerLogo kind={provider} size={13} />
              Open in {providerName}
            </a>
          )}
          <CopyLinkButton path={`/b/${shareId}`} />
        </div>
      </div>

      {/* ── Issue title ── */}
      <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">{title}</h1>

      {/* ── Owner export banner (drafts only) ── */}
      {isDraft && isOwner && (
        <div className="card mt-5 flex flex-col gap-3 p-4">
          <p className="text-sm text-ink-2">
            This is your draft. File it to a tracker, or copy the link to share it as is.
          </p>
          <ExportButtons briefId={brief.id} linear={hasLinear} jira={hasJira} />
        </div>
      )}
      {isDraft && !isOwner && (
        <p className="mt-4 text-sm text-muted">A draft bug report, not yet filed to a tracker.</p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_15rem]">
        {/* Main column: description + evidence */}
        <article className="min-w-0">
          {brief.ticket_body ? (
            <Markdown source={brief.ticket_body} />
          ) : (
            <p className="text-sm text-muted">No description.</p>
          )}

          {(media.screenshots.length > 0 || media.recording) && (
            <section className="mt-8">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted">Evidence</h2>
              <div className="flex flex-col gap-4">
                {media.screenshots.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt={`Screenshot ${i + 1}`}
                    className="w-full rounded-lg border border-hairline"
                  />
                ))}
                {media.recording && (
                  <video
                    src={media.recording}
                    controls
                    className="w-full rounded-lg border border-hairline bg-ink"
                  />
                )}
              </div>
            </section>
          )}
        </article>

        {/* Properties sidebar (Linear-style) */}
        <aside className="lg:border-l lg:border-hairline lg:pl-6">
          <div className="card flex flex-col gap-4 p-4 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
            <Property label="Status">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stateColor }} />
                {isDraft ? "Draft" : stateName}
              </span>
            </Property>
            {!isDraft && (
              <Property label="Tracker">
                <span className="inline-flex items-center gap-1.5">
                  <TrackerLogo kind={provider} size={13} />
                  {providerName}
                </span>
              </Property>
            )}
            {brief.source_kind && <Property label="Type">{brief.source_kind}</Property>}
            <Property label="Reported">{formatDate(brief.created_at) || "—"}</Property>
          </div>
        </aside>
      </div>

      <BriefFooter />
    </main>
  );
}
