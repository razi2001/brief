import { cache } from "react";
import { getUserId } from "@/lib/auth";
import { getOrg } from "@/lib/org-server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * The workspace line under the wordmark: your team ("Personal" without one).
 * Streamed in behind Suspense, so the shell never waits on it.
 */
const load = cache(async () => {
  const userId = await getUserId();
  if (!userId) return null;
  const org = await getOrg(userId, createAdminSupabase()).catch(() => null);
  return org ? { org: org.name } : null;
});

export async function SidebarWorkspace() {
  const d = await load();
  return <span className="fade-in mt-1 block truncate text-xs font-medium text-ink-2/60">{d?.org ?? "Personal"}</span>;
}
