import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import Nav from "./Nav";

type AppShellProps = {
  children: ReactNode;
  /** Slot rendered at the foot of the sidebar, e.g. a <UserButton /> */
  headerRight?: ReactNode;
  /** Under the logo: the workspace you file into. */
  workspace?: ReactNode;
  /** Above the user: tracker and extension status. */
  status?: ReactNode;
  /** Hide the primary Nav (e.g. on sign-in / connect screens). */
  hideNav?: boolean;
};

/**
 * The app frame, Linear-style: a warm sunset-gradient sidebar, and the page
 * laid straight on the sky - the clouds drift right behind it, and only the
 * cards are white. Below sm the sidebar folds into a top bar.
 */
export default function AppShell({ children, headerRight, workspace, status, hideNav = false }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col text-ink sm:flex-row">
      <aside className="sidebar flex shrink-0 items-center gap-3 px-3 py-2.5 sm:sticky sm:top-0 sm:h-dvh sm:w-[248px] sm:flex-col sm:items-stretch sm:gap-0 sm:px-3 sm:py-4">
        <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-2 py-1.5 no-underline transition-colors hover:bg-white/40">
          <BrandMark size={30} />
          <span className="font-display text-[1.875rem] leading-none text-ink">Brief</span>
        </Link>
        {workspace && <div className="hidden sm:block">{workspace}</div>}
        {!hideNav && (
          <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto sm:mt-6 sm:flex-none sm:overflow-visible">
            <Nav />
          </div>
        )}
        {status && <div className="mt-auto hidden sm:block">{status}</div>}
        <div className={`flex items-center sm:mt-3 sm:border-t sm:border-[rgba(26,22,18,.08)] sm:px-2 sm:pt-3 ${status ? "" : "sm:mt-auto"}`}>
          {headerRight}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-8 sm:py-9">{children}</div>
      </main>
    </div>
  );
}
