"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "./Avatar";
import BashReview from "./BashReview";
import Crumbs from "./Crumbs";
import MoreMenu, { ConfirmItem } from "./MoreMenu";
import { BoardSky, Column } from "./Podium";
import { Hatted } from "./PodiumHats";
import StatusBadge from "./StatusBadge";
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
 * under them), and what was found, as a grid of blocks. Reports whose
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
    <div className="mx-auto w-full max-w-[1040px]">
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
            <button type="button" onClick={() => void copy("report")} className="btn h-8">
              {copied === "report" ? "Copied" : "Copy report"}
            </button>
          )}
          {!closed && (
            <button type="button" onClick={() => void copy("link")} className="btn h-8">
              {copied === "link" ? "Copied" : "Copy invite link"}
            </button>
          )}
          {!closed && bash.joined && yourEnd === null && (
            <button type="button" onClick={() => void post("leave")} disabled={busy} className="btn h-8">
              Leave
            </button>
          )}
          {phase === "upcoming" && !bash.joined && (
            <button type="button" onClick={() => void post("join")} disabled={busy} className="btn-accent h-8">
              Join
            </button>
          )}
          {open && yourEnd === null && (
            <button type="button" onClick={() => void post("start")} disabled={busy} className="btn-accent h-8">
              Start my {lengthLabel(bash.minutes)}
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

      <div className="card mt-5 grid grid-cols-3 divide-x divide-hairline p-0">
        {testing || done ? (
          <Stat label="Your time">
            {testing ? <span className="tabular-nums text-accent">{clock(yourEnd! - now)}</span> : <span>Done</span>}
          </Stat>
        ) : (
          <Stat label="Each">
            <span className="tabular-nums">{lengthLabel(bash.minutes)}</span>
          </Stat>
        )}
        <Stat label={total === 1 ? "Report" : "Reports"}>
          <span className="tabular-nums">{total}</span>
        </Stat>
        <Stat label={bash.people.length === 1 ? "Person" : "People"}>
          <span className="tabular-nums">{bash.people.length}</span>
        </Stat>
      </div>

      <Board people={bash.people} open={open} closed={closed} now={now} />

      <div className="mt-4">
        {bash.review ? (
          <BashReview code={bash.code} review={bash.review} people={bash.people} onChange={refresh} />
        ) : (
          <section aria-label="Found" className="card overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-medium text-ink">Found</h2>
              <span className="text-xs tabular-nums text-muted">
                {blocks.length < total && `${blocks.length} ${blocks.length === 1 ? "bug" : "bugs"} from ${total} reports`}
                {bash.hold && `${blocks.length < total ? " · " : ""}${!closed ? "Held as drafts until the review" : bash.isOwner ? "" : "In review"}`}
              </span>
            </div>
            {total > 0 ? (
              <>
                <ul className="grid grid-cols-1 items-start gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((block) => {
                    const first = block[0];
                    const who = [...new Set(block.map((r) => r.by))];
                    const filed = block.find((r) => r.ticket || r.state);
                    return (
                      <li key={first.id} className="animate-rise flex min-w-0 flex-col rounded-xl border border-hairline bg-surface p-3">
                        {first.shareId ? (
                          <a href={`/b/${first.shareId}`} target="_blank" rel="noreferrer" className="line-clamp-2 text-[14px] leading-snug text-ink no-underline hover:underline">
                            {first.title}
                          </a>
                        ) : (
                          <p className="line-clamp-2 text-[14px] leading-snug text-ink">{first.title}</p>
                        )}
                        {block.length > 1 && (
                          <details className="mt-2">
                            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-accent/10 px-2 py-[1px] text-[11.5px] font-medium text-accent [&::-webkit-details-marker]:hidden">
                              {block.length} similar reports
                            </summary>
                            <ul className="mt-1.5 space-y-1">
                              {block.slice(1).map((r) => (
                                <li key={r.id} className="truncate text-[12.5px] text-ink-2">
                                  {r.shareId ? (
                                    <a href={`/b/${r.shareId}`} target="_blank" rel="noreferrer" className="text-ink-2 no-underline hover:underline">
                                      {r.title}
                                    </a>
                                  ) : (
                                    r.title
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <div className="mt-2.5 flex items-center gap-2 pt-0.5 text-xs text-muted">
                          <span className="flex shrink-0 -space-x-1.5">
                            {who.slice(0, 4).map((i) => (
                              <span key={i} title={bash.people[i]?.name} className="rounded-full ring-2 ring-surface">
                                <Avatar name={bash.people[i]?.name ?? "someone"} imageUrl={bash.people[i]?.imageUrl} size={20} />
                              </span>
                            ))}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {bash.people[who[0]]?.name ?? "someone"}
                            {who.length > 1 && ` +${who.length - 1}`}
                          </span>
                          {filed?.ticket && <span className="shrink-0 font-mono">{filed.ticket}</span>}
                          {filed?.state && (
                            <span className="shrink-0 max-sm:hidden">
                              <StatusBadge color={filed.stateColor || "#2e7d32"}>{filed.state}</StatusBadge>
                            </span>
                          )}
                          <span className="shrink-0 tabular-nums">{ago(first.createdAt, now)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {blocks.length > FIRST_BLOCKS && (
                  <div className="border-t border-hairline px-4 py-2.5 text-center">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[13px] text-muted hover:text-ink">
                      {showAll ? "Show fewer" : `Show all ${blocks.length}`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="px-4 py-10 text-center text-[13.5px] text-muted">{closed ? "Nothing found" : "Nothing yet"}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

type Person = BashSnapshot["people"][number];

/** A person's picture, with a dot while their own clock is running. */
function Face({ p, size, active }: { p: Person; size: number; active: boolean }) {
  return (
    <span className="relative inline-flex">
      <Avatar name={p.name} imageUrl={p.imageUrl} size={size} />
      {active && (
        <span title="Testing now" aria-label="Testing now" className="dot-pulse absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-accent" />
      )}
    </span>
  );
}

/**
 * The board, in the look of Home's podium. Once someone has found something,
 * the first three stand on steps (2nd, 1st, 3rd, so the leader is in the
 * middle), hats on, with their count on the step; everyone else is a row of
 * names under them. Before the first find there is no race to draw yet, so it
 * is just who is in.
 */
function Board({ people, open, closed, now }: { people: Person[]; open: boolean; closed: boolean; now: number }) {
  const active = (p: Person) => open && p.endsAt !== null && now < new Date(p.endsAt).getTime();
  const racing = people.some((p) => p.count > 0);
  const top = racing ? people.slice(0, 3) : [];
  const rest = racing ? people.slice(3) : people;
  // 2nd, 1st, 3rd. With two people there is no third step; with one, one step.
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const placeOf = (p: Person) => top.indexOf(p) + 1;

  return (
    <section aria-label="Board" className="card relative isolate mt-4 overflow-hidden px-4 py-4">
      {racing && <BoardSky />}
      <h2 className="relative text-[13px] font-medium text-ink">Board</h2>

      {racing && (
        <>
          <ol
            className={`relative mx-auto mt-4 grid items-end gap-3 ${
              order.length >= 3 ? "max-w-[560px] grid-cols-[repeat(3,minmax(0,1fr))]" : order.length === 2 ? "max-w-[380px] grid-cols-[repeat(2,minmax(0,1fr))]" : "max-w-[190px] grid-cols-1"
            }`}
          >
            {order.map((p) => {
              const place = placeOf(p);
              const first = place === 1;
              // 3rd rises first, then 2nd, then the leader: drumroll order
              const step = place === 1 ? 2 : place === 2 ? 1 : 0;
              return (
                <li key={place} className="relative flex min-w-0 flex-col items-center text-center">
                  <div className="animate-rise relative isolate flex flex-col items-center" style={{ animationDelay: `${200 + step * 150}ms` }}>
                    {first && <span aria-hidden className="lb-rays" />}
                    <Hatted rank={place}>
                      <Face p={p} size={first ? 52 : 42} active={active(p)} />
                    </Hatted>
                  </div>
                  <p className="mt-1.5 w-full truncate text-[13px] font-medium text-ink">
                    {p.name}
                    {p.isYou && <span className="ml-1 text-[0.6875rem] text-accent">you</span>}
                  </p>
                  <Column rank={place} filed={p.count} delay={step * 120} />
                </li>
              );
            })}
          </ol>
          {/* the podium stands in a bank of cloud */}
          <div aria-hidden className="lb-floor relative -mx-4 -mt-4" />
        </>
      )}

      {rest.length > 0 && (
        <ol className={`relative flex flex-wrap gap-1.5 ${racing ? "mt-1 border-t border-hairline pt-3" : "mt-3"}`}>
          {rest.map((p, i) => (
            <li key={i} className="flex items-center gap-2 rounded-[12px] bg-surface-2 py-1.5 pl-2 pr-3">
              {racing && <span className="w-3.5 shrink-0 text-center text-xs tabular-nums text-muted">{p.rank}</span>}
              <Face p={p} size={24} active={active(p)} />
              <span className="max-w-[160px] truncate text-[13.5px] text-ink">
                {p.name}
                {p.isYou && <span className="ml-1.5 text-xs text-muted">You</span>}
              </span>
              {racing && <span className="text-[13px] tabular-nums text-muted">{p.count}</span>}
            </li>
          ))}
        </ol>
      )}

      {people.length === 0 && <p className="relative py-6 text-center text-[13.5px] text-muted">{closed ? "Nobody took part" : "Nobody has joined yet"}</p>}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{children}</div>
    </div>
  );
}
