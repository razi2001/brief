"use client";

import { useState } from "react";
import type { PodiumEntry } from "@/lib/org-server";
import Avatar from "./Avatar";
import { Hatted } from "./PodiumHats";
import { copyInviteLink } from "./DashboardFun";

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

/**
 * What each place has to say - fifty lines, a new one every few seconds. The
 * ribbing points up, never down: first brags, second schemes, third is just
 * happy to be here.
 */
const QUIPS: Record<1 | 2 | 3, string[]> = {
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
  2: [
    "second place is first place with better work-life balance.",
    "silver is the new gold. i've decided.",
    "i'm not losing. i'm drafting.",
    "one more ticket and that crown is mine.",
    "i let them win. for morale.",
    "close enough to smell the crown.",
    "second place, first in our hearts.",
    "the first loser. i'm framing it.",
    "i've been told the view from here is fine.",
    "watch your back, chief.",
    "i'm the plot twist.",
    "silver, like my patience. wearing thin.",
    "technically the best of the rest.",
    "one bad deploy away from first.",
    "second place has more legroom.",
  ],
  3: [
    "bronze is still a medal. i checked.",
    "i'm here for the snacks.",
    "third place, zero regrets.",
    "i found the bugs nobody wanted.",
    "on the podium. that's the tweet.",
    "i'm pacing myself. for years.",
    "bronze age, baby.",
    "this paper crown is load-bearing.",
    "just happy to be nominated.",
    "quality over quantity. that's my story.",
    "they said top 3. they didn't say which.",
    "i peaked. respectfully.",
    "one day this paper crown turns to gold.",
    "at least i'm not fourth.",
    "slow and steady files the ticket.",
  ],
};

/**
 * A speech bubble with one line for this place. The line is picked per page
 * load (the server sends the seed), so it changes when you come back, never
 * while you're reading it - and the server and the browser agree on it.
 */
