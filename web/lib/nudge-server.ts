import { createAdminSupabase } from "@/lib/supabase/server";
import { PUSH_TTL_MS, effectiveText, isUserId, livePush, type NudgeAnswer, type NudgePush, type NudgeText } from "@/lib/nudge";

/**
 * The "Seen a bug?" card's text and pushes, with the service-role client.
 * Reads fail soft (built-in text, no push): the extension must keep working
 * when the DB is down or the migration isn't applied yet.
 */

/** What the owner saved, as typed (empty = built-in). */
export async function getSavedText(): Promise<NudgeText> {
  try {
    const { data } = await createAdminSupabase().from("nudge_settings").select("message, button").eq("id", 1).maybeSingle();
    return { message: data?.message ?? "", button: data?.button ?? "" };
  } catch {
    return { message: "", button: "" };
  }
}

export async function saveText(text: NudgeText): Promise<boolean> {
  const { error } = await createAdminSupabase()
    .from("nudge_settings")
    .upsert({ id: 1, ...text, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) console.warn(`[nudge] text not saved: ${error.message}`);
  return !error;
}

/** "Show it now": to one person, or to everyone when userId is null. */
export async function createPush(userId: string | null): Promise<NudgePush | null> {
  const { data, error } = await createAdminSupabase()
    .from("nudge_pushes")
    .insert({ user_id: userId })
    .select("id, created_at")
    .single();
  if (error || !data) {
    console.warn(`[nudge] push not saved: ${error?.message}`);
    return null;
  }
  return { id: data.id, at: data.created_at };
}

/** When the owner last pushed the card to this person (or to everyone). */
export async function lastPushes(userId: string | null): Promise<{ person: string | null; everyone: string | null }> {
  try {
    const db = createAdminSupabase();
    const [p, e] = await Promise.all([
      userId
        ? db.from("nudge_pushes").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("nudge_pushes").select("created_at").is("user_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { person: p.data?.created_at ?? null, everyone: e.data?.created_at ?? null };
  } catch {
    return { person: null, everyone: null };
  }
}

/** What GET /api/nudge sends this person's extension. */
export async function answerFor(userId: string, now = Date.now()): Promise<NudgeAnswer> {
  const since = new Date(now - PUSH_TTL_MS).toISOString();
  const [saved, push] = await Promise.all([
    getSavedText(),
    (async (): Promise<NudgePush | null> => {
      // the id goes into a PostgREST filter string: Clerk ids only
      if (!isUserId(userId)) return null;
      try {
        const { data } = await createAdminSupabase()
          .from("nudge_pushes")
          .select("id, created_at")
          .or(`user_id.eq.${userId},user_id.is.null`)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ? { id: data.id, at: data.created_at } : null;
      } catch {
        return null;
      }
    })(),
  ]);
  return { ...effectiveText(saved), push: livePush(push, now) };
}
