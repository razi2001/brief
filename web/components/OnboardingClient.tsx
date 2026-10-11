"use client";

import dynamic from "next/dynamic";
import StandalonePage, { SHEET } from "./StandalonePage";

/**
 * Client-only mount for <Onboarding/>, for the same reason as
 * IntegrationsClient: the wizard drives Clerk's client OAuth flow via
 * useUser(), which can't be server-rendered. The fallback mirrors the
 * full-page footprint so /welcome doesn't jump when it mounts.
 */
const Onboarding = dynamic(() => import("./Onboarding"), {
  ssr: false,
  loading: () => (
    <StandalonePage>
      <div className={`${SHEET} max-w-[560px] overflow-hidden`}>
        <div className="px-6 pb-5 pt-7 sm:px-8 sm:pt-8">
          <div className="h-8 w-60 max-w-full rounded-md bg-surface-2" />
          <div className="mt-2.5 h-3 w-72 max-w-full rounded bg-surface-2" />
          <div className="mt-6 h-[18px] w-64 max-w-full rounded bg-surface-2" />
        </div>
        <div className="h-[420px] border-t hairline" />
      </div>
    </StandalonePage>
  ),
});

export default function OnboardingClient(props: {
  initialRole: string;
  initialSource: string;
  greetingName: string;
}) {
  return <Onboarding {...props} />;
}
