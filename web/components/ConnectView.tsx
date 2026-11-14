import BrandMark from "./BrandMark";
import StandalonePage, { SHEET } from "./StandalonePage";

/** The pairing status sheet, split out so it can be previewed in each state. */
export default function ConnectView({ state }: { state: "idle" | "ok" | "err" }) {
  return (
    <StandalonePage center>
      <div className={`${SHEET} max-w-[400px] px-7 py-8 text-center`}>
        <BrandMark size={36} className="mx-auto" />
        <h1 className="mt-4 page-title">
          Connecting Brief
        </h1>
        {state === "idle" && (
          <p className="mt-2 inline-flex items-center gap-2 text-[13px] text-muted">
            <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Pairing…
          </p>
        )}
        {state === "ok" && (
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="font-medium text-accent">Connected ✓</span> - taking you to your tickets…
          </p>
        )}
        {state === "err" && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Couldn&apos;t reach the extension. Make sure Brief is installed, then try
            again from the extension.
          </p>
        )}
      </div>
    </StandalonePage>
  );
}
