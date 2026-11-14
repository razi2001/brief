import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "./BrandMark";

type StandalonePageProps = {
  children: ReactNode;
  /** Where the brand mark in the top bar points. */
  homeHref?: string;
  /** Slot on the right of the top bar. */
  right?: ReactNode;
  /** Vertically center the content (auth screens), instead of top-aligning it. */
  center?: boolean;
};

/**
 * The frame for pages outside the app shell (sign-in, onboarding, privacy...):
 * a minimal top bar on the frame, matching the AppShell sidebar's brand row,
 * and the page content below it. The page itself supplies the white sheet.
 */
export default function StandalonePage({
  children,
  homeHref = "/",
  right,
  center = false,
}: StandalonePageProps) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col text-ink">
      <header className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5 sm:py-4">
        <Link
          href={homeHref}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 no-underline transition-colors hover:bg-hover"
        >
          <BrandMark size={22} />
          <span className="font-display text-[1.375rem] leading-none text-ink">Brief</span>
        </Link>
        {right}
      </header>
      <main
        className={`flex flex-1 flex-col items-center px-4 pb-16 ${
          center ? "justify-center pt-4 sm:pb-[12vh]" : "pt-4 sm:pt-10"
        }`}
      >
        {children}
      </main>
    </div>
  );
}

/** The white floating sheet, the standalone-page twin of AppShell's `.panel`. */
export const SHEET = "panel w-full rounded-[12px] md:min-h-0";

/** The quiet link row under the sign-in / sign-up sheet. */
export function AuthLinks() {
  return (
    <div className="mt-6 flex items-center gap-3 text-xs text-muted">
      <a
        href="https://youtu.be/dmD8thJvMww"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 no-underline transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none" />
        </svg>
        Watch the demo
      </a>
      <span aria-hidden="true" className="h-3 w-px bg-hairline" />
      <a
        href="https://get-brief.app"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 no-underline transition-colors hover:text-ink"
      >
        get-brief.app
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 5h5v5M19 5l-9 9M12 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
      </a>
    </div>
  );
}

/** The greeting above the sign-in / sign-up sheet. */
export function AuthTitle() {
  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        What&apos;s the <span className="text-accent">brief</span>?
      </h1>
      <p className="mt-2.5 text-[13px] text-muted">Talk through a bug. Your agent writes the ticket.</p>
    </div>
  );
}
