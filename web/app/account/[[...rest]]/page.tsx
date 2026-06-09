import { UserProfile } from "@clerk/nextjs";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";

export default function Account() {
  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="border-b hairline">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
            <BrandMark size={28} />
            <span className="font-display text-2xl leading-none text-ink">Brief</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-xs tracking-wide text-muted hover:text-ink no-underline"
          >
            ← back to dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[760px] flex-col items-center px-4 py-10 sm:py-14">
        <UserProfile />
      </main>
    </div>
  );
}
