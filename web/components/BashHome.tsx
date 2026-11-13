"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { lengthLabel } from "@/lib/bash";
import type { BashListItem } from "@/lib/bash-server";

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
const FAILED: Record<Act, string> = { join: "Couldn't join. Try again", leave: "Couldn't leave. Try again", start: "Couldn't start. Try again" };

/**
 * Bug bash: the bug bashes you can take part in, and a button to make one.
 *
 * Three tabs:
 *  - Assigned to me: the running and upcoming ones you are in, what needs
 *    you first;
 *  - All: every running or upcoming one in your org, yours included, so you
 *    see what is going on and can join;
 *  - Closed: the ones that are over.
 * Each line is a bug bash: its name, its dates, the time each person gets and
 * who is in, with where it stands and its one action on the right. The whole
 * line opens its page. "New bug bash" goes to the form (/bash/new).
 */
export default function BashHome({ bashes }: { bashes: BashListItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const act = async (what: Act, code: string) => {
    if (busy) return;
    setBusy(code);
    setError(null);
    let ok = false;
    try {
      const res = await fetch(`/api/bashes/${code}/${what}`, { method: "POST", credentials: "same-origin" });
      ok = res.ok && !res.redirected;
    } catch {
      ok = false;
    }
    if (!ok) setError(FAILED[what]);
    // Starting your time takes you to the bug bash, where your clock is.
    if (ok && what === "start") router.push(`/bash/${code}`);
    else router.refresh();
    setBusy(null);
  };

  const items = lists[tab];

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Bug bash</h1>
        <Link href="/bash/new" className="btn-accent h-8 shrink-0 no-underline">
          New bug bash
        </Link>
      </header>

      <div role="tablist" aria-label="Bug bashes" className="mt-4 flex flex-wrap items-center gap-1.5">
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
              className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[13px] transition-colors ${
                on ? "bg-ink text-cream" : "bg-white/60 text-ink-2 shadow-[0_0_0_1px_rgba(26,22,18,.07)] hover:bg-white hover:text-ink"
              }`}
            >
              <span className="truncate">{t.label}</span>
              <span className={`tabular-nums ${on ? "text-cream/70" : "text-muted"}`}>{lists[t.key].length}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-[13px] text-[#c62828]">{error}</p>}

      <div id="bash-list" role="tabpanel" aria-labelledby={`bash-tab-${tab}`} className="mt-4">
        {items.length > 0 ? (
          <ul className="card divide-y divide-hairline overflow-hidden p-0">
            {items.map((b) => {
              const part = partOf(b);
              return (
                <li key={b.code} className="relative flex items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-2 max-sm:flex-col max-sm:items-stretch sm:px-5">
                  {/* The whole line opens the bug bash; its action sits above that. */}
                  <Link href={`/bash/${b.code}`} aria-label={b.name} className="absolute inset-0" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-display text-[1.25rem] leading-tight ${part === "closed" ? "text-ink-2" : "text-ink"}`}>{b.name}</span>
                    <span className="mt-0.5 block truncate text-xs tabular-nums text-muted">
                      {datesOf(b)} · {lengthLabel(b.minutes)} each · {b.people} {b.people === 1 ? "person" : "people"}
                    </span>
                  </span>
                  <span className="relative z-10 flex shrink-0 items-center gap-3 max-sm:justify-between">
                    <State item={b} part={part} />
                    {part === "todo" && (
                      <button type="button" onClick={() => void act("start", b.code)} disabled={busy === b.code} className="btn-accent h-8">
                        Start {lengthLabel(b.minutes)}
                      </button>
                    )}
                    {part === "testing" && (
                      <Link href={`/bash/${b.code}`} className="btn h-8 no-underline">
                        Open
                      </Link>
                    )}
                    {part === "invited" && (
                      <button type="button" onClick={() => void act("join", b.code)} disabled={busy === b.code} className="btn-accent h-8">
                        Join
                      </button>
                    )}
                    {part === "joined" && (
                      <button type="button" onClick={() => void act("leave", b.code)} disabled={busy === b.code} className="btn h-8">
                        Leave
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-[rgba(26,22,18,0.14)] px-4 py-14 text-center">
            <p className="text-[14px] font-medium text-ink">{tab === "mine" ? "Nothing assigned to you" : tab === "team" ? "No bug bash running" : "No closed bug bash"}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the bug bash stands, and you in it, in a few words beside the action. */
function State({ item: b, part }: { item: BashListItem; part: Part }) {
  if (part === "testing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
        <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        Testing
      </span>
    );
  }
  if (part === "closed") {
    return (
      <span className="text-[13px] text-muted">
        Closed {dayOf(b.endedAt ?? b.endsAt)}
        {b.you !== "none" && " · you took part"}
      </span>
    );
  }
  if (part === "used") return <span className="text-[13px] text-muted">Your time is used</span>;
  if (b.phase === "upcoming") return <span className="text-[13px] tabular-nums text-muted">Starts {dayOf(b.startsAt)}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
      Open until {dayOf(b.endsAt)}
    </span>
  );
}
