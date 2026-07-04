import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import Nav from "./Nav";

type AppShellProps = {
  children: ReactNode;
  /** Slot rendered on the right of the header, e.g. a <UserButton /> */
  headerRight?: ReactNode;
  /** Hide the primary Nav (e.g. on sign-in / connect screens). */
  hideNav?: boolean;
};

export default function AppShell({ children, headerRight, hideNav = false }: AppShellProps) {
  return (
    <div className="min-h-full text-ink">
      <header className="border-b hairline">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
            <BrandMark size={28} />
            <span className="font-display text-2xl leading-none text-ink">Brief</span>
          </Link>
          {!hideNav && (
            <div className="order-3 w-full sm:order-2 sm:w-auto">
              <Nav />
            </div>
          )}
          <div className="order-2 flex items-center sm:order-3">{headerRight}</div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
    </div>
  );
}
