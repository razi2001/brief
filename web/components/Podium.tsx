"use client";

import { useState } from "react";
import type { PodiumEntry } from "@/lib/org-server";

/**
 * "Top brief reporters" - the org leaderboard.
 *
 * The joke is that every title is EARNED from real data (see lib/podium.ts):
 * "the night shift" really is the person filing at 2am, "the novelist" really
 * does write the longest titles. That's what makes them land - they're true.
 *
 * The ribbing points up, never down. The leader gets the crown and the quip;
 * last place gets "still warming up". A leaderboard between colleagues has to
 * be fun for the person at the bottom too.
 */

/** Said by whoever is on top. Picked by rank, so it's stable between renders. */
const BRAGS = [
  "i just write them. someone else has to fix them.",
  "found them all. fixing is a different department.",
  "somebody has to notice. it may as well be me.",
  "i don't break things. i document them breaking.",
];

/** Podium block heights, in order: 2nd, 1st, 3rd. */
const HEIGHTS = ["h-14", "h-[5.5rem]", "h-10"];

function Avatar({ entry, size }: { entry: PodiumEntry; size: number }) {
  const initials = entry.name.slice(0, 2).toUpperCase();
  return entry.imageUrl ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={entry.imageUrl}
      alt=""
      style={{ width: size, height: size }}
      className="mx-auto rounded-full object-cover"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="mx-auto flex items-center justify-center rounded-full bg-[rgba(221,105,54,.12)] text-[0.6875rem] text-accent"
    >
      {initials}
    </span>
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
    <div className="inline-flex overflow-hidden rounded-full border hairline">
      {(
        [
          ["month", "past month"],
          ["all", "all time"],
        ] as const
      ).map(([value, label], i) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={range === value}
          className={`cursor-pointer px-3.5 py-1.5 text-[0.6875rem] uppercase tracking-[0.04em] transition-colors ${
            i > 0 ? "border-l hairline" : ""
          } ${
            range === value
              ? "bg-[rgba(221,105,54,.12)] text-accent"
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
          <h2 className="font-display text-2xl text-ink">top brief reporters</h2>
          <p className="mt-0.5 text-xs text-muted">{orgName} · just you so far</p>
        </div>
        <RangeToggle range={range} onChange={onRange} />
      </div>

      <div className="mt-5 flex flex-col items-center">
        <p className="max-w-xs rounded-2xl bg-[rgba(221,105,54,.1)] px-3.5 py-2 text-center text-xs leading-relaxed text-accent">
          “undisputed. also unopposed.”
        </p>
        <span
          aria-hidden
          className="h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-[rgba(221,105,54,.1)]"
        />
        <span aria-hidden className="mt-1 text-base leading-none text-accent">
          ♔
        </span>
        <div className="mt-1">
          <Avatar entry={entry} size={50} />
        </div>
        <p className="mt-1.5 text-[13px]">
          <Name entry={entry} />
        </p>
        <p className="text-[0.6875rem] italic text-accent">{entry.title}</p>
        <div className="mt-3 flex w-full max-w-[13rem] flex-col items-center justify-center gap-0.5 rounded-t-[10px] bg-[rgba(221,105,54,.14)] py-3">
          <span className="font-display text-lg leading-none text-accent">1</span>
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
}: {
  month: PodiumEntry[];
  all: PodiumEntry[];
  orgName: string;
}) {
  const [range, setRange] = useState<"month" | "all">("month");
  const entries = range === "month" ? month : all;

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

  const top = entries.slice(0, 3);
  const rest = entries.slice(3);
  // 2nd, 1st, 3rd - so first place stands in the middle. With only two people
  // there is no third step: rendering an empty cell shoved the pair off to the
  // left and made a two-person podium look broken.
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : [top[1], top[0]];
  const leader = top[0];
  const brag = BRAGS[(leader?.filed ?? 0) % BRAGS.length];

  // Whoever is one step off the podium gets a nudge instead of a shrug.
  const nextUp = entries[3];
  const gap = nextUp && top[2] ? top[2].filed - nextUp.filed + 1 : 0;

  return (
    <section className="card animate-rise px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">top brief reporters</h2>
          <p className="mt-0.5 text-xs text-muted">
            {orgName} · {entries.length}{" "}
            {entries.length === 1 ? "person" : "people"} finding things wrong
          </p>
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {leader && (
        <div className="mt-5 flex flex-col items-center">
          <p className="max-w-xs rounded-2xl bg-[rgba(221,105,54,.1)] px-3.5 py-2 text-center text-xs leading-relaxed text-accent">
            “{brag}”
          </p>
          <span
            aria-hidden
            className="h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-[rgba(221,105,54,.1)]"
          />
        </div>
      )}

      {/* minmax(0,1fr), not grid-cols-3: a bare 1fr track has min-width:auto,
          so the longest earned title ("the night shift") sets the column width
          and pushes the third step off a phone screen. Clamping the track is
          what lets the names and titles actually truncate. */}
      <ol
        className={`mt-2 grid items-end gap-2.5 ${
          order.length >= 3
            ? "grid-cols-[repeat(3,minmax(0,1fr))]"
            : "mx-auto w-2/3 grid-cols-[repeat(2,minmax(0,1fr))]"
        }`}
      >
        {order.map((entry, i) =>
          entry ? (
            <li key={entry.userId} className="text-center">
              {i === 1 && (
                <span aria-hidden className="block text-base leading-none text-accent">
                  ♔
                </span>
              )}
              <div className="mt-1">
                <Avatar entry={entry} size={i === 1 ? 50 : 40} />
              </div>
              <p className="mt-1.5 truncate text-[13px]">
                <Name entry={entry} />
              </p>
              {entry.title && (
                <p
                  className={`truncate text-[0.6875rem] italic ${
                    i === 1 ? "text-accent" : "text-muted"
                  }`}
                >
                  {entry.title}
                </p>
              )}
              <div
                className={`mt-2 flex flex-col items-center justify-center gap-0.5 rounded-t-[10px] ${
                  HEIGHTS[i]
                } ${i === 1 ? "bg-[rgba(221,105,54,.14)]" : "bg-[rgba(26,22,18,.05)]"}`}
              >
                <span
                  className={`font-display leading-none ${
                    i === 1 ? "text-lg text-accent" : "text-base text-ink-2"
                  }`}
                >
                  {entry.rank}
                </span>
                <span
                  className={`text-[0.6875rem] ${i === 1 ? "text-accent" : "text-muted"}`}
                >
                  {entry.filed}
                </span>
              </div>
            </li>
          ) : (
            <li key={i} aria-hidden />
          ),
        )}
      </ol>

      {rest.length > 0 && (
        <ul className="mt-0.5 border-t hairline">
          {rest.map((entry) => (
            <li
              key={entry.userId}
              className="flex items-center gap-2.5 border-b hairline py-2 last:border-b-0"
            >
              <span className="w-4 text-center text-xs text-muted">{entry.rank}</span>
              <Avatar entry={entry} size={24} />
              <span className="text-[13px]">
                <Name entry={entry} />
              </span>
              {entry.title && (
                <span className="flex-1 truncate text-[0.6875rem] italic text-muted">
                  {entry.title}
                </span>
              )}
              <span className="ml-auto text-xs text-muted">{entry.filed}</span>
            </li>
          ))}
        </ul>
      )}

      {gap > 0 && (
        <p className="mt-3 text-center text-xs text-muted">
          bronze is {gap} {gap === 1 ? "bug" : "bugs"} away.
        </p>
      )}
    </section>
  );
}
