import Link from "next/link";
import FreshOnReturn from "@/components/FreshOnReturn";
import { requireUserId } from "@/lib/auth";
import SettingsView from "@/components/SettingsView";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgReplaySites, getOrgTeam } from "@/lib/org-server";
import { WORKSPACE_NOUN, workspacesToPick } from "@/lib/workspaces";
import { getGuidanceContext, getUserReplay } from "@/lib/settings";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userId = await requireUserId();
  const ctxP = getTrackerContext();
  // Started now, with everything else, not after it: listing a tracker's
  // workspaces can take seconds (GitHub walks pages of repos), and those
  // overlap the rest.
  const pickP = ctxP
    .then(async (ctx) => {
      const provider = ctx.connected[0];
      return provider
        ? { provider, list: await workspacesToPick(userId, provider) }
        : null;
    })
    .catch(() => null);
  const [ctx, guidance, team, me, params] = await Promise.all([
    ctxP,
    getGuidanceContext(userId),
    // Best-effort, like the podium: no org, or a failed read, means no section.
    getOrg(userId)
      .then(async (org) => {
        if (!org) return null;
        const [members, replaySites] = await Promise.all([
          getOrgTeam(org.key, userId),
          getOrgReplaySites(org.key),
        ]);
        return { org, members, replaySites };
      })
      .catch(() => null),
    getUserReplay(userId),
    searchParams,
  ]);

  // A tracker that sees several workspaces can be connected without resolving
  // to an org until the user picks one. When that's the case the Team row
  // offers the picker instead of guessing, and knows whether there is anything
  // to pick before it is opened.
  const pick = guidance.hasOrg ? null : await pickP;
  const workspaces =
    pick && pick.list.length > 0
      ? {
          provider: pick.provider,
          noun: WORKSPACE_NOUN[pick.provider],
          list: pick.list,
        }
      : null;
  // The connect callback lands here with ?pick=<provider> when the account has
  // several workspaces, so the row with the choice opens by itself.
  const openTeam = typeof params.pick === "string" && params.pick !== "";
  // A connect that failed lands here with ?error=, and the tracker card is
  // where that error shows, so its row opens too.
  const openTracker = typeof params.error === "string" && params.error !== "";

  return (
    <>
      <FreshOnReturn renderId={crypto.randomUUID()} />
      <SettingsView
        tracker={ctx.connected[0] ?? null}
        team={team}
        workspaces={workspaces}
        guidance={guidance}
        mySites={me.sites}
        replayMode={me.mode}
        openTeam={openTeam}
        openTracker={openTracker}
      />
      <p className="mt-10 text-[13px]">
        <Link href="/what-we-see" className="text-muted hover:text-ink">
          What the Brief team sees about you
        </Link>
      </p>
    </>
  );
}
