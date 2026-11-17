"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import MoreMenu, { ConfirmItem } from "./MoreMenu";
import Avatar from "./Avatar";
import CompetitionPanel from "./CompetitionPanel";
import { Medal } from "./Motion";
import type { PodiumEntry } from "@/lib/org-server";
import { DEFAULT_DURATION, DEFAULT_OPEN_DAYS, lengthLabel } from "@/lib/bash";
import type { BashListItem } from "@/lib/bash-server";
import type { Suggestion } from "@/lib/bash-suggest";

const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
/** "12 Nov to 15 Nov", or one date when it starts and ends the same day. */
function datesOf(b: { startsAt: string; endsAt: string; endedAt: string | null }): string {
  const from = dayOf(b.startsAt);
  const to = dayOf(b.endedAt ?? b.endsAt);
  return from === to ? from : `${from} to ${to}`;
}

/**
 * Where you stand in one quality competition:
 *  - testing: your clock is running;
 *  - todo: you joined, it is open, and you have not started your time;
 *  - invited: you can take part and have not joined (it is not closed);
 *  - joined: you joined one that has not opened yet;
 *  - used: you used your time and it is still open;
 *  - closed: it is over.
 */
type Part = "testing" | "todo" | "invited" | "joined" | "used" | "closed";
function partOf(b: BashListItem): Part {
  if (b.phase === "closed") return "closed";
  if (b.you === "testing") return "testing";
  if (b.you === "done") return "used";
  if (b.you === "none") return "invited";
  return b.phase === "open" ? "todo" : "joined";
}
/** What needs you first comes first. */
const RANK: Record<Part, number> = { testing: 0, todo: 1, invited: 2, joined: 3, used: 4, closed: 5 };

type Tab = "mine" | "team" | "closed";
type Act = "join" | "leave" | "start";
const FAILED: Record<Act | "delete" | "create", string> = {
  join: "Couldn't join. Try again",
  leave: "Couldn't leave. Try again",
  start: "Couldn't start. Try again",
  delete: "Couldn't delete it. Try again",
  create: "Couldn't create it. Try again",
};

/**
 * Quality competition: the quality competitions you can take part in, and two ways to make one.
 *
 * Three tabs:
 *  - Assigned to me: the running and upcoming ones you are in, what needs
 *    you first;
 *  - All: every running or upcoming one in your org, yours included, so you
 *    see what is going on and can join;
 *  - Closed: the ones that are over.
 * Each line is a quality competition: where it stands, its name, its dates, the time each
 * person gets and who is in, with its one action on the right. The whole line
 * opens its page. One you created can be deleted from its menu.
 *
 * "New quality competition" goes to the form (/competition/new). Beside it, when the tickets
 * already filed cluster somewhere, a "Suggested" menu offers those areas as
 * quality competitions: one click creates it (the usual length, open for the usual days,
 * reviewed before filing) and opens it.
 */
