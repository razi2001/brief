/**
 * Ranking for the dashboard's "top brief reporters" podium.
 *
 * Pure: the aggregation happens in Postgres (see the org_leaderboard RPC in
 * 0010_orgs.sql), this decides the order and hands out the titles.
 *
 * The titles are the joke, and the joke only works because each one is EARNED
 * from real data - "the night shift" really is the person filing at 2am. One
 * title per person, awarded in priority order so two people can never end up
 * with the same one.
 *
 * Tone: the ribbing points up, never down. The leader gets the crown and the
 * teasing; whoever is at the bottom gets "still warming up". A leaderboard
 * between colleagues has to be fun for the person in last place too.
 */

/** One row of the org_leaderboard RPC. */
export type LeaderRow = {
  userId: string;
  /** Tickets filed in the selected range. */
  filed: number;
  /** Of those, how many were captured between 22:00 and 06:00. */
  night: number;
  /** Mean ticket title length, in characters. */
  avgTitle: number;
  /** Tickets filed in the window immediately before this one. */
  prevFiled: number;
};

export type Reporter = {
  userId: string;
  /** 1-based; 1 is the top of the podium. */
  rank: number;
  filed: number;
  title?: string;
};

export const TITLES = {
  first: "chief bug officer",
  second: "the closer",
  night: "the night shift",
  novelist: "the novelist",
  surging: "on a tear",
  last: "still warming up",
} as const;

/**
 * Award `title` to whichever untitled reporter scores highest, provided their
 * score clears `min`. Returns quietly when nobody qualifies - a title nobody
 * earned is better left unawarded than handed to someone at random.
 */
function awardBest(
  reporters: Reporter[],
  score: (r: Reporter) => number,
  title: string,
  min: number,
): void {
  let best: Reporter | undefined;
  let bestScore = min;
  for (const r of reporters) {
    if (r.title) continue;
    const s = score(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  if (best) best.title = title;
}

export function rankReporters(rows: LeaderRow[]): Reporter[] {
  const byId = new Map(rows.map((r) => [r.userId, r]));

  // Someone who filed nothing in the range isn't on the board at all - a row of
  // zeroes is noise, not a competitor.
  const reporters: Reporter[] = rows
    .filter((r) => r.filed > 0)
    // User id is the tie-break purely so the order is stable between renders;
    // two people on the same count must not swap places on refresh.
    .sort((a, b) => b.filed - a.filed || a.userId.localeCompare(b.userId))
    .map((r, i) => ({ userId: r.userId, rank: i + 1, filed: r.filed }));

  if (reporters.length === 0) return reporters;

  const stat = (r: Reporter) => byId.get(r.userId)!;

  reporters[0].title = TITLES.first;
  if (reporters[1]) reporters[1].title = TITLES.second;

  awardBest(reporters, (r) => stat(r).night, TITLES.night, 0);
  awardBest(reporters, (r) => stat(r).avgTitle, TITLES.novelist, 0);
  awardBest(reporters, (r) => r.filed - stat(r).prevFiled, TITLES.surging, 0);

  const lastPlace = reporters[reporters.length - 1];
  if (!lastPlace.title) lastPlace.title = TITLES.last;

  return reporters;
}

/**
 * Show the section to anyone who has filed at least one ticket.
 *
 * A lone reporter gets a deliberately different card (see Podium.tsx) rather
 * than a three-step podium with two empty places. Hiding it outright was the
 * first instinct, but it means the FIRST person in any workspace - which is
 * everyone, at some point - never discovers the feature exists, and it stays
 * invisible until a colleague happens to sign up.
 */
export function showPodium(reporters: Reporter[]): boolean {
  return reporters.length >= 1;
}
