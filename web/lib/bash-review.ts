/**
 * Reviewing a live bug bash: its reports are put in groups, one per bug, and
 * each group becomes one ticket. The pure rules: what the model is asked, how
 * its answer is made safe, which report leads a group and what the ticket
 * says. Loading and writing live in bash-review-server.ts.
 */

export const MAX_GROUP_TITLE = 160;
/** How much of each report the model reads when grouping. */
const SUMMARY_CHARS = 600;

export type ReviewReport = {
  id: string;
  title: string;
  /** The written-up ticket body, as Markdown. May be empty while it is still being written. */
  body: string;
  userId: string;
  createdAt: string;
};

/** A group's title as typed: one line, single spaces, capped. Null when empty. */
export function cleanGroupTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_TITLE).trim();
  return t || null;
}

export const GROUPING_INSTRUCTIONS = `You sort the bug reports of one testing session into groups, so that each group becomes exactly one ticket.

Two reports go in the same group only when they describe the SAME defect: the same page or feature AND the same wrong behaviour, so that one code fix would close both. Different words for the same thing are still the same defect ("Pay does nothing" and "checkout button unresponsive after a declined card").

Keep reports apart when:
- they are on the same page but the wrong behaviour differs (a typo and a crash on the same screen are two bugs);
- the behaviour is alike but on different pages or features, unless one report says it is the same component;
- you are not sure. A wrongly merged bug is lost; a missed duplicate costs the reviewer one click.

Rules:
- Every report number appears in exactly one group. A report with no duplicate is a group of one.
- Give each group a ticket title: what is wrong and where, specific, under 90 characters, in the language of the reports. No reporter names, no "duplicate", no numbering.
- Do not invent groups with no reports.`;

export const GROUPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "reports"],
        properties: {
          title: { type: "string" },
          reports: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
} as const;

export type RawGroups = { groups?: { title?: unknown; reports?: unknown }[] } | null | undefined;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The reports as the model reads them: numbered from 1, title then the start of the body. */
export function groupingInput(reports: ReviewReport[]): string {
  return reports
    .map((r, i) => {
      const body = oneLine(r.body).slice(0, SUMMARY_CHARS);
      return `[${i + 1}] ${oneLine(r.title) || "Untitled"}${body ? `\n${body}` : ""}`;
    })
    .join("\n\n");
}

export type Group = { title: string; ids: string[] };

/** Every report alone: what the review starts from when the model can't be asked. */
export function singles(reports: ReviewReport[]): Group[] {
  return reports.map((r) => ({ title: cleanGroupTitle(r.title) ?? "Untitled", ids: [r.id] }));
}

/**
 * The model's answer, made safe. Whatever it returns, every report ends up in
 * exactly one group: a number it repeats counts the first time only, a number
 * it leaves out (or makes up) is ignored, and a report it forgot gets a group
 * of its own. A group it left without a usable title takes its first report's.
 * Bigger groups come first; groups of the same size keep the reports' order.
 */
export function normalizeGroups(reports: ReviewReport[], raw: RawGroups): Group[] {
  const placed = new Set<number>();
  const groups: { title: string; idx: number[] }[] = [];
  for (const g of Array.isArray(raw?.groups) ? raw.groups : []) {
    const idx: number[] = [];
    for (const n of Array.isArray(g?.reports) ? g.reports : []) {
      if (!Number.isInteger(n)) continue;
      const i = (n as number) - 1;
      if (i < 0 || i >= reports.length || placed.has(i)) continue;
      placed.add(i);
      idx.push(i);
    }
    if (idx.length === 0) continue;
    idx.sort((a, b) => a - b);
    groups.push({ title: cleanGroupTitle(g?.title) ?? cleanGroupTitle(reports[idx[0]].title) ?? "Untitled", idx });
  }
  reports.forEach((r, i) => {
    if (!placed.has(i)) groups.push({ title: cleanGroupTitle(r.title) ?? "Untitled", idx: [i] });
  });
  return groups
    .sort((a, b) => b.idx.length - a.idx.length || a.idx[0] - b.idx[0])
    .map((g) => ({ title: g.title, ids: g.idx.map((i) => reports[i].id) }));
}

/**
 * The report a group's ticket is written from: the one with the most written
 * up, since it carries the most evidence. On a tie, the first one made.
 */
export function pickPrimary<T extends ReviewReport>(reports: T[]): T | undefined {
  return [...reports].sort(
    (a, b) => b.body.trim().length - a.body.trim().length || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )[0];
}

export type ReportLine = { name: string; title: string; url?: string };

/**
 * The ticket body for a group: the leading report's write-up, then where it
 * was found and every report of it, each with its reporter and a link to its
 * Brief page (the evidence of the others stays there).
 */
export function mergedDescription(body: string, bashName: string, reports: ReportLine[]): string {
  const people = [...new Set(reports.map((r) => r.name))];
  const who =
    people.length === 1 ? `Reported by ${people[0]}.` : `Reported ${reports.length} times, by ${people.length} people.`;
  const lines = reports.map((r) => {
    const title = oneLine(r.title) || "Untitled";
    return `- ${r.name}: ${r.url ? `[${title}](${r.url})` : title}`;
  });
  return [body.trim(), `**Bug bash**\n\nFound in ${bashName}. ${who}`, `**Reports**\n\n${lines.join("\n")}`]
    .filter(Boolean)
    .join("\n\n");
}

/** What the filing agent is told about the label: the bash's name, on the ticket. */
export function labelInstruction(bashName: string): string {
  return `This ticket comes from the bug bash "${bashName}". Put the label "${bashName}" on it, exactly that name: use it if it exists, create it if the tracker allows, and add it beside the labels you would choose anyway. If this tracker has no labels, leave it out.`;
}
