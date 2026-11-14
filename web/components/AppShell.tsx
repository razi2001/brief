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
  /** Prefix for the nav's links (the dev preview lives under /dev). */
  navBase?: string;
};

/**
 * The app frame: a quiet sidebar straight on the gray frame, and the page as
 * one white sheet beside it. The sheet fills the window and scrolls on its
 * own, so the sidebar and the sheet's rounded corners never move. Below sm the
 * sidebar folds into a top bar and the page scrolls as a whole.
 */
export default function AppShell({ children, headerRight, workspace, status, hideNav = false, navExtra, navBase = "" }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col text-ink sm:h-dvh sm:flex-row sm:overflow-hidden">
      <aside className="sidebar flex shrink-0 items-center gap-3 px-3 py-2 sm:h-dvh sm:w-[232px] sm:flex-col sm:items-stretch sm:gap-0 sm:px-2.5 sm:pb-2.5 sm:pt-3">
        {/* One brand block: the mark, the wordmark, and the workspace as a
            quiet line under it (not a second logo). */}
        <Link href={`${navBase}/tickets`} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 no-underline transition-colors duration-150 hover:bg-hover">
          <BrandMark size={28} className="shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-[1.375rem] leading-[0.95] text-ink">Brief</span>
            {workspace && <span className="hidden min-w-0 sm:block">{workspace}</span>}
          </span>
        </Link>
        {!hideNav && (
          <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto sm:mt-5 sm:flex sm:min-h-0 sm:flex-col sm:overflow-visible">
            <Nav extra={navExtra} base={navBase} />
          </div>
        )}
        {status && <div className="mt-auto hidden sm:block">{status}</div>}
        <div className={`flex items-center sm:mt-2 sm:px-1.5 sm:pt-1 ${status ? "" : "sm:mt-auto"}`}>{headerRight}</div>
      </aside>
      <main className="min-w-0 flex-1 sm:py-2 sm:pr-2">
        <div className="sheet thin-scroll min-h-full sm:h-full sm:min-h-0 sm:overflow-y-auto">
          <div className="app-page mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-10 sm:py-9">{children}</div>
        </div>
      </main>
    </div>
  );
}
