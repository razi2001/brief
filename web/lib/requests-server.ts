import { createAdminSupabase } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin-server";
import { DAILY_LIMIT, isStatus, type RequestItem, type RequestStatus } from "@/lib/requests";

/**
 * Feature requests, read and written with the service-role client. Every entry
 * point takes the signed-in user's id from the route's own auth() call.
 *
 * Requests are anonymous. The sender's id is stored, but only to cap how many
 * they send a day, keep one upvote per person and mark their own as "You". It
 * is never sent to the browser, and nothing here looks anyone up by it.
 */

type Row = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  feature_request_votes: { count: number }[] | null;
};

const PAGE = 500;

/** The whole board, newest first, with who voted for what folded into counts. */
export async function loadRequests(userId: string): Promise<{ items: RequestItem[]; admin: boolean }> {
  const admin = await isAdmin();
  const db = createAdminSupabase();
  const [reqs, votes] = await Promise.all([
    db
      .from("feature_requests")
      .select("id, user_id, title, body, status, created_at, feature_request_votes(count)")
      .order("created_at", { ascending: false })
      .limit(PAGE),
    db.from("feature_request_votes").select("request_id").eq("user_id", userId),
  ]);
  if (reqs.error) throw new Error(reqs.error.message);
  if (votes.error) throw new Error(votes.error.message);

  const rows = (reqs.data ?? []) as unknown as Row[];
  const voted = new Set((votes.data ?? []).map((v: { request_id: string }) => v.request_id));
  const items = rows.map(
    (r): RequestItem => ({
      id: r.id,
      title: r.title,
      body: r.body,
      status: isStatus(r.status) ? r.status : "open",
      createdAt: r.created_at,
      votes: r.feature_request_votes?.[0]?.count ?? 0,
      voted: voted.has(r.id),
      mine: r.user_id === userId,
    }),
  );
  return { items, admin };
}

export type CreateResult = { ok: true; id: string; createdAt: string } | { ok: false; reason: "limit" | "error"; message?: string };

/** A new request, with the sender's own upvote. A handful a day per person. */
export async function createRequest(userId: string, title: string, body: string): Promise<CreateResult> {
  const db = createAdminSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await db
    .from("feature_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (recent.error) return { ok: false, reason: "error", message: recent.error.message };
  if ((recent.count ?? 0) >= DAILY_LIMIT) return { ok: false, reason: "limit" };

  const { data, error } = await db
    .from("feature_requests")
    .insert({ user_id: userId, title, body })
    .select("id, created_at")
    .single();
  if (error || !data) return { ok: false, reason: "error", message: error?.message };

  // Best-effort: a missing vote row only costs the sender's own +1.
  await db.from("feature_request_votes").insert({ request_id: data.id, user_id: userId });
  return { ok: true, id: data.id, createdAt: data.created_at };
}

/** Set whether this person's upvote is on. Idempotent, so a double click can't flip it back. */
export async function setVote(userId: string, requestId: string, voted: boolean): Promise<"ok" | "missing" | "error"> {
  const db = createAdminSupabase();
  if (voted) {
    const { error } = await db
      .from("feature_request_votes")
      .upsert({ request_id: requestId, user_id: userId }, { onConflict: "request_id,user_id", ignoreDuplicates: true });
    if (!error) return "ok";
    // 23503: the request is gone.
    return error.code === "23503" ? "missing" : "error";
  }
  const { error } = await db.from("feature_request_votes").delete().eq("request_id", requestId).eq("user_id", userId);
  return error ? "error" : "ok";
}

/**
 * Remove a request; its votes go with it. Scoped by user_id, so someone else's
 * request answers "missing" exactly like one that is gone and this never
 * confirms that a request exists. Only the owner (`asOwner`, decided by the
 * route's own isAdmin() check, never by anything the browser sends) may remove
 * anyone's: that is how junk gets cleared off an anonymous board.
 */
export async function deleteRequest(
  userId: string,
  requestId: string,
  asOwner = false,
): Promise<"ok" | "missing" | "error"> {
  let query = createAdminSupabase().from("feature_requests").delete().eq("id", requestId);
  if (!asOwner) query = query.eq("user_id", userId);
  const { data, error } = await query.select("id");
  if (error) return "error";
  return data && data.length > 0 ? "ok" : "missing";
}

/** The owner's status change. "missing" when no such request. */
export async function setStatus(requestId: string, status: RequestStatus): Promise<"ok" | "missing" | "error"> {
  const { data, error } = await createAdminSupabase()
    .from("feature_requests")
    .update({ status, status_changed_at: new Date().toISOString() })
    .eq("id", requestId)
    .select("id");
  if (error) return "error";
  return data && data.length > 0 ? "ok" : "missing";
}
