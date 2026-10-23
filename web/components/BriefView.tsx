import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { getTrackerContext, attachTicketInfoFast, type BriefRow } from "@/lib/briefs-server";
import { providerName as providerLabelFor } from "@/lib/trackers/registry";
import { BRIEF_URL, type ProviderKey } from "@/lib/tracker";
import { createAdminSupabase } from "@/lib/supabase/server";
import { displayIdentifier, keylessTrackerName, providerOf, shortIdentifier } from "@/lib/ticket-sync";
import { briefPhase } from "@/lib/brief-filing";
import BrandMark from "@/components/BrandMark";
import TicketDoc from "@/components/TicketDoc";
import {
  BriefPageFrame,
  ReadingColumn,
  BriefFooter,
  TicketMeta,
  Attachments,
  type BriefAsset,
} from "@/components/BriefPage";
import PollReload from "@/components/PollReload";
import LiveWriter from "@/components/LiveWriter";
import ProgressCycler, { WRITING_STEPS, FILING_STEPS } from "@/components/ProgressCycler";
import TicketChat, { type ChatMode } from "@/components/TicketChat";

export type ShareRow = {
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
  filing_started_at: string | null;
  storage_prefix: string;
  ticket_provider: string | null;
  /** Why the last run failed; on a draft, why its export went back to draft. */
  error: string | null;
};

const SHARE_COLUMNS =
  "id, user_id, status, title, source_kind, created_at, ticket_url, ticket_identifier, ticket_title, ticket_state_name, ticket_state_color, ticket_body, filing_started_at, storage_prefix, ticket_provider, error";

/** One read per request, shared by the page and its metadata. */
export const loadBrief = cache(async (shareId: string): Promise<ShareRow | null> => {
  const admin = createAdminSupabase();
  const { data } = await admin.from("briefs").select(SHARE_COLUMNS).eq("share_id", shareId).maybeSingle();
  return (data as ShareRow | null) ?? null;
});

type Asset = BriefAsset;

/** Signed URLs (1h) for the evidence still kept in storage for this brief. */
async function loadMedia(prefix: string, idBase: string): Promise<Asset[]> {
  const admin = createAdminSupabase();
  const sign = async (p: string) => {
    const { data } = await admin.storage.from("briefs").createSignedUrl(p, 3600);
    return data?.signedUrl ?? null;
  };
  // Both listings at once, then every signature at once - one round trip
  // each, not one per file.
  const [{ data: shotList }, { data: rootList }] = await Promise.all([
    admin.storage.from("briefs").list(`${prefix}/screenshots`),
    admin.storage.from("briefs").list(prefix),
  ]);
  const shots = (shotList ?? []).map((o) => o.name).sort();
  const rootNames = new Set((rootList ?? []).map((o) => o.name));
  const has = (f: string) => rootNames.has(f);
  const [shotUrls, legacyShot, recording, replay, voice] = await Promise.all([
    Promise.all(shots.map((o) => sign(`${prefix}/screenshots/${o}`))),
    has("screenshot.png") ? sign(`${prefix}/screenshot.png`) : null,
    has("recording.webm") ? sign(`${prefix}/recording.webm`) : null,
    // The extension's replay (rrweb events + the edit), played in the page.
    has("replay.json") ? sign(`${prefix}/replay.json`) : null,
    has("replay-voice.webm") ? sign(`${prefix}/replay-voice.webm`) : null,
  ]);

  const assets: Asset[] = [];
  let n = 0;
  shots.forEach((o, i) => {
    const url = shotUrls[i];
    if (url) assets.push({ url, filename: `${idBase}-screenshot-${++n}.png`, kind: "image", path: `screenshots/${o}` });
  });
  if (legacyShot) assets.push({ url: legacyShot, filename: `${idBase}-screenshot-${++n}.png`, kind: "image", path: "screenshot.png" });
  if (recording) assets.push({ url: recording, filename: `${idBase}-recording.webm`, kind: "video", path: "recording.webm" });
  if (replay) assets.push({ url: replay, filename: `${idBase}-replay.json`, kind: "replay", path: "replay.json", voiceUrl: voice ?? undefined });
  return assets;
}

