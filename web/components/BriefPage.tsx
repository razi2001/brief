import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import EvidenceCard from "./EvidenceCard";

/**
 * The public brief page's chrome (app/b/[shareId]): a minimal top bar on the
 * sky (Brief mark + wordmark left, one action right) and the ticket in one
 * white sheet centered on the clouds. Presentational only, so the page and its
 * states (writing / filing / draft / filed / failed) all share one frame.
 */
export function BriefPageFrame({
  signedIn,
  children,
}: {
  /** A signed-in viewer gets "All tickets"; a visitor gets "Try it free". */
  signedIn: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[860px] items-center justify-between gap-3 px-4 pb-3 pt-4 md:px-1">
        <a
          href={signedIn ? "/dashboard" : "https://cloud.get-brief.app"}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 no-underline transition-colors hover:bg-white/50"
        >
          <BrandMark size={22} />
          <span className="font-display text-[1.375rem] leading-none text-ink">Brief</span>
        </a>
        {signedIn ? (
          <a href="/tickets" className="btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            All tickets
          </a>
        ) : (
          <a href="https://cloud.get-brief.app" target="_blank" rel="noreferrer" className="btn">
            Try it free
          </a>
        )}
      </header>
      <main className="panel mx-3 mb-6 flex-1 rounded-[14px] md:mx-auto md:min-h-0 md:w-full md:max-w-[860px]">
        {children}
      </main>
    </div>
  );
}

/** The calm reading column inside the sheet. */
export function ReadingColumn({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[720px] px-5 pb-10 pt-9 sm:px-10 sm:pb-14 sm:pt-12 ${className}`}>{children}</div>;
}

/** Quiet sign-off at the foot of the sheet. */
export function BriefFooter() {
  return (
    <footer className="mx-auto w-full max-w-[720px] px-5 pb-8 sm:px-10">
      <div className="flex items-center gap-2 border-t border-hairline pt-5">
      <a
        href="https://cloud.get-brief.app"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-xs text-muted no-underline transition-colors hover:text-ink-2"
      >
        <BrandMark size={14} className="rounded-[3px]" />
        Captured with Brief
      </a>
      </div>
    </footer>
  );
}

/** Status dot + label, the ticket id in mono, and the date. */
export function TicketMeta({
  stateName,
  stateColor,
  identifier,
  reported,
}: {
  stateName: string;
  stateColor: string;
  identifier?: string | null;
  reported?: string;
}) {
  const sep = <span className="h-3 w-px bg-[rgba(26,22,18,0.14)]" aria-hidden />;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
      <span className="inline-flex items-center gap-2 font-medium text-ink-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: stateColor, boxShadow: `0 0 0 2.5px ${stateColor}26` }}
        />
        {stateName}
      </span>
      {identifier && (
        <>
          {sep}
          <span className="font-mono text-xs text-muted">{identifier}</span>
        </>
      )}
      {reported && (
        <>
          {sep}
          <span>{reported}</span>
        </>
      )}
    </div>
  );
}

export type BriefAsset = {
  url: string;
  filename: string;
  kind: "image" | "video" | "replay";
  voiceUrl?: string;
  path: string;
};

/** The media itself, as a tidy grid of cards: screenshots pair up, replays and
 *  recordings take the full width. */
export function Attachments({
  briefId,
  assets,
  canRemove,
}: {
  briefId: string;
  assets: BriefAsset[];
  canRemove: boolean;
}) {
  if (assets.length === 0) return null;
  const images = assets.filter((a) => a.kind === "image").length;
  return (
    <section className="mt-12">
      <h2 className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
        Attachments
        <span className="text-xs font-normal tabular-nums text-muted">{assets.length}</span>
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {assets.map((a, i) => {
          const wide = a.kind !== "image" || images === 1;
          return (
            <div key={a.path} className={wide ? "sm:col-span-2" : undefined}>
              <EvidenceCard
                briefId={briefId}
                url={a.url}
                filename={a.filename}
                path={a.path}
                kind={a.kind}
                voiceUrl={a.voiceUrl}
                canRemove={canRemove}
                index={i}
                tile={!wide}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
