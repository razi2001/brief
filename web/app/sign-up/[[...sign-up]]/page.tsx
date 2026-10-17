import { SignUp } from "@clerk/nextjs";
import StandalonePage, { AuthLinks, AuthTitle } from "@/components/StandalonePage";
import { clerkAuthSheet } from "@/components/clerk-sheet";

export default function Page() {
  return (
    <StandalonePage center>
      <AuthTitle />
      {/* New accounts land on /welcome onboarding. force (not fallback) so a
          ?redirect_url= from the extension's /connect handshake doesn't skip
          onboarding for a brand-new user. The extension still gets paired:
          ExtensionTokenSync remembered its id from that redirect and pairs it
          once the account exists (lib/extension-handoff). The "Already have
          an account?" link uses NEXT_PUBLIC_CLERK_SIGN_IN_URL (=/sign-in)
          automatically. */}
      <SignUp forceRedirectUrl="/welcome" fallbackRedirectUrl="/welcome" appearance={clerkAuthSheet} />
      <AuthLinks />
    </StandalonePage>
  );
}
