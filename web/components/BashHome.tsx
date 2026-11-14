"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import MoreMenu, { ConfirmItem } from "./MoreMenu";
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
 * Where you stand in one bug bash:
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
 * Bug bash: the bug bashes you can take part in, and two ways to make one.
 *
 * Three tabs:
 *  - Assigned to me: the running and upcoming ones you are in, what needs
 *    you first;
 *  - All: every running or upcoming one in your org, yours included, so you
 *    see what is going on and can join;
 *  - Closed: the ones that are over.
 * Each line is a bug bash: where it stands, its name, its dates, the time each
 * person gets and who is in, with its one action on the right. The whole line
 * opens its page. One you created can be deleted from its menu.
 *
 * "New bug bash" goes to the form (/bash/new). Under the list, when the
 * tickets already filed cluster somewhere, those areas are offered as bug
 * bashes: one click creates it (the usual length, open for the usual days,
 * reviewed before filing) and opens it.
 */
export default function BashHome({ bashes }: { bashes: BashListItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    // Asked once the page is drawn: reading the tickets takes a few seconds,
    // and an empty answer is a normal one.
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
  }, []);

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
    // Starting your time takes you to the bug bash, where your clock is.
    if (res && what === "start") router.push(`/bash/${code}`);
    else router.refresh();
    setBusy(null);
  };

  /** A suggested area, made into a bug bash with the usual settings, then opened. */
  const createFrom = async (name: string) => {
    if (busy) return;
    setBusy(`new:${name}`);
    setError(null);
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DEFAULT_OPEN_DAYS, 23, 59, 59);
    const res = await send("/api/bashes", "POST", { name, minutes: DEFAULT_DURATION, startsAt: now.toISOString(), endsAt: end.toISOString() });
    const code = res ? ((await res.json().catch(() => null)) as { code?: string } | null)?.code : null;
    // Stays busy while its page opens, so a second click can't make a second one.
    if (code) return router.push(`/bash/${code}`);
    setError(FAILED.create);
    setBusy(null);
  };

  const items = lists[tab];
  // An area that already has a running bug bash of that name is not offered again.
  const taken = new Set(running.map((b) => b.name.trim().toLowerCase()));
  const offered = suggestions.filter((s) => !taken.has(s.name.trim().toLowerCase()));

  return (
    <div className="w-full">
      <header className="flex items-center justify-between gap-4">
        <h1 className="page-title">Bug bash</h1>
        <Link href="/bash/new" className="btn-accent h-[30px] shrink-0">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New bug bash
        </Link>
      </header>

      <div role="tablist" aria-label="Bug bashes" className="-ml-2 mt-4 flex flex-wrap items-center gap-0.5">
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
                  {/* The whole line opens the bug bash; its actions sit above that. */}
                  <Link href={`/bash/${b.code}`} aria-label={b.name} className="absolute inset-0 rounded-[inherit]" />
                  <PhaseMark part={part} phase={b.phase} />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                    <span className={`truncate text-[13.5px] leading-snug ${part === "closed" ? "text-ink-2" : "text-ink"}`}>{b.name}</span>
                    <span className="truncate text-xs tabular-nums text-muted">
                      {datesOf(b)} · {lengthLabel(b.minutes)} each · {b.people} {b.people === 1 ? "person" : "people"}
                    </span>
                  </span>
                  <span className="relative z-10 flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-between max-sm:pl-[30px]">
                    <State item={b} part={part} />
                    <span className="flex items-center gap-1">
                      {part === "todo" && (
                        <button type="button" onClick={() => void act("start", b.code)} disabled={busy === b.code} className="btn-accent h-7 !px-2.5 !py-0">
                          Start {lengthLabel(b.minutes)}
                        </button>
                      )}
                      {part === "testing" && (
                        <Link href={`/bash/${b.code}`} className="btn h-7 !px-2.5 !py-0">
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
                              question="Delete this bug bash?"
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
            <p className="text-[14px] font-medium text-ink">{tab === "mine" ? "Nothing assigned to you" : tab === "team" ? "No bug bash running" : "No closed bug bash"}</p>
          </div>
        )}
      </div>

      {offered.length > 0 && (
        <section aria-labelledby="bash-suggested" className="animate-rise mt-7">
          <h2 id="bash-suggested" className="section-label !items-center !gap-1.5">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true" className="text-accent">
              <path d="M8 1.5c.4 2.9 1.7 4.2 4.6 4.6-2.9.4-4.2 1.7-4.6 4.6-.4-2.9-1.7-4.2-4.6-4.6 2.9-.4 4.2-1.7 4.6-4.6ZM12.5 10.5c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" />
            </svg>
            Suggested
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {offered.map((s) => {
              const creating = busy === `new:${s.name}`;
              return (
                <li key={s.name} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => void createFrom(s.name)}
                    disabled={!!busy}
                    aria-label={`Create a bug bash for ${s.name}`}
                    className="group/s flex w-full items-center gap-3 rounded-[14px] border border-hairline bg-cream py-2.5 pl-3.5 pr-2.5 text-left transition-colors hover:border-[var(--color-line)] disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{s.name}</span>
                      <span className="mt-0.5 block truncate text-[12.5px] tabular-nums text-muted">
                        {s.bugs} {s.bugs === 1 ? "bug" : "bugs"}
                        {s.open > 0 && ` · ${s.open} open`}
                      </span>
                    </span>
                    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-ink-2 transition-colors group-hover/s:bg-accent group-hover/s:text-cream">
                      {creating ? (
                        "Creating"
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Create
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Where the bug bash stands, as one small mark before its name. */
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

/** Where the bug bash stands, and you in it, in a few words beside the action. */
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
