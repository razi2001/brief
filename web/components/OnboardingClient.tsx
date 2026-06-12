"use client";

import dynamic from "next/dynamic";

/**
 * Client-only mount for <Onboarding/>, for the same reason as
 * IntegrationsClient: the wizard drives Clerk's client OAuth flow via
 * useUser(), which can't be server-rendered. The fallback mirrors the card's
 * footprint so the dashboard doesn't jump when it mounts.
 */
const Onboarding = dynamic(() => import("./Onboarding"), {
  ssr: false,
  loading: () => (
    <section className="mt-10">
      <div className="card px-5 py-6 sm:px-7 sm:py-7">
        <div className="h-8 w-56 max-w-full rounded bg-cream-2" />
        <div className="mt-3 h-3 w-72 max-w-full rounded bg-cream-2" />
        <div className="mt-7 h-24 w-full rounded-xl bg-cream-2/60" />
      </div>
    </section>
  ),
});

export default function OnboardingClient(props: {
  initialRole: string;
  greetingName: string;
}) {
  return <Onboarding {...props} />;
}
