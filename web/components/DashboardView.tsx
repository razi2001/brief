import Link from "next/link";
import Podium from "./Podium";
import { BugCloud, CountUp, InviteCard, ProofRing, TimeBar } from "./DashboardFun";
import type { RoiSummary } from "@/lib/roi";
import type { PodiumEntry } from "@/lib/org-server";
import { CHROME_STORE_URL } from "@/lib/chrome-store";

/**
 * The Dashboard is a scoreboard, not another ticket list (Tickets is one
 * click away): how many bugs were caught, what that bought, who's leading.
 *
 *  - Not set up yet: a three-step checklist - tracker, extension, first
 *    ticket - each ticked off as it happens, with the one action it needs.
 *  - The 3D podium ("Quality competition"), always, and first on the page:
 *    alone you stand on top and the open places are invite seats; while you're
 *    alone, an invite card says Brief is free.
 *  - The hero under it: the company's return on Brief - tickets filed all time,
 *    time saved (the one estimate, its basis on hover), high-quality tickets
 *    (with video or screenshot), this month - over every bug landing on a cloud.
 */
export type DashboardViewProps = {
  hasTracker: boolean;
  trackerName?: string;
  extensionPaired: boolean;
  filed: number;
  thisWeek: number;
  org: { name: string } | null;
  /** The team's when there is one, otherwise yours. */
  roi: RoiSummary | null;
  boards: { month: PodiumEntry[]; all: PodiumEntry[] };
  /** Picks the leaderboard's lines, fresh per page load. */
  quipSeed?: number;
};

export default function DashboardView(p: DashboardViewProps) {
  const setUp = p.hasTracker && p.extensionPaired && p.filed > 0;
  const caught = p.roi?.filed ?? p.filed;
  const me = p.boards.month.find((e) => e.isYou);
  // nobody else has filed yet: the leaderboard would be you alone, so invite as well
  const alone = p.boards.all.length <= 1;
  const hasBoard = p.boards.month.length > 0 || p.boards.all.length > 0;
  const thisMonth = p.boards.month.reduce((n, e) => n + e.filed, 0);
  const share = p.roi && p.roi.filed ? p.roi.withEvidence / p.roi.filed : 0;
  const workdays = p.roi ? Math.round(p.roi.hoursSaved / 8) : 0;

  // The company's return on Brief, in four numbers.
  const metrics: Array<{ label: string; value: React.ReactNode; sub: React.ReactNode; accent?: boolean; title?: string }> = [
    {
      label: "Tickets filed",
      value: <CountUp to={caught} />,
      sub: "all time",
      accent: true,
    },
    {
      label: "Time saved",
      value: p.roi ? <>~<CountUp to={p.roi.hoursSaved} delay={250} />h</> : "0h",
      sub: p.roi ? (
        <span className="block w-full">
          <TimeBar hours={p.roi.hoursSaved} compact />
          <span className="mt-1.5 block">{workdays > 0 ? `about ${workdays} workday${workdays > 1 ? "s" : ""}` : "writing tickets"}</span>
        </span>
      ) : (
        "writing tickets"
      ),
      title: p.roi?.basis,
    },
    {
      label: "High-quality tickets",
      value: <CountUp to={p.roi?.withEvidence ?? 0} delay={250} />,
      sub: (
        <span className="flex items-center gap-1.5">
          <ProofRing share={share} size={16} />
          {Math.round(share * 100)}% with video or screenshot
        </span>
      ),
    },
    {
      label: "This month",
      value: <CountUp to={thisMonth} delay={250} />,
      sub: "tickets filed",
    },
  ];

  return (
    <div>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Home</h1>
        <Link href="/tickets" className="btn">
          Your tickets <span aria-hidden>→</span>
        </Link>
      </header>

      {/* Quality competition, first thing on the page: the leaderboard from the
          first person, open places are invite seats. */}
      {hasBoard && (
        <section className="mt-7">
          <Podium month={p.boards.month} all={p.boards.all} orgName={p.org?.name ?? "Your team"} inviteSeats quipSeed={p.quipSeed} />
          {p.filed > 0 && (
            <p className="mt-2.5 px-1 text-xs text-muted">
              You · <span className="text-ink">{p.filed}</span> filed
              {p.thisWeek > 0 && <> · <span className="text-ink">{p.thisWeek}</span> this week</>}
              {me && !alone && <> · <span className="text-accent">#{me.rank}</span> this month</>}
            </p>
          )}
        </section>
      )}

      {/* The company's return on Brief - from day one, zero and all. */}
      <section className={`card relative ${hasBoard ? "mt-4" : "mt-7"} overflow-hidden bg-[linear-gradient(180deg,#fdf6ec_0%,#fbf3e8_70%,#f8efe2_100%)]`}>
        <div className="relative z-10 px-7 pb-4 pt-6">
          <p className="text-[13px] font-medium text-ink-2">
            {p.org ? p.org.name : "You"} <span className="font-normal text-muted">with Brief</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} title={m.title} className="min-w-0">
                <dt className="text-xs text-muted">{m.label}</dt>
                <dd
                  className={`mt-1.5 text-[2.5rem] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[2.75rem] ${
                    m.accent ? "text-accent" : "text-ink"
                  }`}
                >
                  {m.value}
                </dd>
                <dd className="mt-2 text-xs text-muted">{m.sub}</dd>
              </div>
            ))}
          </dl>
        </div>
        <BugCloud count={caught} />
      </section>

      {!setUp && <GettingStarted {...p} />}

      {alone && <InviteCard orgName={p.org?.name} />}
    </div>
  );
}

