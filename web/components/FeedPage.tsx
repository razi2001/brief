import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import BriefsFeed from "@/components/BriefsFeed";
import CompetitionPanel from "@/components/CompetitionPanel";
import { TITLES } from "@/lib/podium";
import { type PodiumEntry, getLeaderboards, getOrg, warmOrgMemberships } from "@/lib/org-server";
import { providerName } from "@/lib/trackers/registry";
import {
  recoverOrphans,
  getTrackerContext,
  attachTicketInfoFast,
  BRIEF_COLUMNS,
  type BriefRow,
} from "@/lib/briefs-server";
import type { DashboardBrief } from "@/lib/brief-types";
import { UNTAGGED, type BriefTags, type Tag } from "@/lib/tags";
import { briefIdsOfTag, loadTags, taggedBriefIds, tagsOfBriefs } from "@/lib/tags-server";

/** Rows each kind shows: the newest tickets, and the newest drafts. */
const PAGE = 100;
/** Ids one query names: keeps the request's URL well under any limit. */
const ID_CHUNK = 100;

type Admin = ReturnType<typeof createAdminSupabase>;
type Kind = "tickets" | "drafts";

/**
 * The Tickets page, the first page of the app: the competition as one line,
 * then tickets (filed, filing, or that didn't file) and drafts (written up,
 * never filed), laid out by importance (see BriefsFeed). The two
 * are read separately, the newest PAGE of each, so a burst of drafts never
 * pushes tickets off the list, then shown together, newest first. A capture
 * not sent yet ("uploaded") is no ticket and is never read. It can be
 * narrowed to one tag: a tag's id, or "none" for what has no tag.
 * `show` opens it on what needs you only ("drafts", from old /drafts links).
 */
export default async function FeedPage({ tag = null, show = null }: { tag?: string | null; show?: "drafts" | null }) {
  const userId = await requireUserId();
  const admin = createAdminSupabase();

  // Fixing stuck rows only matters for the NEXT render; don't hold this one.
  after(() => recoverOrphans(admin, userId));

  // Everything at once: the connected trackers (for the tickets' live state),
  // both lists and the folders. Archived briefs are treated as deleted: never
  // fetched, never shown.
  const [ctx, tickets, drafts, folders, org, { count: tokens }] = await Promise.all([
    getTrackerContext(),
    feedRows(admin, userId, "tickets", tag),
    feedRows(admin, userId, "drafts", tag),
    safeTags(userId, admin),
    getOrg(userId, admin).catch(() => null),
    // The extension is set up once it holds a live pairing token.
    admin.from("extension_tokens").select("user_id", { count: "exact", head: true }).eq("user_id", userId).is("revoked_at", null),
  ]);
  // A folder that isn't yours, or is gone: back to everything.
  if (tickets === null || drafts === null) redirect("/tickets");

  const active = [...tickets, ...drafts];
  // Only 'processing' is in-progress; 'uploaded' is an unfiled capture (hidden).
  const isProcessing = active.some((b) => b.status === "processing");

  // A new account with nothing filed yet starts with the welcome steps.
  const filedCount = tickets.filter((b) => b.status === "filed").length;
  if (!!ctx.user && !ctx.onboarded && filedCount === 0 && !tag) redirect("/welcome");

  // The newest ticket stands large on the page, with a picture when it has one.
  const newest = tickets[0];

  // Drafts have no tracker ticket, so they ask no tracker anything.
  const [ticketBriefs, draftBriefs, briefTags, boards, latestImage] = await Promise.all([
    attachTicketInfoFast(userId, tickets, ctx?.connected ?? [], admin),
    attachTicketInfoFast(userId, drafts, [], admin),
    safeBriefTags(active.map((b) => b.id), admin),
    // The competition is an extra: without it the tickets still show.
    org ? getLeaderboards(org.key, userId, admin).catch(() => ({ month: [], all: [] })) : { month: [], all: [] },
    newest && !tag ? firstPicture(admin, newest.id).catch(() => null) : null,
  ]);
  if (org) after(() => warmOrgMemberships(admin));

  // The board shows from the first person: with no team (or nobody on it yet)
  // you stand on it alone, and the open places invite others.
  const monthAgo = new Date().getTime() - 30 * 24 * 60 * 60 * 1000;
  const me = (n: number): PodiumEntry => ({
    userId,
    rank: 1,
    filed: n,
    title: TITLES.first,
    name: ctx.user?.fullName || ctx.user?.firstName || "You",
    imageUrl: ctx.user?.imageUrl,
    isYou: true,
  });
  const filedRows = tickets.filter((b) => b.status === "filed");
  const month = boards.month.length ? boards.month : [me(filedRows.filter((b) => b.created_at && new Date(b.created_at).getTime() >= monthAgo).length)];
  const all = boards.all.length ? boards.all : [me(filedRows.length)];
  const briefs: DashboardBrief[] = [...ticketBriefs, ...draftBriefs.map((b) => ({ ...b, draft: true }))].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  return (
    <BriefsFeed
      briefs={briefs}
      isProcessing={isProcessing}
      renderId={crypto.randomUUID()}
      tags={folders.tags}
      briefTags={briefTags}
      activeTag={tag}
      total={folders.total}
      untagged={folders.untagged}
      draftsOnly={show === "drafts"}
      top={<CompetitionPanel month={month} all={all} orgName={org?.name ?? null} quipSeed={new Date().getTime() % 9973} />}
      latestImage={latestImage}
      setup={{
        hasTracker: ctx.connected.length > 0,
        trackerName: ctx.connected[0] ? providerName(ctx.connected[0]) : undefined,
        extensionPaired: (tokens ?? 0) > 0,
      }}
    />
  );
}

