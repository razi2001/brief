import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { isUniqueViolation } from "@/lib/share-id";
import { MAX_TAGS, isTagColor, nextTagColor, type BriefTags, type Tag, type TagColor } from "@/lib/tags";

/**
 * Tags, read and written with the service-role client. Every entry point takes
 * the signed-in user's id from the route's own auth() call, and every query is
 * scoped by it: a tag or a brief that isn't yours reads as missing.
 */

/** Statuses the Tickets list shows, drafts included; a folder's count is over these. */
const TICKET_STATUSES = ["filed", "failed", "processing", "drafted"];

type TagRow = { id: string; name: string; color: string };

const toTag = (r: TagRow, count = 0): Tag => ({
  id: r.id,
  name: r.name,
  color: isTagColor(r.color) ? r.color : "clay",
  count,
});

/**
 * The person's folders with how many tickets each holds, plus how many tickets
 * there are in all and how many carry no tag.
 */
export async function loadTags(
  userId: string,
  db?: SupabaseClient,
): Promise<{ tags: Tag[]; total: number; untagged: number }> {
  const admin = db ?? createAdminSupabase();
  const [tagRows, links, all] = await Promise.all([
    admin.from("tags").select("id, name, color").eq("user_id", userId).order("name"),
    admin
      .from("brief_tags")
      .select("tag_id, brief_id, briefs!inner(user_id, status, archived_at)")
      .eq("briefs.user_id", userId)
      .is("briefs.archived_at", null)
      .in("briefs.status", TICKET_STATUSES),
    admin
      .from("briefs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null)
      .in("status", TICKET_STATUSES),
  ]);
  if (tagRows.error) throw new Error(tagRows.error.message);
  if (links.error) throw new Error(links.error.message);

  const counts = new Map<string, number>();
  const tagged = new Set<string>();
  for (const l of (links.data ?? []) as unknown as { tag_id: string; brief_id: string }[]) {
    counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1);
    tagged.add(l.brief_id);
  }
  const total = all.count ?? 0;
  return {
    tags: ((tagRows.data ?? []) as TagRow[]).map((r) => toTag(r, counts.get(r.id) ?? 0)),
    total,
    untagged: Math.max(0, total - tagged.size),
  };
}

/** Which tags each of these briefs carries. */
export async function tagsOfBriefs(briefIds: string[], db?: SupabaseClient): Promise<BriefTags> {
  const out: BriefTags = {};
  if (briefIds.length === 0) return out;
  const { data, error } = await (db ?? createAdminSupabase())
    .from("brief_tags")
    .select("brief_id, tag_id")
    .in("brief_id", briefIds);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { brief_id: string; tag_id: string }[]) (out[r.brief_id] ??= []).push(r.tag_id);
  return out;
}

/** The person's briefs in one folder. Null when the tag isn't theirs. */
export async function briefIdsOfTag(userId: string, tagId: string, db?: SupabaseClient): Promise<string[] | null> {
  const admin = db ?? createAdminSupabase();
  const tag = await admin.from("tags").select("id").eq("id", tagId).eq("user_id", userId).maybeSingle();
  if (tag.error || !tag.data) return null;
  const { data, error } = await admin.from("brief_tags").select("brief_id").eq("tag_id", tagId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { brief_id: string }[]).map((r) => r.brief_id);
}

/** Every brief of the person's that carries at least one tag. */
export async function taggedBriefIds(userId: string, db?: SupabaseClient): Promise<string[]> {
  const { data, error } = await (db ?? createAdminSupabase())
    .from("brief_tags")
    .select("brief_id, tags!inner(user_id)")
    .eq("tags.user_id", userId);
  if (error) throw new Error(error.message);
  return [...new Set(((data ?? []) as unknown as { brief_id: string }[]).map((r) => r.brief_id))];
}

export type CreateTagResult = { ok: true; tag: Tag } | { ok: false; reason: "exists" | "limit" | "error" };

export async function createTag(userId: string, name: string, color?: TagColor): Promise<CreateTagResult> {
  const db = createAdminSupabase();
  const existing = await db.from("tags").select("color").eq("user_id", userId);
  if (existing.error) return { ok: false, reason: "error" };
  const rows = (existing.data ?? []) as { color: string }[];
  if (rows.length >= MAX_TAGS) return { ok: false, reason: "limit" };

  const { data, error } = await db
    .from("tags")
    .insert({ user_id: userId, name, color: color ?? nextTagColor(rows) })
    .select("id, name, color")
    .single();
  if (isUniqueViolation(error)) return { ok: false, reason: "exists" };
  if (error || !data) return { ok: false, reason: "error" };
  return { ok: true, tag: toTag(data as TagRow) };
}

export type WriteResult = "ok" | "missing" | "exists" | "error";

/** Rename or recolour one of your tags. */
export async function updateTag(
  userId: string,
  tagId: string,
  patch: { name?: string; color?: TagColor },
): Promise<WriteResult> {
  const { data, error } = await createAdminSupabase()
    .from("tags")
    .update(patch)
    .eq("id", tagId)
    .eq("user_id", userId)
    .select("id");
  if (isUniqueViolation(error)) return "exists";
  if (error) return "error";
  return data && data.length > 0 ? "ok" : "missing";
}

/** Remove one of your tags. Its briefs stay; they only lose the tag. */
export async function deleteTag(userId: string, tagId: string): Promise<WriteResult> {
  const { data, error } = await createAdminSupabase()
    .from("tags")
    .delete()
    .eq("id", tagId)
    .eq("user_id", userId)
    .select("id");
  if (error) return "error";
  return data && data.length > 0 ? "ok" : "missing";
}

/**
 * Put one of your tags on (or take it off) some of your briefs. Briefs that
 * aren't yours are dropped quietly, so this never confirms that one exists.
 */
export async function setBriefsTag(
  userId: string,
  tagId: string,
  briefIds: string[],
  on: boolean,
): Promise<WriteResult> {
  const db = createAdminSupabase();
  const tag = await db.from("tags").select("id").eq("id", tagId).eq("user_id", userId).maybeSingle();
  if (tag.error) return "error";
  if (!tag.data) return "missing";
  if (briefIds.length === 0) return "ok";

  const mine = await db.from("briefs").select("id").eq("user_id", userId).in("id", briefIds);
  if (mine.error) return "error";
  const ids = ((mine.data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return "ok";

  const { error } = on
    ? await db
        .from("brief_tags")
        .upsert(
          ids.map((brief_id) => ({ brief_id, tag_id: tagId })),
          { onConflict: "brief_id,tag_id", ignoreDuplicates: true },
        )
    : await db.from("brief_tags").delete().eq("tag_id", tagId).in("brief_id", ids);
  return error ? "error" : "ok";
}
