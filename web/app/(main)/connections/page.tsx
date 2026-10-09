import { requireUserId } from "@/lib/auth";
import SettingsView from "@/components/SettingsView";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgReplaySites, getOrgTeam } from "@/lib/org-server";
import { getGuidanceContext, getUserReplaySites } from "@/lib/settings";
import { getGithubToken, listGithubOrgs } from "@/lib/github";

export default async function ConnectionsPage() {
  const userId = await requireUserId();
  const [ctx, guidance, team, mySites] = await Promise.all([
    getTrackerContext(),
    getGuidanceContext(userId),
    // Best-effort, like the podium: no org, or a failed read, means no section.
    getOrg(userId)
      .then(async (org) =>
        org
          ? { org, members: await getOrgTeam(org.key, userId), replaySites: await getOrgReplaySites(org.key) }
          : null,
      )
      .catch(() => null),
    getUserReplaySites(userId),
  ]);

  // GitHub is the only tracker that can be connected without resolving to an
  // org, because a user belongs to several at once. When that's the case the
  // editor offers the picker instead of guessing.
  const needsGithubOrg = ctx.connected.includes("github") && !guidance.hasOrg;
  // Looked up here, not after a click, so the Team row knows whether there is
  // anything to pick before it is opened. Best-effort: a failure means none.
  const githubOrgs = needsGithubOrg
    ? await getGithubToken(userId)
        .then((tok) => (tok ? listGithubOrgs(tok) : []))
        .catch(() => [])
    : [];

  return (
    <SettingsView
      tracker={ctx.connected[0] ?? null}
      team={team}
      githubOrgs={githubOrgs}
      guidance={guidance}
      mySites={mySites}
    />
  );
}
