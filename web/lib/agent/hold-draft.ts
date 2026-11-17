import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation, newShareId } from "@/lib/share-id";
import { mergeBriefOverrides, type BriefOverrides } from "@/lib/agent/overrides";

/**
 * Get a brief ready to be written up as a draft when its reporter asked for a
 * TICKET but is in a live quality competition: the session holds every report for one
 * review at the end, so nothing reaches the tracker yet.
 *
 * The same preparation the /draft route does for "Share link": the popup's
 * edits are merged into the stored brief.json (the write reads it fresh), the
 * row is marked as being written, and the share token is kept or minted. The
 * caller starts the write.
 */
export async function holdAsDraft(
  admin: SupabaseClient,
  userId: string,
  briefId: string,
  existing: { share_id: string | null; storage_prefix: string },
  overrides: BriefOverrides,
  title: string,
): Promise<string> {
  const prefix = existing.storage_prefix;
  try {
    const { data: blob } = await admin.storage.from("briefs").download(`${prefix}/brief.json`);
    const raw = blob ? JSON.parse(await blob.text()) : {};
    await admin.storage
      .from("briefs")
      .upload(`${prefix}/brief.json`, JSON.stringify(mergeBriefOverrides(raw, overrides), null, 2), {
        contentType: "application/json",
        upsert: true,
      });
  } catch {
    /* best-effort: the write still runs from whatever brief.json exists */
  }

  let shareId = existing.share_id || newShareId();
  const markWriting = () =>
    admin
      .from("briefs")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
        share_id: shareId,
        ...(title ? { title } : {}),
      })
      .eq("id", briefId)
      .eq("user_id", userId);
  const { error } = await markWriting();
  if (isUniqueViolation(error)) {
    shareId = newShareId();
    await markWriting();
  }
  return shareId;
}