function Quip({ rank, seed }: { rank: 1 | 2 | 3; seed: number }) {
  const lines = QUIPS[rank];
  const i = Math.abs(seed + rank * 7) % lines.length;
  const first = rank === 1;
  const tint = first ? "rgba(221,105,54,.1)" : "rgba(255,255,255,.85)";
  return (
    <div className="podium-brag relative z-10 mb-2 flex flex-col items-center" style={{ animationDelay: `${900 - (3 - rank) * 200}ms` }}>
      <p
        className={`w-max rounded-2xl px-3 py-1.5 leading-relaxed ${
          first ? "max-w-[17rem] text-xs text-accent" : "max-w-[12rem] text-[11px] text-ink-2 shadow-[0_0_0_1px_rgba(26,22,18,.06)]"
        }`}
        style={{ background: tint }}
      >
        “{lines[i]}”
      </p>
      <span aria-hidden className="h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent" style={{ borderTopColor: tint }} />
    </div>
  );
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
    <div className="inline-flex gap-0.5 rounded-lg bg-cream-2/70 p-0.5">
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
          className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            range === value
              ? "bg-surface text-ink shadow-[0_1px_2px_rgba(26,22,18,.08)]"
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
  inviteSeats = false,
  quipSeed,
}: {
  month: PodiumEntry[];
  all: PodiumEntry[];
  orgName: string;
  /** Show all three steps even with fewer people: an open place becomes a
   *  dashed seat that copies the invite link. The dashboard turns this on, so
   *  the leaderboard is there from the first person. */
  inviteSeats?: boolean;
  /** Picks each place's line; a new one per page load. */
  quipSeed?: number;
}) {
  const [range, setRange] = useState<"month" | "all">("month");
  const entries = range === "month" ? month : all;

  // A lone reporter gets their own card. A three-step podium with two empty
  // places would read as broken, and hiding it entirely means the first person
  // in a workspace never finds out the feature is there.
  if (entries.length === 1 && !inviteSeats) {
    return (
      <SoloCard
        entry={entries[0]}
        range={range}
        onRange={setRange}
        orgName={orgName}
      />
    );
  }

  const top = entries.slice(0, 3);
  const rest = entries.slice(3);
  // 2nd, 1st, 3rd - so first place stands in the middle. With only two people
  // there is no third step: rendering an empty cell shoved the pair off to the
  // left and made a two-person podium look broken.
  const order: Array<PodiumEntry | undefined> = inviteSeats
    ? [top[1], top[0], top[2]]
    : top.length >= 3
      ? [top[1], top[0], top[2]]
      : [top[1], top[0]];

  // Whoever is one step off the podium gets a nudge instead of a shrug.
  const nextUp = entries[3];
  const gap = nextUp && top[2] ? top[2].filed - nextUp.filed + 1 : 0;

  return (
    <section className="card animate-rise relative isolate overflow-hidden px-4 py-4">
      <BoardSky />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Quality competition</h2>
          <p className="mt-0.5 text-xs text-muted">
            {orgName} · {entries.length}{" "}
            {entries.length === 1 ? "person" : "people"} finding things wrong
          </p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {/* minmax(0,1fr), not grid-cols-3: a bare 1fr track has min-width:auto,
          so the longest earned title sets the column width and pushes the
          third step off a phone screen. Keyed by range so a switch replays
          the rise. */}
      <ol
        key={range}
        className={`relative mt-5 grid items-end gap-3 ${
          order.length >= 3
            ? "grid-cols-[repeat(3,minmax(0,1fr))]"
            : "mx-auto w-2/3 grid-cols-[repeat(2,minmax(0,1fr))]"
        }`}
      >
        {order.map((entry, i) => {
          if (!entry) return inviteSeats ? <InviteSeat key={`seat-${i}`} rank={[2, 1, 3][i]} /> : <li key={i} aria-hidden />;
          const first = entry.rank === 1;
          // 3rd rises first, then 2nd, then the leader: drumroll order
          const step = entry.rank === 1 ? 2 : entry.rank === 2 ? 1 : 0;
          return (
            <li key={entry.userId} className="relative flex min-w-0 flex-col items-center text-center">
              {entry.rank <= 3 && <Quip rank={entry.rank as 1 | 2 | 3} seed={quipSeed ?? entry.filed} />}
              <div className="animate-rise relative isolate flex flex-col items-center" style={{ animationDelay: `${300 + step * 150}ms` }}>
                {first && <span aria-hidden className="lb-rays" />}
                <Hatted rank={entry.rank}>
                  <Avatar name={entry.name} imageUrl={entry.imageUrl} size={first ? 52 : 42} />
                </Hatted>
              </div>
              <p className="mt-1.5 w-full truncate text-[13px] font-medium">
                <Name entry={entry} />
              </p>
              {entry.title && (
                <p className={`w-full truncate text-xs italic ${first ? "text-accent" : "text-muted"}`}>{entry.title}</p>
              )}
              <Column rank={entry.rank} filed={entry.filed} delay={step * 120} />
            </li>
          );
        })}
      </ol>
      {/* the podium stands in a bank of cloud */}
      <div aria-hidden className="lb-floor relative -mx-4 -mt-4" />

      {rest.length > 0 && (
        // Fits four rows - the common case - and scrolls past that, so a big
        // org can't stretch the card down the page. thin-scroll because the
        // OS default bar reads as a broken widget on the cream surface.
        <ul className="thin-scroll mt-1 max-h-[11rem] overflow-y-auto border-t hairline">
          {rest.map((entry) => (
            <li
              key={entry.userId}
              className="flex items-center gap-2.5 border-b hairline py-2 last:border-b-0"
            >
              <span className="w-4 shrink-0 text-center text-xs text-muted">
                {entry.rank}
              </span>
              <Avatar name={entry.name} imageUrl={entry.imageUrl} size={24} />
              {/* The name and the title share one flexible cell. It has to be
                  here whether or not there IS a title - without it the row
                  collapsed and the avatar drifted into the middle. */}
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-[13px]">
                  <Name entry={entry} />
                </span>
                {entry.title && (
                  <span className="truncate text-[0.6875rem] italic text-muted">
                    {entry.title}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted">{entry.filed}</span>
            </li>
          ))}
        </ul>
      )}

      {gap > 0 && (
        <p className="mt-2.5 text-center text-xs text-muted">
          bronze is {gap} {gap === 1 ? "bug" : "bugs"} away.
        </p>
      )}
    </section>
  );
}

/** Column heights by rank - the stagger IS the podium. */
const HEIGHTS: Record<number, number> = { 1: 104, 2: 76, 3: 56 };

/** A soft rounded column that rises from the baseline: peach for the leader, cream for the rest. */
export function Column({ rank, filed, delay }: { rank: number; filed: number; delay: number }) {
  const first = rank === 1;
  return (
    <div
      className={`podium-block relative mt-2 flex w-[82%] flex-col items-center justify-center gap-0.5 rounded-t-[14px] ${
        first
          ? "bg-[linear-gradient(180deg,#fde4d3_0%,#fad3bb_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
          : "bg-[linear-gradient(180deg,#f6f1e8_0%,#eee6d8_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
      }`}
      style={{ height: HEIGHTS[rank] ?? HEIGHTS[3], animationDelay: `${delay}ms` }}
    >
      {first &&
        [
          [14, 18, 0],
          [78, 30, 0.8],
          [24, 64, 1.6],
          [70, 72, 0.4],
        ].map(([x, y, d], i) => (
          <svg
            key={i}
            aria-hidden
            viewBox="0 0 16 16"
            width={i % 2 ? 9 : 12}
            height={i % 2 ? 9 : 12}
            className="lb-spark absolute"
            style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }}
          >
            <path d="M8 0c.6 4.2 3.2 6.9 8 8-4.8 1.1-7.4 3.8-8 8-.6-4.2-3.2-6.9-8-8 4.8-1.1 7.4-3.8 8-8Z" fill="#ffffff" />
          </svg>
        ))}
      <span className={`font-semibold leading-none tracking-[-0.04em] ${first ? "text-3xl text-accent" : "text-2xl text-ink-2"}`}>{rank}</span>
      <span className={`text-xs ${first ? "text-accent" : "text-muted"}`}>{filed}</span>
    </div>
  );
}

