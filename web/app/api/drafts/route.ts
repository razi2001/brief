import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { isUniqueViolation, newShareId } from "@/lib/share-id";
import { track } from "@/lib/events";

// Start a blank draft from the Drafts page. There's no capture to write up, so
// it lands 'drafted' straight away with its share link, and the owner writes it
// on its page (by hand or with the assistant), then exports it like any draft.
// Clerk-session-authed.
export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  const id = randomUUID();
  const insert = () =>
    admin
      .from("briefs")
      .insert({
        id,
        user_id: userId,
        status: "drafted",
        source_kind: "text",
        // The same folder a capture gets; it just holds nothing.
        storage_prefix: `${userId}/${id}`,
        share_id: newShareId(),
      })
      .select("share_id")
      .single();
  let { data, error } = await insert();
  // Another brief already holds that link: take a fresh one.
  if (isUniqueViolation(error)) ({ data, error } = await insert());
  if (error || !data) return Response.json({ error: error?.message ?? "not created" }, { status: 500 });

  track(userId, "brief.created", { kind: "blank" });
  return Response.json({ shareId: data.share_id });
}
