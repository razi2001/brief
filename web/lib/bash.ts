/**
 * Quality competition: people test the same thing and a shared board shows who found
 * what. The pure rules; loading and writing live in bash-server.ts.
 *
 * A quality competition has a start date, an end date and a duration. Between the two
 * dates it is OPEN; before, it is upcoming and people can already join. Nobody
 * has to be there at the same time: the duration is each person's own clock,
 * up to 3 hours, starting the moment they press Start while it is open. What
 * they report in that time, with the popup's button set to the quality competition,
 * counts for it.
 *
 * By default it holds what is reported as drafts, reviewed together once it
 * is closed and filed as one ticket per bug. It can instead let each ticket
 * be filed as usual, with its name as a label.
 */

/** How long each person may get, in minutes: 15 minutes to 3 hours. */
export const DURATIONS: readonly number[] = [15, 30, 45, 60, 120, 180];
export const DEFAULT_DURATION = 60;
/** The longest a quality competition may stay open, from its start date to its end date, in days. */
export const MAX_OPEN_DAYS = 31;
/** How far ahead a quality competition may be planned, in days. */
export const MAX_AHEAD_DAYS = 90;
/** How many days a new quality competition is open for, until its dates are changed in the form. */
export const DEFAULT_OPEN_DAYS = 3;
/** A quality competition holds its reports for a review unless it was started otherwise. */
export const HOLDS_BY_DEFAULT = true;

export const MAX_BASH_NAME = 60;
/** Quality competitions one person may start in a day. */
export const DAILY_BASH_LIMIT = 10;
/** People one quality competition holds. */
export const MAX_BASH_MEMBERS = 100;

export function isDuration(v: unknown): v is number {
  return typeof v === "number" && DURATIONS.includes(v);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start and end a new quality competition was asked for, checked. A start in the
 * recent past ("today", picked a few hours ago or in another time zone) means
 * now. Null when the dates are not dates, the end is not after the start and
 * after now, it would stay open too long, or it is planned too far ahead.
 */
export function cleanWindow(startsAt: unknown, endsAt: unknown, now: number): { startsAt: string; endsAt: string } | null {
  if (typeof startsAt !== "string" || typeof endsAt !== "string") return null;
  const asked = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(asked) || !Number.isFinite(end)) return null;
  if (asked < now - DAY_MS || asked > now + MAX_AHEAD_DAYS * DAY_MS) return null;
  const start = Math.max(asked, now);
  if (end <= start || end - start > MAX_OPEN_DAYS * DAY_MS) return null;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

/** "45 min", "1 h", "3 h". */
export function lengthLabel(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

/** A quality competition's name as typed: one line, single spaces, capped. Null when empty. */
export function cleanBashName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/\s+/g, " ").trim().slice(0, MAX_BASH_NAME).trim();
  return name || null;
}

/** A quality competition's link code: the same 12-character shape as a brief's share token. */
export function isBashCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{12}$/.test(v);
}

/** When the quality competition opened, when it is due to close, and when it was closed early, if it was. */
export type BashTimes = { startsAt: string; endsAt: string; endedAt: string | null };

/** When it closed or will close: the early close when there is one. */
export function endOf(b: BashTimes): number {
  return new Date(b.endedAt ?? b.endsAt).getTime();
}

/** Not closed yet: upcoming or open. People can still join. */
export function isLive(b: BashTimes, now: number): boolean {
  return now < endOf(b);
}

export type BashPhase = "upcoming" | "open" | "closed";

/** Before its start date, between its dates, or after its end (or closed early). */
export function phaseOf(b: BashTimes, now: number): BashPhase {
  if (now >= endOf(b)) return "closed";
  return now < new Date(b.startsAt).getTime() ? "upcoming" : "open";
}

/** Milliseconds until it closes, never below zero. */
export function msLeft(b: BashTimes, now: number): number {
  return Math.max(0, endOf(b) - now);
}

/**
 * When one person's own time runs out: their minutes after they started, or
 * the moment the quality competition closes, whichever comes first.
 */
export function personEnd(b: BashTimes, startedAt: string, minutes: number): number {
  return Math.min(new Date(startedAt).getTime() + minutes * 60_000, endOf(b));
}

/** Is this person's own clock still running? */
export function personActive(b: BashTimes, startedAt: string, minutes: number, now: number): boolean {
  return now < personEnd(b, startedAt, minutes);
}

/** "12:05" left, "1:02:05" past the hour, "2d 4h" past the day. */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total >= 24 * 3600) {
    const d = Math.floor(total / (24 * 3600));
    const hours = Math.floor((total % (24 * 3600)) / 3600);
    return hours ? `${d}d ${hours}h` : `${d}d`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Someone who joined, and when (the tie-break of the board). */
export type BashMemberRow = { userId: string; joinedAt: string };
export type BashBriefRow = { id: string; userId: string; createdAt: string };

export type BoardRow = {
  userId: string;
  count: number;
  /** 1-based. People on the same count share a rank. */
  rank: number;
};

/**
 * The board: everyone who started, most briefs first. On a tie, whoever
 * reached that count first is listed first, but the rank is shared.
 */
export function board(members: BashMemberRow[], briefs: BashBriefRow[]): BoardRow[] {
  const count = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const b of briefs) {
    count.set(b.userId, (count.get(b.userId) ?? 0) + 1);
    lastAt.set(b.userId, Math.max(lastAt.get(b.userId) ?? 0, new Date(b.createdAt).getTime()));
  }
  const rows = members
    .map((m) => ({ userId: m.userId, count: count.get(m.userId) ?? 0, at: lastAt.get(m.userId) ?? Infinity, joined: m.joinedAt }))
    .sort((a, b) => b.count - a.count || a.at - b.at || a.joined.localeCompare(b.joined) || a.userId.localeCompare(b.userId));
  let rank = 0;
  let prev = -1;
  return rows.map((r, i) => {
    if (r.count !== prev) rank = i + 1;
    prev = r.count;
    return { userId: r.userId, count: r.count, rank };
  });
}

/**
 * The race at a glance, for a quality competition's line on the list: the
 * first three on its board who found something, and the viewer's place once
 * they found something too (null before).
 */
export function leaders(members: BashMemberRow[], briefs: BashBriefRow[], viewerId: string): { top: BoardRow[]; yourRank: number | null } {
  const ranked = board(members, briefs).filter((r) => r.count > 0);
  return { top: ranked.slice(0, 3), yourRank: ranked.find((r) => r.userId === viewerId)?.rank ?? null };
}

export type ReportInput = {
  name: string;
  /** The time each person got, in minutes. */
  minutes: number;
  people: { name: string; count: number }[];
  briefs: { title: string; by: string; url?: string; ticket?: string }[];
};

/** The quality competition as Markdown, to paste into a channel or a doc. */
export function reportMarkdown(r: ReportInput): string {
  const total = r.briefs.length;
  const lines = [
    `# ${r.name}`,
    "",
    `${total} ${total === 1 ? "bug" : "bugs"} found by ${r.people.length} ${r.people.length === 1 ? "person" : "people"}, with up to ${lengthLabel(r.minutes)} each.`,
    "",
    "## Board",
    "",
    ...r.people.map((p, i) => `${i + 1}. ${p.name}: ${p.count}`),
  ];
  if (total > 0) {
    lines.push("", "## Bugs", "");
    for (const b of r.briefs) {
      const id = b.ticket ? `${b.ticket} ` : "";
      const title = b.url ? `[${id}${b.title}](${b.url})` : `${id}${b.title}`;
      lines.push(`- ${title} (${b.by})`);
    }
  }
  return lines.join("\n") + "\n";
}
