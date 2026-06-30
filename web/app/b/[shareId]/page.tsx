import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { getTrackerContext } from "@/lib/briefs-server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { providerOf } from "@/lib/ticket-sync";
import BrandMark from "@/components/BrandMark";
import TicketDoc from "@/components/TicketDoc";
import DownloadButton from "@/components/DownloadButton";
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
  const { data } = await admin.from("briefs").select(SHARE_COLUMNS).eq("share_id", shareId).maybeSingle();
  return (data as ShareRow | null) ?? null;
}

type Asset = { url: string; filename: string; kind: "image" | "video" };

/** Signed URLs (1h) for the evidence still kept in storage for this brief. */
async function loadMedia(prefix: string, idBase: string): Promise<Asset[]> {
  const admin = createAdminSupabase();
  const sign = async (p: string) => {
    const { data } = await admin.storage.from("briefs").createSignedUrl(p, 3600);
    return data?.signedUrl ?? null;
  };
  const assets: Asset[] = [];

  const { data: shotList } = await admin.storage.from("briefs").list(`${prefix}/screenshots`);
  let n = 0;
  for (const o of (shotList ?? []).map((o) => o.name).sort()) {
    const url = await sign(`${prefix}/screenshots/${o}`);
    if (url) assets.push({ url, filename: `${idBase}-screenshot-${++n}.png`, kind: "image" });
  }

  const { data: rootList } = await admin.storage.from("briefs").list(prefix);
  const rootNames = new Set((rootList ?? []).map((o) => o.name));
  if (rootNames.has("screenshot.png")) {
    const url = await sign(`${prefix}/screenshot.png`);
    if (url) assets.push({ url, filename: `${idBase}-screenshot-${++n}.png`, kind: "image" });
  }
  if (rootNames.has("recording.webm")) {
    const url = await sign(`${prefix}/recording.webm`);
    if (url) assets.push({ url, filename: `${idBase}-recording.webm`, kind: "video" });
  }
  return assets;
}

export async function generateMetadata({ params }: { params: Promise<{ shareId: string }> }): Promise<Metadata> {
  const { shareId } = await params;
  const brief = await loadBrief(shareId);
  const title = brief?.ticket_title || brief?.title || "Bug report";
  return {
    title: `${title} · Brief`,
    description: "A bug report captured and written up with Brief.",
    robots: { index: false, follow: false },
  };
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
          <BrandMark size={24} />
          <span className="text-sm text-muted">
            Captured with <span className="text-ink-2">Brief</span> — record a bug, file the perfect ticket in seconds.
          </span>
        </span>
        <span className="font-mono text-xs text-accent group-hover:underline">Try it free →</span>
      </a>
    </footer>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-20 font-sans sm:px-8">
      <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">{children}</div>
      <BriefFooter />
    </main>
  );
}

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const brief = await loadBrief(shareId);
  if (!brief) notFound();

  // ── In progress: writing the draft, or filing an already-written one ──
  if (brief.status === "processing" || brief.status === "uploaded") {
    // A body already exists → this is an export being filed, not a fresh write.
    const filing = !!brief.ticket_body;
    return (
      <CenterCard>
        <PollReload />
        <BrandMark size={32} />
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-hairline border-t-accent" aria-hidden />
        <p className="font-display text-2xl text-ink">{filing ? "Filing your ticket…" : "Writing this up…"}</p>
        <p className="max-w-xs text-sm text-muted">
          {filing
            ? "Pushing this to your tracker and attaching the evidence. This page updates on its own in a moment."
            : `Brief is turning ${brief.title ? `"${brief.title}"` : "your capture"} into a clean ticket. This page updates on its own in a moment.`}
        </p>
      </CenterCard>
    );
  }

  // ── Couldn't be written ──
  if (brief.status === "failed") {
    return (
      <CenterCard>
        <BrandMark size={32} />
        <p className="font-display text-2xl text-ink">This one couldn&apos;t be written up.</p>
        <p className="max-w-xs text-sm text-muted">
          Something went wrong turning this capture into a ticket. Try again from the Brief extension.
        </p>
      </CenterCard>
    );
  }

  if (brief.status !== "filed" && brief.status !== "drafted") notFound();

  const isDraft = brief.status === "drafted";
  const viewerId = await getUserId();
  const isOwner = !!viewerId && viewerId === brief.user_id;

  let hasLinear = false;
  let hasJira = false;
  if (isOwner && isDraft) {
    const ctx = await getTrackerContext();
    hasLinear = ctx.hasLinear;
    hasJira = ctx.hasJira;
  }

  const idBase = (brief.ticket_identifier || "brief").toLowerCase();
  const assets = await loadMedia(brief.storage_prefix, idBase);
  const provider = providerOf(brief.ticket_url);
  const providerName = provider === "jira" ? "Jira" : "Linear";
  const stateName = isDraft ? "Draft · not filed" : brief.ticket_state_name || "Filed";
  const stateColor = isDraft ? "#8a8378" : brief.ticket_state_color || "#2e7d32";
  const reported = formatDate(brief.created_at);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 font-sans sm:px-6 sm:py-12">
      {viewerId && (
        <a
          href="/tickets"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted no-underline transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          All tickets
        </a>
      )}
      <article className="rounded-2xl border border-hairline bg-[#fffdf8] px-6 py-8 shadow-[0_1px_3px_rgba(26,22,18,0.05),0_14px_40px_-20px_rgba(26,22,18,0.18)] sm:px-12 sm:py-11">
      {/* ── Meta strip ── */}
      <div className="mb-7 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem] text-muted">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: stateColor }} />
          {stateName}
        </span>
        {!isDraft && brief.ticket_identifier && (
          <>
            <span className="text-hairline">·</span>
            <span className="text-accent">{brief.ticket_identifier}</span>
          </>
        )}
        {reported && (
          <>
            <span className="text-hairline">·</span>
            <span>{reported}</span>
          </>
        )}
      </div>

      {/* ── Ticket: toolbar + title + body (owner can edit) ── */}
      <TicketDoc
        briefId={brief.id}
        shareId={shareId}
        isOwner={isOwner}
        isDraft={isDraft}
        ticketUrl={brief.ticket_url}
        provider={provider}
        providerName={providerName}
        initialTitle={brief.ticket_title || brief.title || "Bug report"}
        initialBody={brief.ticket_body || ""}
        assets={assets.map((a) => ({ filename: a.filename, kind: a.kind }))}
        hasLinear={hasLinear}
        hasJira={hasJira}
      />

      {/* ── Evidence ── */}
      {assets.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted">
            Evidence
          </h2>
          <div className="flex flex-col gap-4">
            {assets.map((a, i) => (
              <div key={i} className="group/ev relative overflow-hidden rounded-xl border border-hairline bg-cream/40">
                <DownloadButton url={a.url} filename={a.filename} />
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={`Evidence ${i + 1}`} className="w-full" />
                ) : (
                  <video src={a.url} controls className="w-full bg-ink" />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      </article>

      <BriefFooter />
    </main>
  );
}
