import { createAdminSupabase } from "./supabase/server";
import { hashToken } from "./tokens";

// Extract a bearer token from an Authorization header value.
export function bearerFromHeader(h: string | null): string | null {
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
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
