import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getTrackerContext } from "@/lib/briefs-server";
import OnboardingClient from "@/components/OnboardingClient";

/**
 * First-run onboarding, as its own full page. New sign-ups are sent here
 * directly by Clerk (signUpForceRedirectUrl on the sign-in page) — skipping
 * the "/" redirect hop that could leave a fresh session stuck on a blank
 * page — and the dashboard bounces not-yet-onboarded users here too.
 */
export default async function WelcomePage() {
  await requireUserId();
  const ctx = await getTrackerContext();
  if (ctx.onboarded) redirect("/dashboard");

  return (
    <OnboardingClient
      initialRole={ctx.role}
      initialSource={ctx.source}
      greetingName={ctx.greetingName}
    />
  );
}
