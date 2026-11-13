import type { StatusGroup } from "@/lib/status-group";

/**
 * Bash suggestions: the parts of the product that keep producing bugs, read
 * from the tickets already filed, each offered as a bug bash to start. The
 * pure rules; loading and the model call live in bash-suggest-server.ts.
 */

/** Fewer tickets than this say nothing about where the bugs are. */
export const MIN_TICKETS = 6;
/** The newest tickets the model reads. */
export const MAX_TICKETS = 150;
/** How far back tickets count. */
export const WINDOW_DAYS = 60;
export const MAX_SUGGESTIONS = 3;
/** An area needs at least this many bugs to be worth a bash. */
const MIN_AREA_BUGS = 2;
const MAX_AREA_NAME = 40;

export type PastTicket = { title: string; group: StatusGroup };

export type Suggestion = {
  /** The area, as a bash name: "Checkout", "Sign-in on mobile". */
  name: string;
  /** Tickets about it in the window. */
  bugs: number;
  /** Of those, how many are not done or closed yet. */
  open: number;
};

export const SUGGEST_INSTRUCTIONS = `You read the titles of the bug tickets a team filed recently and find the product areas that keep breaking, so the team can run a focused testing session on each.

An area is a part of the product a tester could open and try: a page, a flow or a feature ("Checkout", "Sign-in", "CSV export", "Notifications"). It is not a kind of bug ("Typos", "Crashes", "UI issues"), not a platform alone ("Mobile") unless the titles are about nothing else, and not the whole product.

Rules:
- Return at most ${MAX_SUGGESTIONS} areas, the ones with the most tickets. Return fewer, or none, when the tickets don't cluster: a made-up area is worse than no suggestion.
- An area needs at least ${MIN_AREA_BUGS} tickets that are clearly about it. List those ticket numbers. A ticket belongs to at most one area.
- Name each area in 1 to 3 words, in the language of the titles, the way the team writes it. No "bug bash", no "issues", no punctuation at the end.`;

export const SUGGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["areas"],
  properties: {
    areas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tickets"],
        properties: {
          name: { type: "string" },
          tickets: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
} as const;

export type RawAreas = { areas?: { name?: unknown; tickets?: unknown }[] } | null | undefined;

/** The tickets as the model reads them: numbered from 1, one title a line. */
export function suggestInput(tickets: PastTicket[]): string {
  return tickets.map((t, i) => `[${i + 1}] ${t.title.replace(/\s+/g, " ").trim()}`).join("\n");
}

function cleanAreaName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v
    .replace(/\s+/g, " ")
    .replace(/\bbug bash\b/gi, "")
    .replace(/[.:;,!?\s]+$/, "")
    .trim()
    .slice(0, MAX_AREA_NAME)
    .trim();
  return name || null;
}

/**
 * The model's answer, made safe and counted here: the numbers come from the
 * tickets themselves, never from the model. A ticket counts for the first area
 * that names it; an area left with too few, or with no usable name, or named
 * like an earlier one, is dropped. Most open bugs first.
 */
export function normalizeSuggestions(tickets: PastTicket[], raw: RawAreas): Suggestion[] {
  const used = new Set<number>();
  const names = new Set<string>();
  const out: Suggestion[] = [];
  for (const a of Array.isArray(raw?.areas) ? raw.areas : []) {
    const name = cleanAreaName(a?.name);
    if (!name || names.has(name.toLowerCase())) continue;
    const idx: number[] = [];
    for (const n of Array.isArray(a?.tickets) ? a.tickets : []) {
      if (!Number.isInteger(n)) continue;
      const i = (n as number) - 1;
      if (i < 0 || i >= tickets.length || used.has(i) || idx.includes(i)) continue;
      idx.push(i);
    }
    if (idx.length < MIN_AREA_BUGS) continue;
    idx.forEach((i) => used.add(i));
    names.add(name.toLowerCase());
    out.push({
      name,
      bugs: idx.length,
      open: idx.filter((i) => tickets[i].group === "open" || tickets[i].group === "progress").length,
    });
  }
  return out.sort((a, b) => b.open - a.open || b.bugs - a.bugs).slice(0, MAX_SUGGESTIONS);
}
