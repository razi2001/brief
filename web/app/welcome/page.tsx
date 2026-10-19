import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getTrackerContext } from "@/lib/briefs-server";
import { getOrg, getOrgMemberIds, getOrgReplaySites } from "@/lib/org-server";
import { getUserReplay } from "@/lib/settings";
import OnboardingClient from "@/components/OnboardingClient";

/**
 * First-run onboarding, as its own full page. New sign-ups are sent here
 * directly by Clerk (signUpForceRedirectUrl on the sign-in page) - skipping
 * the "/" redirect hop that could leave a fresh session stuck on a blank
 * page - and the dashboard bounces not-yet-onboarded users here too.
 */
export default async function WelcomePage() {
  const userId = await requireUserId();
  const [ctx, team, me] = await Promise.all([
    getTrackerContext(),
    // The Replay step's team, as on Settings. Best-effort: no org, or a failed
    // read, means the user's own sites only.
    getOrg(userId)
      .then(async (org) => {
        if (!org) return null;
        const [members, sites] = await Promise.all([getOrgMemberIds(org.key), getOrgReplaySites(org.key)]);
        return { name: org.name, sites, members: members.length };
      })
      .catch(() => null),
    getUserReplay(userId),
  ]);
  if (ctx.onboarded) redirect("/dashboard");

  return (
    <OnboardingClient
      initialRole={ctx.role}
      initialSource={ctx.source}
      greetingName={ctx.greetingName}
      replay={{ team, mine: me.sites, mode: me.mode }}
    />
  );
}
