"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import BashRace from "./BashRace";
import BashReview from "./BashReview";
import Crumbs from "./Crumbs";
import MoreMenu, { ConfirmItem } from "./MoreMenu";
import { Confetti, CountUp, Medal } from "./Motion";
import StatusBadge from "./StatusBadge";
import { groupOfState } from "@/lib/status-group";
import { clock, lengthLabel, msLeft, phaseOf, reportMarkdown } from "@/lib/bash";
import { blocksOf } from "@/lib/bash-similar";
import type { BashSnapshot } from "@/lib/bash-server";

/** How often the page asks for the board: while your own clock runs, and while you only watch. */
const POLL_MS = { testing: 4000, watching: 15_000 } as const;
/** Blocks of what was found shown at first; the rest is one click away, so the page never becomes an endless list. */
const FIRST_BLOCKS = 12;
/** How often it asks while the review is grouping or a ticket is being created. */
const REVIEW_POLL_MS = 2500;

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * One bug bash: the board of who is in it and found how many (the Home
 * podium's look: the top three on steps with their hats, the others in a row
 * under them), and what was found, one block per bug. Reports whose
 * titles read alike share a block (lib/bash-similar.ts), so the same bug hit
 * by five people is one thing on the page, and only the first blocks show
 * until you ask for all. It has a start date and an end date. Before it opens,
 * people can join (and leave again). While it is open, each person presses
 * Start when they choose and gets their own clock from that moment: nobody
 * has to be there at the same time. Until it closes the page asks for the
 * board again and again, so a brief sent from the extension shows here on its
 * own. Whoever holds the link can join; whoever created it can close it early,
 * or delete it for good, from the menu beside its actions.
 *
 * One that holds its reports keeps them as drafts. Once it is closed, whoever
 * created it gets the review in place of the list (BashReview): the reports in
 * groups of the same bug, to check and file as one ticket each. Everyone else,
 * and a bug bash that doesn't hold, keeps the list, which is also the report
 * to copy.
 */
