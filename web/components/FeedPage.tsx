import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import BriefsFeed, { type Counts } from "@/components/BriefsFeed";
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
 * The Tickets page: tickets (filed, filing, or that didn't file) and drafts
 * (written up, never filed) in one list, with a tab for each state. The two
 * are read separately, the newest PAGE of each, so a burst of drafts never
 * pushes tickets off the list, then shown together, newest first. A capture
 * not sent yet ("uploaded") is no ticket and is never read. It can be
 * narrowed to one tag: a tag's id, or "none" for what has no tag.
 * `show` opens it on a tab ("drafts", from old /drafts links).
 */
export default async function FeedPage({ tag = null, show = null }: { tag?: string | null; show?: "drafts" | null }) {
  const userId = await requireUserId();
  const admin = createAdminSupabase();

  // Fixing stuck rows only matters for the NEXT render; don't hold this one.
  after(() => recoverOrphans(admin, userId));

  // Everything at once: the connected trackers (for the tickets' live state),
  // both lists and the folders. Archived briefs are treated as deleted: never
  // fetched, never shown.
  const [ctx, tickets, drafts, folders] = await Promise.all([
    getTrackerContext(),
    feedRows(admin, userId, "tickets", tag),
    feedRows(admin, userId, "drafts", tag),
    safeTags(userId, admin),
  ]);
  // A folder that isn't yours, or is gone: back to everything.
  if (tickets === null || drafts === null) redirect("/tickets");

  const active = [...tickets, ...drafts];
  // Only 'processing' is in-progress; 'uploaded' is an unfiled capture (hidden).
  const isProcessing = active.some((b) => b.status === "processing");

  // Drafts have no tracker ticket, so they ask no tracker anything.
  const [ticketBriefs, draftBriefs, briefTags] = await Promise.all([
    attachTicketInfoFast(userId, tickets, ctx?.connected ?? [], admin),
    attachTicketInfoFast(userId, drafts, [], admin),
    safeBriefTags(active.map((b) => b.id), admin),
  ]);
  const briefs: DashboardBrief[] = [...ticketBriefs, ...draftBriefs.map((b) => ({ ...b, draft: true }))].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );

  const counts: Counts = {
    filed: active.filter((b) => b.status === "filed").length,
    processing: active.filter((b) => b.status === "processing").length,
    failed: active.filter((b) => b.status === "failed").length,
    drafted: active.filter((b) => b.status === "drafted").length,
  };

  return (
    <BriefsFeed
      briefs={briefs}
      counts={counts}
      isProcessing={isProcessing}
      renderId={crypto.randomUUID()}
      tags={folders.tags}
      briefTags={briefTags}
      activeTag={tag}
      total={folders.total}
      untagged={folders.untagged}
      initialGroup={show === "drafts" ? "draft" : "all"}
    />
  );
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
