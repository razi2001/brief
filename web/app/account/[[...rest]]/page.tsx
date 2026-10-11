import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import StandalonePage from "@/components/StandalonePage";
import { clerkProfileSheet } from "@/components/clerk-sheet";

export default function Account() {
  return (
    <StandalonePage
      homeHref="/dashboard"
      right={
        <Link href="/dashboard" className="btn">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
          Back home
        </Link>
      }
    >
      <div className="w-full max-w-[880px]">
        <UserProfile appearance={clerkProfileSheet} />
      </div>
    </StandalonePage>
  );
}
