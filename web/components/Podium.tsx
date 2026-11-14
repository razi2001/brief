"use client";

import { useEffect, useState } from "react";
import type { PodiumEntry } from "@/lib/org-server";
import Avatar from "./Avatar";
import PodiumBoard from "./PodiumBoard";
import { Hatted } from "./PodiumHats";

/**
 * "Quality competition" - the org leaderboard of top brief reporters.
 *
 * The joke is that every title is EARNED from real data (see lib/podium.ts):
 * "the night shift" really is the person filing at 2am, "the novelist" really
 * does write the longest titles. That's what makes them land - they're true.
 *
 * The ribbing points up, never down. The leader gets the crown and the quip;
 * last place gets "still warming up". A leaderboard between colleagues has to
 * be fun for the person at the bottom too.
 */

/** What the leader has to say: one line per page load. The ribbing points up, never down. */
const QUIPS: Record<1, string[]> = {
  1: [
    "i just write them. someone else has to fix them.",
    "found them all. fixing is a different department.",
    "somebody has to notice. it may as well be me.",
    "i don't break things. i document them breaking.",
    "bugs see me coming and refactor themselves.",
    "my screenshots have screenshots.",
    "i don't find bugs. bugs report to me.",
    "the crown is heavy. the backlog is heavier.",
    "another day, another works-on-my-machine debunked.",
    "call me the exterminator.",
    "i could stop anytime. i won't.",
    "qa stands for quietly ahead.",
    "i've seen things. mostly null pointers.",
    "top of the podium, bottom of the devs' christmas list.",
    "the bugs fear me. the devs fear me more.",
    "i file, therefore i am.",
    "every crash i find is a gift. you're welcome.",
    "i don't chase bugs. they come to me.",
    "first place smells like fresh stack traces.",
    "this crown has googly eyes and i earned every one.",
  ],
};

/**
 * The leader's line, in a bubble over the crown. It is picked per page load (the
 * server sends the seed), so it changes when you come back, never while you're
 * reading it - and the server and the browser agree on it. Only first place
 * speaks: one line is a wink, three are noise.
 */
function quipOf(seed: number) {
  const lines = QUIPS[1];
  return lines[Math.abs(seed + 7) % lines.length];
}

/**
 * Range switch.
 *
 * This used to put the range in the URL, which meant switching it re-ran the
 * entire dashboard server-side - including the live tracker sync for dozens of
 * tickets. Filtering a leaderboard should not cost a Linear round trip per
 * ticket, so both ranges are fetched up front and this just swaps which one is
 * shown. Instant, no request at all.
 */
