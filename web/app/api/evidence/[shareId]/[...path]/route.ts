import { NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * Stable, permanent URLs for a brief's evidence images.
 *
 * Most trackers take an upload and host the image themselves (Linear, Jira,
 * Azure DevOps, ClickUp, Trello). GitHub has no public image-upload API at all,
 * so its screenshots have to be embedded by URL, and Notion falls back to the
 * URL for any file it could not upload (over a free workspace's 5 MiB limit, or
 * refused) - and that URL has to outlive the request that filed the ticket. The share page's signed URLs expire after an hour, which would leave
 * every GitHub issue showing broken images by the next morning.
 *
 * Authorization is the unguessable `share_id`, exactly the trust model the
 * public brief page at /b/[shareId] already uses: holding the link is the
 * permission. No Clerk session is involved, because the readers are GitHub and
 * Notion fetching an <img> server-side.
 */

// Only the exact evidence objects a brief can own - never arbitrary paths.
// Anchored, with no path separators inside the filename, so a crafted
// `..%2f..%2fbrief.json` can't walk out of the brief's own prefix. Notably this
// does NOT expose brief.json or audio.webm, which are internal.
//
// Keyframes are included because a recording-only capture has no screenshots:
// its sampled frames are the evidence, and a tracker that embeds by url (see
// buildGithubEvidence) has nothing else to show.
const ALLOWED =
  /^(screenshots\/[A-Za-z0-9._-]+\.png|keyframes\/[A-Za-z0-9._-]+\.png|replay-frames\/frame-\d{2}\.jpg|screenshot\.png|recording\.(webm|mp4|mov))$/;

// An uploaded recording keeps its own container (see RECORDING_NAMES), so the
// route has to name the type for each one rather than assuming webm.
const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webm: "video/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ shareId: string; path: string[] }> },
) {
  const { shareId, path: segments } = await ctx.params;
  const rel = (segments ?? []).join("/");
  if (!ALLOWED.test(rel)) return new Response("not found", { status: 404 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("storage_prefix")
    .eq("share_id", shareId)
    .maybeSingle();
  if (!brief?.storage_prefix) return new Response("not found", { status: 404 });

  const { data } = await admin.storage
    .from("briefs")
    .download(`${brief.storage_prefix}/${rel}`);
  // A brief whose evidence was deleted (by the owner, or by the post-filing
  // media cleanup) 404s rather than erroring - the ticket keeps its text.
  if (!data) return new Response("not found", { status: 404 });

  const ext = rel.split(".").pop() ?? "";
  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
      // Evidence at a given path is immutable, and these URLs are embedded in
      // tickets that get loaded for years - let every layer cache them hard.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}
