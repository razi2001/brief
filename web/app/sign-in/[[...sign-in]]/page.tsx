import { SignIn } from "@clerk/nextjs";
import StandalonePage, { AuthLinks, AuthTitle } from "@/components/StandalonePage";
import { clerkAuthSheet } from "@/components/clerk-sheet";

export default function Page() {
  return (
    <StandalonePage center>
      <AuthTitle />
      {/* Explicit destinations: new accounts land straight on the /welcome
          onboarding and returning users on the dashboard. Without these,
          Clerk falls back to "/" - a redirect-only page - and the post-
          sign-up navigation could wedge on a blank screen.
          fallback (not force) for sign-in: a ?redirect_url= from a deep link
          or the post-OAuth handshake must win over the default. */}
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpForceRedirectUrl="/welcome"
        appearance={clerkAuthSheet}
      />
      <AuthLinks />
    </StandalonePage>
  );
}
