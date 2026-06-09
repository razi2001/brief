import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";

type AppShellProps = {
  children: ReactNode;
  /** Slot rendered on the right of the header, e.g. a <UserButton /> */
  headerRight?: ReactNode;
};

export default function AppShell({ children, headerRight }: AppShellProps) {
  return (
    <div className="min-h-full bg-cream text-ink">
      <header className="border-b hairline">
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between px-4 py-4">
          <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
            <BrandMark size={28} />
            <span className="font-display text-2xl leading-none text-ink">Brief</span>
          </Link>
          <div className="flex items-center">{headerRight}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 py-10 sm:py-14">
        {children}
      </main>
    </div>
  );
}