/** suggested: the answer the server already kept, drawn with the page; null when it has none yet, and then it is asked once the page shows. */
export default function BashHome({
  bashes,
  suggested = null,
  monthly,
}: {
  bashes: BashListItem[];
  suggested?: Suggestion[] | null;
  /** The team's monthly competition, the one everyone is in: first on the page. */
  monthly?: { month: PodiumEntry[]; all: PodiumEntry[]; orgName: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(suggested ?? []);
  // What the server gave as the page first drew: only without it is it asked.
  const [given] = useState(suggested !== null);

  useEffect(() => {
    // Asked once the page is drawn: reading the tickets takes a few seconds,
    // and an empty answer is a normal one.
    if (given) return;
    let on = true;
    fetch("/api/bashes/suggestions", { credentials: "same-origin" })
      .then((r) => (r.ok && !r.redirected ? r.json() : { suggestions: [] }))
      .then((d: { suggestions?: Suggestion[] }) => {
        if (on && Array.isArray(d.suggestions)) setSuggestions(d.suggestions);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [given]);

  const running = bashes.filter((b) => b.phase !== "closed").sort((a, b) => RANK[partOf(a)] - RANK[partOf(b)]);
  const lists: Record<Tab, BashListItem[]> = {
    mine: running.filter((b) => b.you !== "none"),
    team: running,
    closed: bashes.filter((b) => b.phase === "closed"),
  };
  // Open on what needs you; with nothing of yours, on what you could join.
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (lists.mine.length > 0 ? "mine" : lists.team.length > 0 ? "team" : lists.closed.length > 0 ? "closed" : "mine");
  const tabs: { key: Tab; label: string }[] = [
    { key: "mine", label: "Assigned to me" },
    { key: "team", label: "All" },
    { key: "closed", label: "Closed" },
  ];

  const send = async (url: string, method: string, body?: unknown): Promise<Response | null> => {
    try {
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      // A signed-out call is redirected to the sign-in page, which answers 200.
      return res.ok && !res.redirected ? res : null;
    } catch {
      return null;
    }
  };

  const act = async (what: Act | "delete", code: string) => {
    if (busy) return;
    setBusy(code);
    setError(null);
    const res = what === "delete" ? await send(`/api/bashes/${code}`, "DELETE") : await send(`/api/bashes/${code}/${what}`, "POST");
    if (!res) setError(FAILED[what]);
    // Starting your time takes you to the quality competition, where your clock is.
    if (res && what === "start") router.push(`/competition/${code}`);
    else router.refresh();
    setBusy(null);
  };

  /** A suggested area, made into a quality competition with the usual settings, then opened. */
  const createFrom = async (name: string) => {
    if (busy) return;
    setBusy(`new:${name}`);
    setError(null);
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DEFAULT_OPEN_DAYS, 23, 59, 59);
    const res = await send("/api/bashes", "POST", { name, minutes: DEFAULT_DURATION, startsAt: now.toISOString(), endsAt: end.toISOString() });
    const code = res ? ((await res.json().catch(() => null)) as { code?: string } | null)?.code : null;
    // Stays busy while its page opens, so a second click can't make a second one.
    if (code) return router.push(`/competition/${code}`);
    setError(FAILED.create);
    setBusy(null);
  };

  const items = lists[tab];
  // An area that already has a running quality competition of that name is not offered again.
  const taken = new Set(running.map((b) => b.name.trim().toLowerCase()));
  const offered = suggestions.filter((s) => !taken.has(s.name.trim().toLowerCase()));

  return (
    <div className="w-full">
      <header className="flex items-center justify-between gap-4">
        <h1 className="page-title">Quality competition</h1>
        <span className="flex shrink-0 items-center gap-1.5">
          {offered.length > 0 && <Suggested items={offered} busy={busy} onPick={(name) => void createFrom(name)} />}
          <Link href="/competition/new" className="btn-accent h-[30px] shrink-0">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New quality competition
          </Link>
        </span>
      </header>

      {monthly && (
        <div className="mt-4">
          <CompetitionPanel month={monthly.month} all={monthly.all} orgName={monthly.orgName} quipSeed={new Date().getTime() % 9973} />
        </div>
      )}

      <div role="tablist" aria-label="Quality competitions" className="-ml-2 mt-5 flex flex-wrap items-center gap-0.5">
        {tabs.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`bash-tab-${t.key}`}
              aria-selected={on}
              aria-controls="bash-list"
              onClick={() => setPicked(t.key)}
              className="tab"
            >
              <span className="truncate">{t.label}</span>
              <span className="tab-count">{lists[t.key].length}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[#c62828]">
          {error}
        </p>
      )}

      <div id="bash-list" role="tabpanel" aria-labelledby={`bash-tab-${tab}`} className="mt-4">
        {items.length > 0 ? (
          <ul className="-mx-2.5">
            {items.map((b) => {
              const part = partOf(b);
              return (
                <li
                  key={b.code}
                  className="list-row has-[[aria-expanded=true]]:z-20 max-sm:flex-wrap"
                >
                  {/* The whole line opens the quality competition; its actions sit above that. */}
                  <Link href={`/competition/${b.code}`} aria-label={b.name} className="absolute inset-0 rounded-[inherit]" />
                  <PhaseMark part={part} phase={b.phase} />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                    <span className={`truncate text-[13.5px] leading-snug ${part === "closed" ? "text-ink-2" : "text-ink"}`}>{b.name}</span>
                    <span className="truncate text-xs tabular-nums text-muted">
                      {datesOf(b)} · {lengthLabel(b.minutes)} each · {b.people} {b.people === 1 ? "person" : "people"}
                    </span>
                  </span>
                  <Leaders item={b} />
                  <span className="relative z-10 flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-between max-sm:pl-[30px]">
                    <State item={b} part={part} />
                    <span className="flex items-center gap-1">
                      {part === "todo" && (
                        <button type="button" onClick={() => void act("start", b.code)} disabled={busy === b.code} className="btn-accent h-7 !px-2.5 !py-0">
                          Start {lengthLabel(b.minutes)}
                        </button>
                      )}
                      {part === "testing" && (
                        <Link href={`/competition/${b.code}`} className="btn h-7 !px-2.5 !py-0">
                          Open
                        </Link>
                      )}
                      {part === "invited" && (
                        <button type="button" onClick={() => void act("join", b.code)} disabled={busy === b.code} className="btn-accent h-7 !px-2.5 !py-0">
                          Join
                        </button>
                      )}
                      {part === "joined" && (
                        <button type="button" onClick={() => void act("leave", b.code)} disabled={busy === b.code} className="btn h-7 !px-2.5 !py-0">
                          Leave
                        </button>
                      )}
                      {b.mine ? (
                        <MoreMenu label={`More for ${b.name}`}>
                          {(close) => (
                            <ConfirmItem
                              label="Delete"
                              question="Delete this quality competition?"
                              confirm="Delete"
                              disabled={busy === b.code}
                              onConfirm={() => {
                                close();
                                void act("delete", b.code);
                              }}
                            />
                          )}
                        </MoreMenu>
                      ) : (
                        // Keeps every line's action in the same place.
                        <span aria-hidden className="w-8 max-sm:hidden" />
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-12 text-center">
            <p className="text-[14px] font-medium text-ink">{tab === "mine" ? "Nothing assigned to you" : tab === "team" ? "No quality competition running" : "No closed quality competition"}</p>
          </div>
        )}
      </div>

    </div>
  );
}

const Sparkle = ({ size = 13 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" className="text-accent">
    <path d="M8 1.5c.4 2.9 1.7 4.2 4.6 4.6-2.9.4-4.2 1.7-4.6 4.6-.4-2.9-1.7-4.2-4.6-4.6 2.9-.4 4.2-1.7 4.6-4.6ZM12.5 10.5c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" />
  </svg>
);

/**
 * The suggested quality competitions, behind one button beside "New quality competition": each line
 * is an area the filed tickets cluster in; a click creates it and opens it.
 * Closes on Escape and on a click outside.
 */
function Suggested({ items, busy, onPick }: { items: Suggestion[]; busy: string | null; onPick: (name: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="animate-rise relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`btn h-[30px] gap-1.5 ${open ? "bg-[var(--color-pressed)]" : ""}`}
      >
        <Sparkle />
        Suggested
        <span className="tabular-nums text-faint">{items.length}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Suggested quality competitions" className="menu absolute right-0 top-full z-40 mt-1 w-[280px] p-1">
          {items.map((s) => {
            const creating = busy === `new:${s.name}`;
            return (
              <button
                key={s.name}
                type="button"
                role="menuitem"
                onClick={() => onPick(s.name)}
                disabled={!!busy}
                aria-label={`Create a quality competition for ${s.name}`}
                className="group/s flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-hover)] disabled:cursor-default disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-[12px] tabular-nums text-muted">
                    {s.bugs} {s.bugs === 1 ? "bug" : "bugs"}
                    {s.open > 0 && ` · ${s.open} open`}
                  </span>
                </span>
                <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-muted transition-colors group-hover/s:bg-accent group-hover/s:text-cream">
                  {creating ? (
                    "Creating"
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Create
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Where the quality competition stands, as one small mark before its name. */
function PhaseMark({ part, phase }: { part: Part; phase: BashListItem["phase"] }) {
  if (part === "closed") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="relative shrink-0 text-[#b9b2a4]">
        <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        <path d="M5.2 8.2 7.2 10.2 10.8 6.2" fill="none" stroke="#fffdfa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (phase === "upcoming") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="relative shrink-0 text-muted">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.6 2.1" />
      </svg>
    );
  }
  // Open: a ring, filled while your own clock runs.
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="relative shrink-0 text-accent">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {part === "testing" ? <circle cx="8" cy="8" r="3.2" fill="currentColor" className="dot-pulse" /> : <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />}
    </svg>
  );
}

/** The race at a glance: the first three who found something, and your place once you have one. */
function Leaders({ item: b }: { item: BashListItem }) {
  if (b.top.length === 0) return null;
  const names = b.top.map((p) => `${p.rank}. ${p.isYou ? "You" : p.name}`).join(", ");
  return (
    <span className="flex shrink-0 items-center gap-2 max-sm:hidden" aria-label={`Ranking: ${names}`} title={names}>
      <span className="flex items-center" aria-hidden="true">
        {b.top.map((p, i) => (
          <span key={i} className="ml-1 first:ml-0">
            <Avatar name={p.name} imageUrl={p.imageUrl} size={22} />
          </span>
        ))}
      </span>
      {b.yourRank !== null && (
        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium tabular-nums text-ink-2">
          <Medal rank={b.yourRank} size={15} />
          You #{b.yourRank}
        </span>
      )}
    </span>
  );
}

/** Where the quality competition stands, and you in it, in a few words beside the action. */
function State({ item: b, part }: { item: BashListItem; part: Part }) {
  const quiet = "text-[12.5px] tabular-nums text-muted";
  if (part === "testing") return <span className="text-[12.5px] font-medium text-accent">Testing</span>;
  if (part === "closed") {
    return (
      <span className={quiet}>
        Closed {dayOf(b.endedAt ?? b.endsAt)}
        {b.you !== "none" && " · you took part"}
      </span>
    );
  }
  if (part === "used") return <span className={quiet}>Your time is used</span>;
  if (b.phase === "upcoming") return <span className={quiet}>Starts {dayOf(b.startsAt)}</span>;
  return <span className={quiet}>Open until {dayOf(b.endsAt)}</span>;
}
