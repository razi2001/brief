"use client";

import dynamic from "next/dynamic";

/**
 * Client-only mount for <Onboarding/>, for the same reason as
 * IntegrationsClient: the wizard drives Clerk's client OAuth flow via
 * useUser(), which can't be server-rendered. The fallback mirrors the
 * full-page footprint so /welcome doesn't jump when it mounts.
 */
const Onboarding = dynamic(() => import("./Onboarding"), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-14">
      <div className="h-12 w-12 rounded-2xl bg-cream-2" />
      <div className="mt-6 h-10 w-72 max-w-full rounded bg-cream-2" />
      <div className="mt-3 h-3 w-80 max-w-full rounded bg-cream-2" />
      <div className="card mt-12 h-64 w-full max-w-[620px] bg-cream-2/40" />
    </main>
  ),
});

export default function OnboardingClient(props: {
  initialRole: string;
  greetingName: string;
}) {
  return <Onboarding {...props} />;
}