export async function briefMetadata(shareId: string): Promise<Metadata> {
  const brief = await loadBrief(shareId);
  const title = brief?.ticket_title || brief?.title || "Bug report";
  const origin = (process.env.APP_URL || BRIEF_URL).replace(/\/+$/, "");
  return {
    title: `${title} · Brief`,
    description: "A bug report captured and written up with Brief.",
    robots: { index: false, follow: false },
    // the same report as Markdown, for a coding agent handed this link
    alternates: { types: { "text/markdown": `${origin}/b/${shareId}.md` } },
  };
}

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

/** Where a brief lives inside the app: drafts under Drafts, the rest under Tickets. */
export function appSectionOf(brief: Pick<ShareRow, "status" | "ticket_url" | "filing_started_at">): "tickets" | "drafts" {
  // 'writing' is a draft being written up (filing to a tracker is its own phase)
  const phase = briefPhase(brief as ShareRow);
  return phase === "draft" || phase === "writing" ? "drafts" : "tickets";
}

/** ← Tickets › APP-6453 › title, above the sheet when the brief opens inside the app. */
function Breadcrumb({ section, identifier, title }: { section: "tickets" | "drafts"; identifier?: string | null; title: string }) {
  const label = section === "drafts" ? "Drafts" : "Tickets";
  const chevron = (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted/70">
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <Link href={`/${section}`} aria-label={`Back to ${label}`} title={`Back to ${label}`} className="btn mr-1.5 h-8 w-8 shrink-0 justify-center !p-0 text-muted">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      </Link>
      <Link href={`/${section}`} className="shrink-0 rounded-md px-1 py-0.5 text-muted no-underline transition-colors hover:bg-white/60 hover:text-ink">
        {label}
      </Link>
      {chevron}
      {identifier && (
        <>
          <span className="shrink-0 font-mono text-xs text-muted">{identifier}</span>
          {chevron}
        </>
      )}
      <span className="min-w-0 truncate font-medium text-ink-2">{title}</span>
    </nav>
  );
}

/** The sheet's surroundings: the app's breadcrumb, or the public page's top bar and footer. */
function Frame({
  home,
  signedIn,
  identifier,
  title,
  children,
}: {
  /** Set when the brief opens inside the app. */
  home?: "tickets" | "drafts";
  signedIn: boolean;
  identifier?: string | null;
  title: string;
  children: React.ReactNode;
}) {
  if (home) {
    return (
      <div>
        <Breadcrumb section={home} identifier={identifier} title={title} />
        <div className="card mt-4 overflow-hidden">{children}</div>
      </div>
    );
  }
  return (
    <BriefPageFrame signedIn={signedIn}>
      {children}
      <BriefFooter signedIn={signedIn} />
    </BriefPageFrame>
  );
}

/**
 * One brief, in one of two frames:
 *  - public (the share link, /b/<id>): the white sheet on the clouds, with the
 *    Brief top bar and footer - what a visitor sees;
 *  - in the app (/tickets/<id>, /drafts/<id>): inside the sidebar shell, with
 *    a breadcrumb over the sheet.
 * Everything between (states, live tracker mirror, assistant) is shared.
 */
