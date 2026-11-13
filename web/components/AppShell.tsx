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
  /** Extra nav items after the fixed ones, e.g. the owner's All tickets link. */
  navExtra?: ReactNode;
};

/**
 * The app frame, Linear-style: a warm sunset-gradient sidebar, and the page
 * laid straight on the sky - the clouds drift right behind it, and only the
 * cards are white. Below sm the sidebar folds into a top bar.
 */
export default function AppShell({ children, headerRight, workspace, status, hideNav = false, navExtra }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col text-ink sm:flex-row">
      <aside className="sidebar flex shrink-0 items-center gap-3 px-3 py-2.5 sm:sticky sm:top-0 sm:h-dvh sm:w-[248px] sm:flex-col sm:items-stretch sm:gap-0 sm:px-3 sm:py-4">
        {/* One brand block: the mark, the wordmark, and the workspace as a
            quiet line under it (not a second logo). */}
        <Link href="/dashboard" className="flex items-center gap-3 rounded-xl px-2 py-1.5 no-underline transition-colors hover:bg-white/40">
          <BrandMark size={34} className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-[1.75rem] leading-[0.95] text-ink">Brief</span>
            {workspace && <span className="hidden min-w-0 sm:block">{workspace}</span>}
          </span>
        </Link>
        {!hideNav && (
          <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto sm:mt-7 sm:flex sm:min-h-0 sm:flex-col sm:overflow-visible">
            <Nav extra={navExtra} />
          </div>
        )}
        {status && <div className="mt-auto hidden sm:block">{status}</div>}
        <div className={`flex items-center sm:mt-3 sm:border-t sm:border-[rgba(26,22,18,.08)] sm:px-2 sm:pt-3 ${status ? "" : "sm:mt-auto"}`}>
          {headerRight}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="app-page mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-8 sm:py-9">{children}</div>
      </main>
    </div>
  );
}