export default function BashView({ initial }: { initial: BashSnapshot }) {
  const [bash, setBash] = useState(initial);
  // A newer snapshot from the server (a return to this page) replaces it.
  const [from, setFrom] = useState(initial);
  if (from !== initial) {
    setFrom(initial);
    setBash(initial);
  }
  // Time is the server's: each read carries its clock, and this browser only
  // counts the seconds since. A laptop with a wrong clock still ends on time.
  const [now, setNow] = useState(initial.now);
  const offset = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "report" | null>(null);
  const router = useRouter();

  const phase = phaseOf(bash, now);
  const open = phase === "open";
  const closed = phase === "closed";
  const yourEnd = bash.yourEndsAt ? new Date(bash.yourEndsAt).getTime() : null;
  // Your own clock is running; or you have used your time.
  const testing = open && yourEnd !== null && now < yourEnd;
  const done = yourEnd !== null && !testing;
  const total = bash.briefs.length;
  const reviewBusy = !!bash.review && (!bash.review.grouped || bash.review.groups.some((g) => g.filing));
  // What was found, look-alikes together, newest block first.
  const blocks = useMemo(() => blocksOf(bash.briefs), [bash.briefs]);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? blocks : blocks.slice(0, FIRST_BLOCKS);
  // A report that arrived since the last read flashes once in the list.
  const [seenIds, setSeenIds] = useState(() => new Set(initial.briefs.map((b) => b.id)));
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  if (bash.briefs.some((b) => !seenIds.has(b.id))) {
    setFresh(new Set(bash.briefs.filter((b) => !seenIds.has(b.id)).map((b) => b.id)));
    setSeenIds(new Set(bash.briefs.map((b) => b.id)));
  }
  // Confetti for the winners, the first time you open it once it is over.
  const [party, setParty] = useState(false);
  const hasWinner = bash.people.some((p) => p.count > 0);
  useEffect(() => {
    if (!closed || !hasWinner) return;
    const k = `bash-party-${bash.code}`;
    try {
      if (sessionStorage.getItem(k)) return;
    } catch {
      /* no storage: once per visit is fine */
    }
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(k, "1");
      } catch {
        /* same */
      }
      setParty(true);
    }, 450);
    return () => clearTimeout(t);
  }, [closed, bash.code, hasWinner]);

  useEffect(() => {
    if (offset.current === null) offset.current = initial.now - Date.now();
    const t = setInterval(() => setNow(Date.now() + (offset.current ?? 0)), 1000);
    return () => clearInterval(t);
  }, [initial.now]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/bashes/${initial.code}`, { credentials: "same-origin", cache: "no-store" });
      if (res.ok && !res.redirected) {
        const next = (await res.json()) as BashSnapshot;
        offset.current = next.now - Date.now();
        setBash(next);
      }
    } catch {
      /* the next one will do */
    }
  }, [initial.code]);

  // Ask again while it is open, once more as it closes (so the last brief is
  // in), and while the review has something in flight.
  const wasLive = useRef(!closed);
  useEffect(() => {
    const every = !closed ? (testing ? POLL_MS.testing : POLL_MS.watching) : reviewBusy ? REVIEW_POLL_MS : 0;
    if (closed && wasLive.current) void refresh();
    wasLive.current = !closed;
    if (!every) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, every);
    return () => clearInterval(t);
  }, [closed, testing, reviewBusy, refresh]);

  const post = async (action: "join" | "leave" | "start" | "end") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failed = { join: "Couldn't join. Try again", leave: "Couldn't leave. Try again", start: "Couldn't start. Try again", end: "Couldn't close it. Try again" }[action];
    try {
      const res = await fetch(`/api/bashes/${bash.code}/${action}`, { method: "POST", credentials: "same-origin" });
      if (!res.ok || res.redirected) setError(failed);
    } catch {
      setError(failed);
    }
    await refresh();
    setBusy(false);
  };

  /** Delete it for good, then back to the list. */
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bashes/${bash.code}`, { method: "DELETE", credentials: "same-origin" });
      // Stays busy while the list opens.
      if (res.ok && !res.redirected) return router.push("/bash");
    } catch {
      /* same as a refusal */
    }
    setError("Couldn't delete it. Try again");
    setBusy(false);
  };

  const copy = async (what: "link" | "report") => {
    const origin = window.location.origin;
    const text =
      what === "link"
        ? `${origin}/bash/${bash.code}`
        : reportMarkdown({
            name: bash.name,
            minutes: bash.minutes,
            people: bash.people.map((p) => ({ name: p.name, count: p.count })),
            briefs: bash.briefs.map((b) => ({
              title: b.title,
              by: bash.people[b.by]?.name ?? "someone",
              url: b.shareId ? `${origin}/b/${b.shareId}` : undefined,
              ticket: b.ticket,
            })),
          });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="w-full">
      <Crumbs items={[{ label: "Bug bash", href: "/bash" }, { label: bash.name }]} />
      <header className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">{bash.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums text-muted">
            {open ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[12.5px] font-medium text-accent">
                <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                Open
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(26,22,18,0.06)] px-2 py-0.5 text-[12.5px] font-medium text-ink-2">
                <span className={`h-1.5 w-1.5 rounded-full ${closed ? "bg-[#b9b2a4]" : "border border-muted"}`} aria-hidden />
                {closed ? "Closed" : "Upcoming"}
              </span>
            )}
            <span>
              {open
                ? `closes in ${clock(msLeft(bash, now))}`
                : closed
                  ? dayOf(bash.endedAt ?? bash.endsAt)
                  : `${dayOf(bash.startsAt)} to ${dayOf(bash.endsAt)}, starts in ${clock(new Date(bash.startsAt).getTime() - now)}`}
            </span>
            <span aria-hidden>·</span>
            <span>{lengthLabel(bash.minutes)} each</span>
            {bash.hold && (
              <>
                <span aria-hidden>·</span>
                <span>Review before filing</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {closed && (
            <button type="button" onClick={() => void copy("report")} className="btn h-[30px]">
              {copied === "report" ? "Copied" : "Copy report"}
            </button>
          )}
          {!closed && (
            <button type="button" onClick={() => void copy("link")} className="btn h-[30px]">
              {copied === "link" ? "Copied" : "Copy invite link"}
            </button>
          )}
          {!closed && bash.joined && yourEnd === null && (
            <button type="button" onClick={() => void post("leave")} disabled={busy} className="btn h-[30px]">
              Leave
            </button>
          )}
          {phase === "upcoming" && !bash.joined && (
            <button type="button" onClick={() => void post("join")} disabled={busy} className="btn-accent h-[30px]">
              Join
            </button>
          )}
          {bash.isOwner && (
            <MoreMenu label="More">
              {(close) => (
                <>
                  {!closed && (
                    <ConfirmItem
                      label="Close"
                      question="Close this bug bash now?"
                      confirm="Close now"
                      disabled={busy}
                      onConfirm={() => {
                        close();
                        void post("end");
                      }}
                    />
                  )}
                  <ConfirmItem label="Delete" question="Delete this bug bash?" confirm="Delete" disabled={busy} onConfirm={() => void remove()} />
                </>
              )}
            </MoreMenu>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-[#c62828]">
          {error}
        </p>
      )}

      {party && <Confetti />}
      <Arena bash={bash} now={now} phase={phase} testing={testing} done={done} yourEnd={yourEnd} busy={busy} onStart={() => void post("start")} />

      <BashRace people={bash.people} briefs={bash.briefs} open={open} closed={closed} now={now} />
      {bash.people.length === 0 && (
        <div className="mt-8 rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-10 text-center">
          <p className="text-[14px] font-medium text-ink">{closed ? "Nobody took part" : "Nobody has joined yet"}</p>
        </div>
      )}

      <div className="mt-8">
        {bash.review ? (
          <BashReview code={bash.code} review={bash.review} people={bash.people} onChange={refresh} />
        ) : (
          <section aria-label="Found">
            <h2 className="section-label">
              Found
              <span className="count">
                {blocks.length < total ? `${blocks.length} ${blocks.length === 1 ? "bug" : "bugs"} from ${total} reports` : total > 0 ? total : ""}
                {bash.hold && `${blocks.length < total || total > 0 ? " · " : ""}${!closed ? "Held as drafts until the review" : bash.isOwner ? "" : "In review"}`}
              </span>
            </h2>
            {total > 0 ? (
              <>
                {/* One block per bug, the way the review shows them: its title on
                    top, and under it every report of it, so a bug five people
                    found is one thing with five lines. A bug with a single
                    report is its head alone: the reporter's face and the age
                    sit there, and the title opens the report. */}
                <ul className="flex flex-col gap-3">
                  {shown.map((block) => {
                    const first = block[0];
                    const filed = block.find((r) => r.ticket || r.state);
                    const single = block.length === 1;
                    return (
                      <li key={first.id} className={`animate-rise min-w-0 rounded-[14px] border border-hairline bg-surface${block.some((r) => fresh.has(r.id)) ? " find-flash" : ""}${single && first.shareId ? " transition-colors duration-100 hover:bg-surface-2" : ""}`}>
                        <div className={`relative flex gap-2.5 px-3.5 ${single ? "items-center py-2.5" : "items-start py-3"}`}>
                          <span className={single ? "flex" : "mt-[3px]"}>
                            {filed?.state ? (
                              <StatusBadge iconOnly kind={groupOfState(filed.state)} color={filed.stateColor || "#2e7d32"} title={filed.state}>
                                {filed.state}
                              </StatusBadge>
                            ) : (
                              <StatusBadge iconOnly kind="draft" color="#8a8378" title="Not filed yet">
                                Not filed yet
                              </StatusBadge>
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            {single && first.shareId ? (
                              <a href={`/b/${first.shareId}`} target="_blank" rel="noreferrer" className="block text-[14px] font-semibold leading-snug text-ink no-underline [overflow-wrap:anywhere] after:absolute after:inset-0">
                                {first.title}
                              </a>
                            ) : (
                              <p className="text-[14px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{first.title}</p>
                            )}
                            {block.length > 1 && (
                              <span className="mt-1 inline-flex h-[22px] items-center rounded-full bg-[var(--color-accent-soft)] px-2 text-[11.5px] font-medium tabular-nums text-accent">
                                {block.length} reports, one bug
                              </span>
                            )}
                          </div>
                          {filed?.ticket && <span className={`shrink-0 font-mono text-xs text-muted max-sm:hidden${single ? "" : " mt-0.5"}`}>{filed.ticket}</span>}
                          {single && (
                            <>
                              <span title={bash.people[first.by]?.name} className="flex shrink-0">
                                <Avatar name={bash.people[first.by]?.name ?? "someone"} imageUrl={bash.people[first.by]?.imageUrl} size={20} />
                              </span>
                              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-faint">{ago(first.createdAt, now)}</span>
                            </>
                          )}
                        </div>
                        {!single && (
                        <ul className="border-t border-hairline py-1">
                          {block.map((r) => (
                            <li key={r.id} className="relative flex min-h-9 items-center gap-2.5 px-3.5 py-1 transition-colors duration-100 hover:bg-hover">
                              <span title={bash.people[r.by]?.name} className="flex shrink-0">
                                <Avatar name={bash.people[r.by]?.name ?? "someone"} imageUrl={bash.people[r.by]?.imageUrl} size={20} />
                              </span>
                              {r.shareId ? (
                                <a href={`/b/${r.shareId}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2 no-underline after:absolute after:inset-0">
                                  {r.title}
                                </a>
                              ) : (
                                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-2">{r.title}</span>
                              )}
                              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-faint">{ago(r.createdAt, now)}</span>
                            </li>
                          ))}
                        </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {blocks.length > FIRST_BLOCKS && (
                  <p className="mt-2">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[13px] text-muted transition-colors hover:text-ink">
                      {showAll ? "Show fewer" : `Show all ${blocks.length}`}
                    </button>
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-12 text-center">
                <p className="text-[14px] font-medium text-ink">{closed ? "Nothing found" : "Nothing yet"}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The top of a bug bash, as a game: your clock as a ring that empties (or the
 * button that starts it), the bugs the team has found so far, who is testing
 * right now, and your own count and place. Once it is over: the winner.
 */
function Arena({
  bash,
  now,
  phase,
  testing,
  done,
  yourEnd,
  busy,
  onStart,
}: {
  bash: BashSnapshot;
  now: number;
  phase: ReturnType<typeof phaseOf>;
  testing: boolean;
  done: boolean;
  yourEnd: number | null;
  busy: boolean;
  onStart: () => void;
}) {
  const open = phase === "open";
  const closed = phase === "closed";
  const total = bash.briefs.length;
  const live = bash.people.filter((p) => open && p.endsAt !== null && now < new Date(p.endsAt).getTime());
  const me = bash.people.find((p) => p.isYou);
  const winner = bash.people[0] && bash.people[0].count > 0 ? bash.people[0] : null;
  const span = bash.minutes * 60_000;
  const left = testing && yourEnd ? Math.max(0, yourEnd - now) : 0;

  return (
    <section aria-label="Arena" className="arena mt-6 flex flex-wrap items-center gap-x-7 gap-y-4 rounded-[16px] border border-hairline bg-surface px-5 py-4">
      <div className="flex items-center gap-3.5">
        {closed ? (
          winner ? (
            <>
              <span className="arena-trophy grid h-[64px] w-[64px] place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#fff4d6,#f6d77a_60%,#e0b347)] shadow-[0_6px_18px_-6px_rgba(201,150,42,.6)]">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#8a5d0f" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>
              </span>
              <span>
                <span className="block text-[12.5px] text-muted">Winner</span>
                <span className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
                  <Avatar name={winner.name} imageUrl={winner.imageUrl} size={22} />
                  {winner.name}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {winner.count} {winner.count === 1 ? "bug" : "bugs"}
                </span>
              </span>
            </>
          ) : (
            <span className="text-[15px] font-medium text-ink">It&apos;s over</span>
          )
        ) : testing ? (
          <Ring progress={span ? left / span : 0} label="Your time">
            <span className="text-[16px] font-semibold tabular-nums tracking-[-0.02em] text-accent">{clock(left)}</span>
          </Ring>
        ) : open && yourEnd === null ? (
          <button type="button" onClick={onStart} disabled={busy} className="arena-start group flex items-center gap-3.5 text-left">
            <span className="arena-go grid h-[64px] w-[64px] place-items-center rounded-full bg-accent text-white shadow-[0_8px_22px_-8px_rgba(221,105,54,.75)] transition-transform duration-200 group-hover:scale-[1.04] group-active:scale-[.96]">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-ink">Start my {lengthLabel(bash.minutes)}</span>
              <span className="block text-[12.5px] text-muted">Your clock starts now</span>
            </span>
          </button>
        ) : done ? (
          <Ring progress={0} label="Your time">
            <span className="text-[13px] font-semibold text-[#2f7d4f]">Done</span>
          </Ring>
        ) : (
          <Ring progress={1} label={phase === "upcoming" ? "Starts in" : "Each"} quiet>
            <span className="text-[13px] font-semibold tabular-nums text-ink">
              {phase === "upcoming" ? clock(new Date(bash.startsAt).getTime() - now) : lengthLabel(bash.minutes)}
            </span>
          </Ring>
        )}
      </div>

      <div className="flex flex-1 flex-wrap items-center justify-end gap-x-8 gap-y-3">
        <Num label={total === 1 ? "Bug found" : "Bugs found"}>
          <CountUp value={total} fromZero />
        </Num>
        {!closed && (
          <Num label="Testing now">
            <span className="flex items-center gap-2" title={live.map((p) => p.name).join(", ")}>
              <CountUp value={live.length} />
              {live.length > 0 && <span className="dot-pulse h-2 w-2 rounded-full bg-accent" aria-hidden />}
            </span>
          </Num>
        )}
        {closed && (
          <Num label={bash.people.length === 1 ? "Person" : "People"}>
            <CountUp value={bash.people.length} fromZero />
          </Num>
        )}
        {me && (
          <Num label="You">
            <span className="flex items-center gap-2">
              <CountUp value={me.count} fromZero />
              {me.count > 0 && <Medal rank={me.rank} size={20} />}
            </span>
          </Num>
        )}
      </div>
    </section>
  );
}

/** A ring that empties as time runs out, a label under it. */
function Ring({ progress, label, quiet = false, children }: { progress: number; label: string; quiet?: boolean; children: React.ReactNode }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <span className="flex items-center gap-3.5">
      <span className="relative grid h-[64px] w-[64px] place-items-center">
        <svg viewBox="0 0 64 64" width="64" height="64" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(26,22,18,.08)" strokeWidth="5" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke={quiet ? "rgba(26,22,18,.18)" : "#dd6936"}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <span className="relative">{children}</span>
      </span>
      <span className="text-[12.5px] text-muted">{label}</span>
    </span>
  );
}

function Num({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{children}</div>
    </div>
  );
}