/**
 * An open place on the podium: a dashed ghost on a dashed block. Click it and
 * the invite link is copied - the seat is the invitation.
 */
function InviteSeat({ rank }: { rank: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="relative flex min-w-0 flex-col items-center text-center">
      <button
        type="button"
        onClick={async () => {
          if (await copyInviteLink()) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }
        }}
        className="group flex w-full cursor-pointer flex-col items-center"
      >
        <span className="invite-seat grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-dashed border-[rgba(26,22,18,.22)] bg-surface text-lg text-muted transition-colors group-hover:text-accent">
          +
        </span>
        <span className="mt-1.5 text-[13px] font-medium text-accent">{copied ? "Link copied" : "Invite"}</span>
        <span className="text-[0.6875rem] italic text-muted">seat open</span>
        <span
          className="podium-block mt-2 flex w-[82%] items-center justify-center rounded-t-[14px] border-[1.5px] border-b-0 border-dashed border-[rgba(26,22,18,.16)] bg-white/35 transition-colors group-hover:border-[rgba(221,105,54,.45)]"
          style={{ height: HEIGHTS[rank] ?? HEIGHTS[3] }}
        >
          <span className="text-2xl font-semibold tracking-[-0.04em] text-[rgba(26,22,18,.16)]">{rank}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The board's backdrop: a soft peach sky with a few small clouds drifting
 * across it (the same cloud shapes as the page sky, defined once in
 * CloudBackground).
 */
export function BoardSky() {
  return (
    <div aria-hidden className="lb-sky">
      {[
        [12, 110, 46, -8, "B"],
        [34, 80, 38, -26, "A"],
        [58, 130, 52, -40, "C"],
        [20, 70, 30, -18, "A"],
      ].map(([top, w, dur, delay, shape], i) => (
        <div key={i} className="lb-cloud" style={{ top: `${top}%`, width: w as number, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}>
          <svg viewBox={shape === "B" ? "0 0 240 90" : shape === "A" ? "0 0 200 90" : "0 0 180 80"} className="block h-auto w-full">
            <use href={`#cloud${shape}`} />
          </svg>
        </div>
      ))}
    </div>
  );
}
