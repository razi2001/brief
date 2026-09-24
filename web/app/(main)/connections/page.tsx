import { requireUserId } from "@/lib/auth";
import IntegrationsClient from "@/components/IntegrationsClient";
import TeamList from "@/components/TeamList";
import TicketPreferences from "@/components/TicketPreferences";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgTeam } from "@/lib/org-server";
import { getGuidanceContext } from "@/lib/settings";
import { providerName } from "@/lib/trackers/registry";

export default async function ConnectionsPage() {
  const userId = await requireUserId();
  const [ctx, guidance, team] = await Promise.all([
    getTrackerContext(),
    getGuidanceContext(userId),
    // Best-effort, like the podium: no org, or a failed read, means no section.
    getOrg(userId)
      .then(async (org) => (org ? { org, members: await getOrgTeam(org.key, userId) } : null))
      .catch(() => null),
  ]);

  // GitHub is the only tracker that can be connected without resolving to an
  // org, because a user belongs to several at once. When that's the case the
  // editor offers the picker instead of guessing.
  const needsGithubOrg = ctx.connected.includes("github") && !guidance.hasOrg;

  return (
    // The app shell is wide (for the tickets table); forms read better narrow,
    // so clamp this page and center it in the shell.
    <div className="mx-auto w-full max-w-[760px]">
      <h1 className="font-display text-3xl leading-none text-ink">Settings</h1>

      <div className="mt-7 flex flex-col gap-8">
        <IntegrationsClient />
        {team && (
          <TeamList
            members={team.members}
            orgName={team.org.name}
            providerName={providerName(team.org.provider)}
          />
        )}
        <TicketPreferences {...guidance} needsGithubOrg={needsGithubOrg} />
      </div>
    </div>
  );
}
