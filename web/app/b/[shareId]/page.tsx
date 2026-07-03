import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { getTrackerContext, attachTicketInfo, type BriefRow } from "@/lib/briefs-server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { providerOf } from "@/lib/ticket-sync";
import BrandMark from "@/components/BrandMark";
import TicketDoc from "@/components/TicketDoc";
import DownloadButton from "@/components/DownloadButton";
import PollReload from "@/components/PollReload";
import LiveWriter from "@/components/LiveWriter";
import ProgressCycler from "@/components/ProgressCycler";
import TicketChat from "@/components/TicketChat";

// Illustrative progress steps shown while the AI writes the draft (see the
// "writing" state). Not a live trace - just a natural, moving status.
const WRITING_STEPS = [
  "Reading your evidence…",
  "Pulling out what happened…",
  "Structuring the report…",
  "Writing it up clearly…",
];

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

function BackLink() {
  return (
    <a
      href="/tickets"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted no-underline transition-colors hover:text-ink"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      All tickets
    </a>
  );
}

const ARTICLE_BASE =
  "rounded-2xl border border-hairline bg-[#fffdf8] px-6 py-8 shadow-[0_1px_3px_rgba(26,22,18,0.05),0_14px_40px_-20px_rgba(26,22,18,0.18)] sm:px-12 sm:py-11";
const ARTICLE_CLASS = `brief-page-in ${ARTICLE_BASE}`;

/** One skeleton bar that rises in (staggered) - reads as a line being written.
 *  --skd staggers the slow sheen too, so the bars shimmer in sequence. */
function Bar({ w, h = 14, delay = 0 }: { w: string; h?: number; delay?: number }) {
  return (
    <div
      className="sk sk-rise"
      style={{ width: w, height: h, animationDelay: `${delay}ms`, "--skd": `${delay * 2}ms` } as React.CSSProperties}
    />
  );
}

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const brief = await loadBrief(shareId);
  if (!brief) notFound();

  const viewerId = await getUserId();

  // ── Still being written (fresh capture, no body yet): the body is written
  // line by line. Evidence is intentionally NOT shown here - a lone screenshot
  // under a skeleton reads as broken. (Filing an already-written brief goes
  // through the normal render below with a "Filing…" indicator, so the full
  // header/toolbar stay.) ──
  if ((brief.status === "processing" || brief.status === "uploaded") && !brief.ticket_body) {
    const ownerWriting = !!viewerId && viewerId === brief.user_id;
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-10 font-sans sm:px-6 sm:py-12">
        {viewerId && <BackLink />}
        <article className={ARTICLE_CLASS}>
          <div className="mb-7">
            <ProgressCycler messages={WRITING_STEPS} />
          </div>
          {ownerWriting ? (
            // The owner watches it stream in, token by token.
            <LiveWriter briefId={brief.id} fallbackTitle={brief.title} />
          ) : (
            // Everyone else: skeleton + soft poll until the owner's write lands.
            <>
              <PollReload />
              {brief.title ? (
                <h1 className="font-display text-3xl leading-[1.08] text-ink sm:text-[2.7rem]">{brief.title}</h1>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <Bar w="78%" h={30} />
                  <Bar w="46%" h={30} delay={80} />
                </div>
              )}
              <div className="mt-8 flex flex-col gap-3">
                <Bar w="100%" delay={120} />
                <Bar w="94%" delay={200} />
                <Bar w="71%" delay={280} />
                <div className="h-3" />
                <Bar w="34%" h={11} delay={380} />
                <Bar w="88%" delay={460} />
                <Bar w="60%" delay={540} />
                <div className="h-3" />
                <div className="sk sk-rise" style={{ width: "100%", height: 84, borderRadius: 12, animationDelay: "640ms", "--skd": "1280ms" } as React.CSSProperties} />
                <div className="h-3" />
                <Bar w="80%" delay={760} />
                <span className="inline-flex items-center gap-1">
                  <Bar w="42%" delay={840} />
                  <span className="writing-caret" />
                </span>
              </div>
            </>
          )}
        </article>
        <BriefFooter />
      </main>
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

  // Past the writing/failed branches, a 'processing'/'uploaded' brief HAS a body
  // → it's being filed (export). Render the full page (header + toolbar intact)
  // with a "Filing…" indicator and poll to the filed view - no stripped page.
  const filing = brief.status === "processing" || brief.status === "uploaded";
  if (!filing && brief.status !== "filed" && brief.status !== "drafted") notFound();

  const isDraft = brief.status === "drafted";
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

  // Filed → mirror the tracker LIVE: title and status can change in Linear/Jira
  // after filing (moved to "Duplicate", renamed, closed…). Fetch the current
  // state using the OWNER's token (server-side, so it works for any viewer) and
  // fall back to the stored snapshot if the tracker/token is unavailable.
  // attachTicketInfo also writes the fresh snapshot back for the next load.
  let live: { title: string; stateName: string; stateColor: string } | null = null;
  if (brief.status === "filed" && brief.ticket_identifier) {
    const row = {
      id: brief.id,
      status: brief.status,
      title: brief.title,
      source_kind: brief.source_kind,
      created_at: brief.created_at,
      updated_at: null,
      ticket_url: brief.ticket_url,
      ticket_identifier: brief.ticket_identifier,
      ticket_title: brief.ticket_title,
      ticket_state_name: brief.ticket_state_name,
      ticket_state_color: brief.ticket_state_color,
      share_id: null,
      error: null,
      archived_at: null,
      seq: null,
    } satisfies BriefRow;
    const [merged] = await attachTicketInfo(
      brief.user_id,
      [row],
      provider === "linear",
      provider === "jira",
      1,
      createAdminSupabase(),
    );
    if (merged?.ticket) {
      live = { title: merged.ticket.title, stateName: merged.ticket.stateName, stateColor: merged.ticket.stateColor };
    }
  }

  const ticketTitle = (live?.title || brief.ticket_title || brief.title || "Bug report").trim() || "Bug report";
  const stateName = filing
    ? "Filing…"
    : isDraft
      ? "Draft · not filed"
      : live?.stateName || brief.ticket_state_name || "Filed";
  const stateColor = filing
    ? "#dd6936"
    : isDraft
      ? "#8a8378"
      : live?.stateColor || brief.ticket_state_color || "#2e7d32";
  const reported = formatDate(brief.created_at);

  // Owner iterating on a draft gets the assistant rail: doc left, chat right
  // (stacked below on small screens). The container widens so the doc keeps
  // its reading width.
  const showChat = isOwner && isDraft && !filing;

  return (
    <main
      className={`mx-auto w-full px-4 py-10 font-sans sm:px-6 sm:py-12 ${
        showChat ? "max-w-[76rem]" : "max-w-5xl"
      }`}
    >
      {viewerId && <BackLink />}
      <div className={showChat ? "lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-5" : undefined}>
      <article className={ARTICLE_CLASS}>
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

      {/* Poll to the filed view while an export is in flight (soft refresh). */}
      {filing && <PollReload />}

      {/* ── Ticket: toolbar + title + body (owner can edit) ── */}
      <TicketDoc
        briefId={brief.id}
        shareId={shareId}
        isOwner={isOwner}
        isDraft={isDraft}
        filing={filing}
        ticketUrl={brief.ticket_url}
        provider={provider}
        providerName={providerName}
        initialTitle={ticketTitle}
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

      {showChat && <TicketChat briefId={brief.id} />}
      </div>

      <BriefFooter />
    </main>
  );
}
