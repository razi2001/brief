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
            Clerk falls back to "/" - a redirect-only page - and the post-
            sign-up navigation could wedge on a blank screen.
            fallback (not force) for sign-in: a ?redirect_url= from a deep link
            or the post-OAuth handshake must win over the default. */}
        <SignIn fallbackRedirectUrl="/dashboard" signUpForceRedirectUrl="/welcome" />
      </div>
      {/* Help first-timers understand Brief without touching the form above. */}
      <div className="mt-8 flex items-center gap-3 text-sm tracking-wide text-muted">
        <a
          href="https://youtu.be/dmD8thJvMww"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          <span aria-hidden="true">🎬</span> Watch the demo
        </a>
        <span aria-hidden="true">&middot;</span>
        <a
          href="https://get-brief.app"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-accent"
        >
          get-brief.app
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 5h5v5M19 5l-9 9M12 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
          </svg>
        </a>
      </div>
    </main>
  );
}
