import { requireUserId } from "@/lib/auth";
import SettingsView from "@/components/SettingsView";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgReplaySites, getOrgTeam, githubOrgsToPick } from "@/lib/org-server";
import { getGuidanceContext, getUserReplay } from "@/lib/settings";

export default async function ConnectionsPage() {
  const userId = await requireUserId();
  // Started now, with everything else, not after it: for a GitHub user with no
  // org picked, listing the orgs takes seconds, and those overlap the rest.
  const githubOrgsP = githubOrgsToPick(userId);
  const [ctx, guidance, team, me] = await Promise.all([
    getTrackerContext(),
    getGuidanceContext(userId),
    // Best-effort, like the podium: no org, or a failed read, means no section.
    getOrg(userId)
      .then(async (org) => {
        if (!org) return null;
        const [members, replaySites] = await Promise.all([getOrgTeam(org.key, userId), getOrgReplaySites(org.key)]);
        return { org, members, replaySites };
      })
      .catch(() => null),
    getUserReplay(userId),
  ]);

  // GitHub is the only tracker that can be connected without resolving to an
  // org, because a user belongs to several at once. When that's the case the
  // editor offers the picker instead of guessing; the Team row knows whether
  // there is anything to pick before it is opened.
  const needsGithubOrg = ctx.connected.includes("github") && !guidance.hasOrg;
  const githubOrgs = needsGithubOrg ? await githubOrgsP : [];

  return (
    <SettingsView
      tracker={ctx.connected[0] ?? null}
      team={team}
      githubOrgs={githubOrgs}
      guidance={guidance}
      mySites={me.sites}
      replayMode={me.mode}
    />
  );
}
