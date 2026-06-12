import { SignIn } from "@clerk/nextjs";
import BrandMark from "@/components/BrandMark";

export default function Page() {
  return (
    <main className="min-h-screen text-ink flex flex-col items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center text-center">
        <BrandMark size={56} />
        <h1 className="font-display mt-6 text-5xl sm:text-6xl leading-tight text-ink">
          what&apos;s the <em className="italic text-accent">brief</em>?
        </h1>
        <p className="mt-3 text-sm tracking-wide text-muted max-w-md">
          Talk through a bug. Your agent writes the ticket.
        </p>
      </div>
      <div className="mt-10">
        {/* Explicit destinations: new accounts land straight on the /welcome
            onboarding and returning users on the dashboard. Without these,
            Clerk falls back to "/" — a redirect-only page — and the post-
            sign-up navigation could wedge on a blank screen.
            fallback (not force) for sign-in: a ?redirect_url= from a deep link
            or the post-OAuth handshake must win over the default. */}
        <SignIn fallbackRedirectUrl="/dashboard" signUpForceRedirectUrl="/welcome" />
      </div>
    </main>
  );
}