/** Three steps to a first ticket, each done or with its one action. */
function GettingStarted(p: DashboardViewProps) {
  const steps: Array<{ done: boolean; label: string; done_label: string; action?: { href: string; text: string; external?: boolean } }> = [
    {
      done: p.hasTracker,
      label: "Connect your tracker",
      done_label: p.trackerName ? `${p.trackerName} connected` : "Tracker connected",
      action: { href: "/connections#tracker", text: "Connect" },
    },
    {
      done: p.extensionPaired,
      label: "Add the Brief extension to Chrome",
      done_label: "Extension connected",
      action: { href: CHROME_STORE_URL, text: "Get it", external: true },
    },
    {
      done: p.filed > 0,
      label: "File your first ticket",
      done_label: "First ticket filed",
      // A page broken on purpose, to file a first ticket from.
      action: { href: "https://get-brief.app/demo-sandbox", text: "Practice", external: true },
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="relative mt-4">
      <h2 className="mb-2.5 px-1 text-[13px] font-medium text-ink-2">
        Get started <span className="font-normal text-muted">· {steps.filter((s) => s.done).length} of 3</span>
      </h2>
      <ol className="card overflow-hidden">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex items-center gap-3.5 px-5 py-4 ${i > 0 ? "border-t hairline" : ""}`}>
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                s.done ? "bg-[#2e7d32]/12 text-[#2e7d32]" : i === next ? "bg-[rgba(221,105,54,.12)] text-accent" : "bg-cream-2 text-muted"
              }`}
            >
              {s.done ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className={`flex-1 text-sm ${s.done ? "text-muted" : "text-ink"}`}>{s.done ? s.done_label : s.label}</span>
            {!s.done && s.action &&
              (s.action.external ? (
                <a
                  href={s.action.href}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex h-8 items-center rounded-lg px-3.5 text-xs no-underline transition ${
                    i === next ? "bg-accent text-cream hover:brightness-95" : "border hairline text-ink-2 hover:text-ink"
                  }`}
                >
                  {s.action.text}
                </a>
              ) : (
                <Link
                  href={s.action.href}
                  className={`inline-flex h-8 items-center rounded-lg px-3.5 text-xs no-underline transition ${
                    i === next ? "bg-accent text-cream hover:brightness-95" : "border hairline text-ink-2 hover:text-ink"
                  }`}
                >
                  {s.action.text}
                </Link>
              ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
