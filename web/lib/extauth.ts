import { createAdminSupabase } from "./supabase/server";
import { hashToken } from "./tokens";

// Extract a bearer token from an Authorization header value.
export function bearerFromHeader(h: string | null): string | null {
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}

/**
 * When this user last made a brief: their newest brief, or this token's
 * pairing when they have none (ISO; null when neither is found). The
 * extension's reminder popup counts its quiet week from it.
 */
export async function lastBriefAt(userId: string, token: string): Promise<string | null> {
  const admin = createAdminSupabase();
  const [brief, paired] = await Promise.all([
    admin
      .from("briefs")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("extension_tokens").select("created_at").eq("token_hash", hashToken(token)).maybeSingle(),
  ]);
  const at = (r: { data: unknown }) => (r.data as { created_at?: string } | null)?.created_at ?? null;
  return at(brief) ?? at(paired);
}

// Resolve the Clerk user_id for a valid, non-revoked extension token, else null.
// Touches `last_used_at` on success.
export async function userIdForToken(token: string): Promise<string | null> {
  const admin = createAdminSupabase();
  const tokenHash = hashToken(token);
  const { data } = await admin
    .from("extension_tokens")
    .select("user_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  await admin
    .from("extension_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash);
  return data.user_id as string;
}
