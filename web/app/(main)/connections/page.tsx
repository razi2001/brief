import { requireUserId } from "@/lib/auth";
import IntegrationsClient from "@/components/IntegrationsClient";
import TicketPreferences from "@/components/TicketPreferences";
import { getTrackerContext } from "@/lib/briefs-server";
import { getGuidanceContext } from "@/lib/settings";

export default async function ConnectionsPage() {
  const userId = await requireUserId();
  const [ctx, guidance] = await Promise.all([
    getTrackerContext(),
    getGuidanceContext(userId),
  ]);

  // GitHub is the only tracker that can be connected without resolving to an
  // org, because a user belongs to several at once. When that's the case the
  // editor offers the picker instead of guessing.
  const needsGithubOrg = ctx.connected.includes("github") && !guidance.hasOrg;

  return (
    // The app shell is wide (for the tickets table); forms read better narrow,
    // so clamp this page and center it in the shell.
    <div className="mx-auto w-full max-w-[760px]">
      <h1 className="font-display text-3xl leading-none text-ink">Connections</h1>

      <div className="mt-7 flex flex-col gap-8">
        <IntegrationsClient />
        <TicketPreferences {...guidance} needsGithubOrg={needsGithubOrg} />
      </div>
    </div>
  );
}
