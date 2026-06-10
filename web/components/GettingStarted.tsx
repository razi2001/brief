import Link from "next/link";
import type { ReactNode } from "react";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/brief/dbceddgckljkggbghaddpclblfbkmfig";

function StepMarker({ done, n }: { done: boolean; n: number }) {
  if (done) {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(221,105,54,.4)] bg-[rgba(221,105,54,.1)] text-sm text-accent"
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline bg-cream-2 text-xs text-muted"
    >
      {n}
    </span>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <StepMarker done={done} n={n} />
      <div className="min-w-0">
        <p
          className={`text-sm ${done ? "text-muted line-through decoration-hairline" : "text-ink"}`}
        >
          {title}
        </p>
        <div className="mt-1 text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

/**
 * First-run checklist. Rendered only while the user isn't fully set up
 * (see `shouldShow`). Step state is derived purely from props the caller
 * computes from existing data — no logic moves here.
 */
export default function GettingStarted({
  trackerConnected,
  hasBriefs,
  hasFiled,
}: {
  trackerConnected: boolean;
  hasBriefs: boolean;
  hasFiled: boolean;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xs uppercase tracking-[0.15em] text-muted">
        Getting started
      </h2>
      <div className="card mt-3 px-5 py-5 sm:px-6 sm:py-6">
        <p className="font-display text-2xl leading-snug text-ink">
          three steps to your first auto-filed bug.
        </p>
        <ol className="mt-5 flex flex-col gap-5">
          <Step n={1} done={trackerConnected} title="Connect your tracker">
            Link Linear (filing live today) or Jira from{" "}
            <Link
              href="/account"
              className="text-accent no-underline hover:underline"
            >
              connected accounts
            </Link>
            . Brief writes the ticket straight into your tracker.
          </Step>

          <Step n={2} done={hasBriefs} title="Install & pair the Brief extension">
            Add it from the{" "}
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent no-underline hover:underline"
            >
              Chrome Web Store
            </a>
            , click <span className="text-ink">✦</span>, then hit{" "}
            <span className="text-ink">&ldquo;Connect to Brief Cloud&rdquo;</span>{" "}
            in the popup. More at{" "}
            <a
              href="https://get-brief.app"
              target="_blank"
              rel="noreferrer"
              className="text-accent no-underline hover:underline"
            >
              get-brief.app
            </a>
            .
          </Step>

          <Step n={3} done={hasFiled} title="Record a bug → it files itself">
            Hit <span className="text-ink">✦</span>, talk through the bug, then
            stop — the ticket is written and filed automatically. No typing.
          </Step>
        </ol>
      </div>
    </section>
  );
}
