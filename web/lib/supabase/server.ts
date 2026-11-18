import { createClient } from "@supabase/supabase-js";

/**
 * Options for the service-role client. `autoRefreshToken` defaults to true and
 * starts a refresh timer that keeps every client alive: ~12 KB per call that
 * never comes back, which filled the heap and crashed a filing on 2026-11-18.
 * A service-role key has no session to refresh, so the timer does nothing here.
 */
const ADMIN_CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

// Service-role client - bypasses RLS. Use ONLY in server code after auth checks.
export function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ADMIN_CLIENT_OPTIONS,
  );
}