function RangeToggle({
  range,
  onChange,
}: {
  range: "month" | "all";
  onChange: (r: "month" | "all") => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[8px] bg-[var(--color-hover)] p-0.5">
      {(
        [
          ["month", "past month"],
          ["all", "all time"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={range === value}
          className={`cursor-pointer rounded-[6px] px-2.5 py-1 text-xs font-medium transition-[color,background-color,box-shadow] duration-150 ${
            range === value
              ? "bg-surface text-ink shadow-[0_0_0_1px_rgba(20,18,14,.06),0_1px_2px_rgba(20,18,14,.08)]"
              : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The one-person card.
 *
 * It leans into being alone rather than pretending there's a race - the joke
 * is the point, and it doubles as the nudge that makes the leaderboard appear
 * once a colleague starts filing.
 */
function SoloCard({
  entry,
  range,
  onRange,
  orgName,
}: {
  entry: PodiumEntry;
  range: "month" | "all";
  onRange: (r: "month" | "all") => void;
  orgName: string;
}) {
  return (
    <section className="card animate-rise px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Quality competition</h2>
          <p className="mt-0.5 text-xs text-muted">{orgName} · just you so far</p>
        </div>
        <RangeToggle range={range} onChange={onRange} />
      </div>

      <div className="mt-4 flex flex-col items-center">
        <p className="max-w-xs rounded-2xl bg-[rgba(221,105,54,.1)] px-3.5 py-2 text-center text-xs leading-relaxed text-accent">
          “undisputed. also unopposed.”
        </p>
        <span
          aria-hidden
          className="h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-[rgba(221,105,54,.1)]"
        />
        <div className="mt-1 flex justify-center">
          <Hatted rank={1}>
            <Avatar name={entry.name} imageUrl={entry.imageUrl} size={50} />
          </Hatted>
        </div>
        <p className="mt-1.5 text-[13px]">
          <Name entry={entry} />
        </p>
        <p className="text-[0.6875rem] italic text-accent">{entry.title}</p>
        <div className="mt-3 flex w-full max-w-[13rem] flex-col items-center justify-center gap-0.5 rounded-t-[10px] bg-[rgba(221,105,54,.14)] py-3">
          <span className="text-lg font-semibold leading-none text-accent">1</span>
          <span className="text-[0.6875rem] text-accent">
            {entry.filed} {entry.filed === 1 ? "ticket" : "tickets"}
          </span>
        </div>
      </div>

      <p className="mt-3 border-t hairline pt-3 text-center text-xs text-muted">
        when someone else at {orgName} files one, this turns into a leaderboard.
      </p>
    </section>
  );
}

function Name({ entry }: { entry: PodiumEntry }) {
  return (
    <span className="text-ink">
      {entry.name}
      {entry.isYou && <span className="ml-1 text-[0.6875rem] text-accent">you</span>}
    </span>
  );
}

export default function Podium({
  month,
  all,
  orgName,
  quipSeed,
  active = true,
}: {
  month: PodiumEntry[];
  all: PodiumEntry[];
  orgName: string;
  /** Picks each place's line; a new one per page load. */
  quipSeed?: number;
  /** Shown: climbs since your last look are counted only then. */
  active?: boolean;
}) {
  const [range, setRange] = useState<"month" | "all">("month");
  const entries = range === "month" ? month : all;
  // Who climbed since you last opened the ranking: the places each person had
  // then are kept in this browser, and a climb shows as a green arrow.
  const [climbed, setClimbed] = useState<Record<string, number>>({});
  const ranksKey = entries.map((e) => `${e.userId}:${e.rank}`).join(",");
  useEffect(() => {
    if (!active) return;
    const key = `brief-board-${range}`;
    let before: Record<string, number> = {};
    try {
      before = JSON.parse(localStorage.getItem(key) || "{}");
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries.map((e) => [e.userId, e.rank]))));
    } catch {
      /* no storage: no arrows */
    }
    const up: Record<string, number> = {};
    for (const e of entries) if (before[e.userId] && before[e.userId] > e.rank) up[e.userId] = before[e.userId] - e.rank;
    const t = setTimeout(() => setClimbed(up), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, ranksKey, active]);

  // A lone reporter gets their own card. A three-step podium with two empty
  // places would read as broken, and hiding it entirely means the first person
  // in a workspace never finds out the feature is there.
  if (entries.length === 1) {
    return (
      <SoloCard
        entry={entries[0]}
        range={range}
        onRange={setRange}
        orgName={orgName}
      />
    );
  }

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[14px] font-semibold text-ink">Quality competition</h2>
          <p className="text-[13px] text-muted">
            {orgName} · {entries.length} {entries.length === 1 ? "person" : "people"}
          </p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>
      {/* The same board as a bug bash: keyed by range so a switch replays it. */}
      <div key={range} className="mt-4">
        <PodiumBoard
          quip={entries[0]?.filed ? quipOf(quipSeed ?? entries[0].filed) : undefined}
          rows={entries.map((e) => ({
            key: e.userId,
            name: e.name,
            imageUrl: e.imageUrl,
            count: e.filed,
            rank: e.rank,
            isYou: e.isYou,
            moved: climbed[e.userId],
            badges: e.title ? <span className="race-badge race-badge-title">{e.title}</span> : null,
          }))}
        />
      </div>
    </section>
  );
}