export default async function BriefView({ shareId, section }: { shareId: string; section?: "tickets" | "drafts" }) {
  const [brief, viewerId] = await Promise.all([loadBrief(shareId), getUserId()]);
  if (!brief) notFound();
  const inApp = !!section;

  // The brief's real state - ticket_url wins over the status column, so a row
  // whose run created the ticket and then died still renders as filed.
  const phase = briefPhase(brief);

  // In the app, a brief lives in exactly one place: a draft under Drafts, the
  // rest under Tickets. A stale link (filed since) moves to the right one.
  const home = appSectionOf(brief);
  if (inApp && section !== home) redirect(`/${home}/${shareId}`);


  // ── Couldn't be written ──
  if (phase === "failed") {
    return (
      <Frame home={inApp ? home : undefined} signedIn={!!viewerId} title={brief.title || "Bug report"}>
        <ReadingColumn className="flex flex-col items-center gap-3 py-24 text-center sm:py-28">
          <BrandMark size={32} />
          <p className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">This one couldn&apos;t be written up.</p>
          <p className="max-w-xs text-[13px] text-muted">
            Something went wrong turning this capture into a ticket. Try again from the Brief extension.
          </p>
        </ReadingColumn>
      </Frame>
    );
  }

  // One unified layout for every other state, so the page NEVER reflows as a
  // brief moves through its life:
  //   writing → no body yet: the doc streams in / skeleton
  //   filing  → being filed to the tracker: the doc (or the skeleton, when it
  //             was filed straight from the extension and never drafted) +
  //             status, and NEVER the export controls
  //   drafted / filed → the document
  // The OWNER always gets the assistant rail (it's the author - present from
  // the first frame, so nothing ever pops in and shifts the page). Visitors
  // always get the centered document, and never a rail.
  //
  // 'writing' and 'filing' both sit at status='processing' - only the filing
  // claim separates them (lib/brief-filing.ts). Reading a filing run as
  // "writing" is what used to stream a draft over it and re-offer Export on a
  // capture that already had a Linear ticket.
  if (phase === "unknown") notFound();
  const writing = phase === "writing";
  const filing = phase === "filing";
  // Nothing written yet → the document-taking-shape state (streamed for the
  // owner while writing, a polling skeleton while filing).
  const inProgress = (writing || filing) && !brief.ticket_body;

  const isDraft = phase === "draft";
  const isOwner = !!viewerId && viewerId === brief.user_id;
  const withRail = isOwner;
  const railMode: ChatMode = writing ? "writing" : isDraft ? "ready" : filing ? "filing" : "filed";

  const idBase = (brief.ticket_identifier || "brief").toLowerCase();
  const provider = providerOf(brief.ticket_url, brief.ticket_provider);
  const providerLabel = providerLabelFor(provider);

  // Everything else this page needs, all at once:
  //  - which trackers the owner could export this draft to;
  //  - the evidence (none while writing - a lone screenshot under a skeleton
  //    reads as broken, and signing URLs nobody will see is waste);
  //  - filed → the ticket as the tracker has it NOW (title and status move
  //    after filing: renamed, closed, "Duplicate"…), read with the OWNER's
  //    token so it works for any viewer, time-boxed, falling back to the
  //    stored snapshot (and writing the fresh one back for the next load).
  const filedRow =
    phase === "filed" && brief.ticket_identifier
      ? ({
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
          ticket_provider: brief.ticket_provider,
        } satisfies BriefRow)
      : null;
  const [ctx, assets, liveRows] = await Promise.all([
    isOwner && isDraft ? getTrackerContext() : Promise.resolve(null),
    inProgress ? Promise.resolve([] as Asset[]) : loadMedia(brief.storage_prefix, idBase),
    filedRow ? attachTicketInfoFast(brief.user_id, [filedRow], [provider], createAdminSupabase()) : Promise.resolve(null),
  ]);
  const connected: ProviderKey[] = ctx?.connected ?? [];

  let live: {
    title: string;
    stateName: string;
    stateColor: string;
    identifier?: string;
    url?: string;
    deleted?: boolean;
  } | null = null;
  {
    const merged = liveRows?.[0];
    if (merged?.ticket) {
      live = {
        title: merged.ticket.title,
        stateName: merged.ticket.stateName,
        stateColor: merged.ticket.stateColor,
        // A moved ticket answers with its new identifier/url; a deleted one
        // has nothing left to open in the tracker.
        identifier: merged.ticket_identifier ?? undefined,
        url: merged.ticket.deleted ? undefined : merged.ticket.url || undefined,
        deleted: merged.ticket.deleted,
      };
    }
  }

  const ticketIdentifier = live?.identifier || brief.ticket_identifier;
  // Null on a draft, and for trackers whose id means nothing to a reader
  // (a Notion page id, an Asana task gid): the breadcrumb and the meta row then
  // leave the id and its separator out instead of printing a blank or a raw id.
  // The meta row has room for the whole id; the breadcrumb gets the short one.
  const shownId = (!isDraft && displayIdentifier(ticketIdentifier, provider)) || null;
  const shortId = shownId && shortIdentifier(ticketIdentifier, provider);
  // In the meta row, such a ticket names its tracker where the id would be.
  // The breadcrumb leaves it out: a crumb there reads as a place in the app.
  const trackerName = (!isDraft && keylessTrackerName(ticketIdentifier, provider)) || null;
  // Deleted in the tracker → no tracker link anywhere on the page.
  const ticketUrl = live?.deleted ? null : live?.url || brief.ticket_url;
  const ticketTitle = (live?.title || brief.ticket_title || brief.title || "Bug report").trim() || "Bug report";
  // A draft started blank has no title yet: the heading stays empty to type
  // into, and the breadcrumb names it the way the Drafts list does.
  const draftTitle = (brief.ticket_title || brief.title || "").trim();
  const docTitle = isDraft ? draftTitle : ticketTitle;
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

  return (
    <>
    {/* The document is always centered at a comfortable reading width - the
        layout NEVER changes between visitor/owner or draft/filed. The assistant
        is a floating panel (below), so it reserves no column and leaves no empty
        space beside the doc. Extra bottom padding on owner drafts clears the
        floating panel. */}
    <Frame home={inApp ? home : undefined} signedIn={!!viewerId} identifier={shortId} title={docTitle || "Untitled draft"}>
      <ReadingColumn className={withRail ? "pb-44 sm:pb-48" : ""}>
      {/* The writing state doesn't fade in - only the resolved ticket does, so
          the writing→ready hand-off is ONE gentle settle, not two page fades
          ("loaded twice"). */}
      <article className={inProgress ? undefined : "brief-page-in"}>
      {inProgress ? (
        // (an 'uploaded' row isn't handed over yet: its edits aren't merged,
        // so the owner waits on the skeleton too, rather than start a write)
        isOwner && writing && brief.status === "processing" ? (
          // The owner watches their ticket stream in, token by token. The
          // rail (mode="writing") narrates - no status pill over the doc.
          <LiveWriter briefId={brief.id} fallbackTitle={brief.title} />
        ) : (
          // Visitors: moving status + skeleton + soft poll until the write lands.
          <>
            <div className="mb-6">
              <ProgressCycler messages={filing ? FILING_STEPS : WRITING_STEPS} className="text-[13px]" />
            </div>
            <PollReload />
            {brief.title ? (
              <h1 className="text-[28px] font-semibold leading-[1.2] tracking-[-0.022em] text-ink sm:text-[32px]">{brief.title}</h1>
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
        )
      ) : (
        <>
          {/* ── Meta row ── */}
          <TicketMeta
            stateName={stateName}
            stateColor={stateColor}
            identifier={shownId}
            trackerName={trackerName}
            reported={reported}
          />

          {/* Poll to the filed view while an export is in flight (soft refresh). */}
          {filing && <PollReload />}

          {/* ── Ticket: title + toolbar + body (owner can edit) ── */}
          <TicketDoc
            briefId={brief.id}
            shareId={shareId}
            isOwner={isOwner}
            isDraft={isDraft}
            filing={filing}
            ticketUrl={ticketUrl}
            provider={provider}
            providerName={providerLabel}
            initialTitle={docTitle}
            initialBody={brief.ticket_body || ""}
            assets={assets.flatMap((a) => (a.kind === "replay" ? [] : [{ filename: a.filename, kind: a.kind }]))}
            connected={connected}
            exportError={isOwner && isDraft ? brief.error : null}
          />

          {/* ── Attachments ── (the ticket's own text often has an "Evidence"
              section already: this is the media itself, so it says so) */}
          <Attachments briefId={brief.id} assets={assets} canRemove={isOwner} />
        </>
      )}
      </article>
      </ReadingColumn>
    </Frame>

    {/* Floating assistant - fixed to the viewport, reserves no layout column. */}
    {withRail && (
      <TicketChat
        briefId={brief.id}
        mode={railMode}
        ticketUrl={ticketUrl}
        providerName={providerLabel}
      />
    )}
    </>
  );
}
