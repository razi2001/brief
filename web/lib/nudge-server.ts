import { createAdminSupabase } from "@/lib/supabase/server";
import { loadPeople } from "@/lib/activity-server";
import {
  PUSH_TTL_MS,
  cardStatuses,
  effectiveText,
  isUserId,
  livePush,
  type CardEventRow,
  type CardStatus,
  type NudgeAnswer,
  type NudgePush,
  type NudgeText,
  type PushRow,
} from "@/lib/nudge";

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

/** "Show it now": to these people, or to everyone when userIds is null. */
export async function createPush(userIds: string[] | null): Promise<{ at: string } | null> {
  const rows: { user_id: string | null }[] = userIds ? userIds.map((user_id) => ({ user_id })) : [{ user_id: null }];
  const { data, error } = await createAdminSupabase().from("nudge_pushes").insert(rows).select("created_at");
  if (error || !data?.length) {
    console.warn(`[nudge] push not saved: ${error?.message}`);
    return null;
  }
  return { at: data[0].created_at };
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

export type CardPerson = {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
  extension: boolean;
  lastSeen: string | null;
  /** The owner's newest push that reached them (theirs or everyone's), and what they did with it. */
  card: { at: string; status: CardStatus } | null;
};
export type EveryoneCard = { at: string; shown: number; closed: number; briefed: number } | null;

/** Pushes and their events from the last 90 days. */
async function loadCardRows(): Promise<{ pushes: PushRow[]; events: CardEventRow[] }> {
  try {
    const db = createAdminSupabase();
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const [p, e] = await Promise.all([
      db.from("nudge_pushes").select("id, user_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
      db.from("events").select("user_id, name, props").like("name", "nudge.%").not("props->>push", "is", null).gte("at", since).limit(20000),
    ]);
    const events = ((e.data ?? []) as { user_id: string | null; name: string; props: { push?: unknown } }[])
      .filter((r) => r.user_id && typeof r.props?.push === "string")
      .map((r) => ({ user_id: r.user_id as string, name: r.name, push: r.props.push as string }));
    return { pushes: (p.data ?? []) as PushRow[], events };
  } catch {
    return { pushes: [], events: [] };
  }
}

/** Everyone for /admin/card: paired first, then the most recently seen, with what they did with the card. */
export async function loadCardPeople(): Promise<{ people: CardPerson[]; everyone: EveryoneCard; now: number }> {
  const [{ people }, rows] = await Promise.all([loadPeople(), loadCardRows()]);
  const st = cardStatuses(rows.pushes, rows.events, people.map((p) => p.id));
  const list = people
    .map((p) => ({ id: p.id, name: p.name, email: p.email, image: p.image, extension: p.extension, lastSeen: p.lastSeen, card: st.people[p.id] ?? null }))
    .sort((a, b) => Number(b.extension) - Number(a.extension) || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
  return { people: list, everyone: st.everyone, now: Date.now() };
}