/**
 * A picture for one brief: its first screenshot, or, for a recording with no
 * screenshot, its first keyframe. A signed link, good for an hour. Null when
 * it has neither.
 */
async function firstPicture(admin: Admin, briefId: string): Promise<string | null> {
  const { data: row } = await admin.from("briefs").select("storage_prefix").eq("id", briefId).maybeSingle();
  const prefix = (row as { storage_prefix?: string | null } | null)?.storage_prefix;
  if (!prefix) return null;
  const bucket = admin.storage.from("briefs");
  const [{ data: shots }, { data: root }, { data: frames }] = await Promise.all([
    bucket.list(`${prefix}/screenshots`),
    bucket.list(prefix),
    bucket.list(`${prefix}/keyframes`),
  ]);
  const png = (list: { name: string }[] | null) => (list ?? []).map((o) => o.name).filter((n) => n.endsWith(".png")).sort()[0];
  const path = png(shots)
    ? `${prefix}/screenshots/${png(shots)}`
    : (root ?? []).some((o) => o.name === "screenshot.png")
      ? `${prefix}/screenshot.png`
      : png(frames)
        ? `${prefix}/keyframes/${png(frames)}`
        : null;
  if (!path) return null;
  const { data } = await bucket.createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

const NO_FOLDERS: { tags: Tag[]; total: number; untagged: number } = { tags: [], total: 0, untagged: 0 };

// Folders are an extra on the list: if they can't be read, the tickets still show.
async function safeTags(userId: string, admin: Admin) {
  try {
    return await loadTags(userId, admin);
  } catch {
    return NO_FOLDERS;
  }
}
async function safeBriefTags(ids: string[], admin: Admin): Promise<BriefTags> {
  try {
    return await tagsOfBriefs(ids, admin);
  } catch {
    return {};
  }
}

/**
 * One kind's briefs. A draft being written up is "processing" like a ticket
 * being filed; only filing claims a start time (or already has a body). So
 * drafts take it from the first second, and tickets never do.
 */
function feedQuery(admin: Admin, userId: string, kind: Kind) {
  const q = admin.from("briefs").select(BRIEF_COLUMNS).eq("user_id", userId).is("archived_at", null);
  const scoped =
    kind === "drafts"
      ? q.or("status.eq.drafted,and(status.eq.processing,filing_started_at.is.null,ticket_body.is.null)")
      : q.neq("status", "drafted").neq("status", "uploaded").or("status.neq.processing,filing_started_at.not.is.null,ticket_body.not.is.null");
  return scoped.order("created_at", { ascending: false });
}

/** The newest PAGE rows of one kind, or of one folder of it. Null when the folder isn't the person's. */
async function feedRows(admin: Admin, userId: string, kind: Kind, tag: string | null): Promise<BriefRow[] | null> {
  if (!tag) {
    const { data } = await feedQuery(admin, userId, kind).limit(PAGE);
    return (data ?? []) as unknown as BriefRow[];
  }

  if (tag === UNTAGGED) {
    // Read far enough past the tagged ones to still fill a page.
    const tagged = new Set(await taggedBriefIds(userId, admin).catch(() => [] as string[]));
    const { data } = await feedQuery(admin, userId, kind).limit(PAGE + Math.min(tagged.size, 400));
    return ((data ?? []) as unknown as BriefRow[]).filter((b) => !tagged.has(b.id)).slice(0, PAGE);
  }

  const ids = await briefIdsOfTag(userId, tag, admin).catch(() => null);
  if (ids === null) return null;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const parts = await Promise.all(chunks.map((c) => feedQuery(admin, userId, kind).in("id", c).limit(PAGE)));
  return parts
    .flatMap((p) => (p.data ?? []) as unknown as BriefRow[])
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, PAGE);
}
