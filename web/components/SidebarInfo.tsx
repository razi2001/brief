import { cache } from "react";
import { getUserId } from "@/lib/auth";
import { getOrg } from "@/lib/org-server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * The workspace line under the logo: your team, with its initial as a little
 * badge (Linear-style). Streamed in behind Suspense, so the shell never waits
 * on it; if the team can't be resolved the line is simply left out.
 */
const load = cache(async () => {
  const userId = await getUserId();
  if (!userId) return null;
  const org = await getOrg(userId, createAdminSupabase()).catch(() => null);
  return org ? { org: org.name } : null;
});

export async function SidebarWorkspace() {
  const d = await load();
  if (!d) return null;
  return (
    <div className="fade-in mt-4 flex h-8 items-center gap-2.5 px-3 text-sm">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#f08a5a] to-accent text-xs font-semibold text-white">
        {d.org.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 truncate font-medium text-ink">{d.org}</span>
    </div>
  );
}
