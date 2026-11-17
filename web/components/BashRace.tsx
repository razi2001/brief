"use client";

import { useEffect, useState } from "react";
import PodiumBoard from "./PodiumBoard";
import type { BashSnapshot } from "@/lib/bash-server";

type Person = BashSnapshot["people"][number];
type Brief = BashSnapshot["briefs"][number];

/** Finds this close together make a streak (a flame on the row). */
const STREAK_MS = 10 * 60_000;
/** How long a climb shows its arrow. */
const MOVE_MS = 4500;

/**
 * The race: everyone in the quality competition, ranked, as it happens. A medal for the
 * first three, a bar for how far each is from the leader, a flame while
 * someone is on a streak (two finds in ten minutes), "First find" for whoever
 * found the first bug. When the board changes the rows slide to their new
 * places and whoever climbed shows by how many. Your row is marked, and under
 * it how many more bugs take you up a place.
 */
export default function BashRace({ people, briefs, open, closed = false, now }: { people: Person[]; briefs: Brief[]; open: boolean; closed?: boolean; now: number }) {
  // Who climbed since the last read, by how many places (shown a few seconds).
  const [prev, setPrev] = useState(people);
  const [moves, setMoves] = useState<Record<string, number>>({});
  if (people !== prev) {
    const before = new Map(prev.map((p) => [p.key, p.rank]));
    const next: Record<string, number> = {};
    for (const p of people) {
      const was = before.get(p.key);
      if (was !== undefined && was > p.rank && p.count > 0) next[p.key] = was - p.rank;
    }
    setPrev(people);
    if (Object.keys(next).length) setMoves(next);
  }
  useEffect(() => {
    if (!Object.keys(moves).length) return;
    const t = setTimeout(() => setMoves({}), MOVE_MS);
    return () => clearTimeout(t);
  }, [moves]);

  const firstFind = briefs.length ? briefs[briefs.length - 1].by : -1;
  const streak = (i: number) => briefs.filter((b) => b.by === i && now - new Date(b.createdAt).getTime() < STREAK_MS).length >= 2;
  const testing = (p: Person) => open && p.endsAt !== null && now < new Date(p.endsAt).getTime();
  const me = people.find((p) => p.isYou);
  const above = me ? people.find((p) => p.rank === me.rank - 1) : undefined;

  if (!people.length) return null;
  return (
    <section aria-label="Race" className="mt-8">
      <h2 className="section-label">
        {closed ? "Podium" : "Race"}
        {!closed && me && me.count > 0 && above && (
          <span className="count">
            {above.count - me.count + 1} more to pass {above.name.split(" ")[0]}
          </span>
        )}
        {!closed && me && me.rank === 1 && me.count > 0 && <span className="count">You lead</span>}
      </h2>
      <PodiumBoard
        rows={people.map((p, i) => ({
          key: p.key,
          name: p.name,
          imageUrl: p.imageUrl,
          count: p.count,
          rank: p.rank,
          isYou: p.isYou,
          live: testing(p),
          moved: moves[p.key],
          badges: (
            <>
              {i === firstFind && (
                <span className="race-badge" title="Found the first bug">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M9.2 1 3 9h4l-1 6 6.4-8.3H8.3L9.2 1Z" /></svg>
                  First find
                </span>
              )}
              {streak(i) && (
                <span className="race-badge race-badge-hot" title="Two finds in ten minutes">
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8.5 1c.4 2.2-.7 3.4-1.8 4.6C5.6 6.8 4.5 8 4.5 10a3.5 3.5 0 0 0 7 0c0-1.3-.5-2.2-1-3 .1 1-.3 1.8-1 2.2.4-2.6-.2-5.8-1-8.2Z" /></svg>
                  On fire
                </span>
              )}
            </>
          ),
        }))}
      />
    </section>
  );
}
