/**
 * Putting look-alike reports of a quality competition in one block on its page, so ten
 * people hitting the same bug read as one thing found, not ten lines.
 *
 * This is a quick read of the TITLES only, done in the browser as reports come
 * in: no model, nothing saved, and nothing is merged. It is deliberately
 * careful (two titles must share most of their meaningful words), because a
 * block that hides a different bug is worse than two blocks for the same one.
 * The real grouping, by what each report says, is the review's
 * (lib/bash-review.ts).
 */

/** Words that say nothing about which bug it is. English and French, since titles come in both. */
const STOP = new Set(
  (
    "the a an and or of on in at to for from with without is are was be been does do did not no cannot cant can " +
    "when after before while then it its this that page button screen app bug issue error problem untitled " +
    "le la les un une des de du et ou sur dans au aux pour avec sans est sont pas ne plus quand apres avant ce cette " +
    "bouton ecran erreur probleme"
  ).split(" "),
);

/** How alike two titles must be (shared words over all their words) to share a block. */
export const SAME_BLOCK = 0.5;

/** The meaningful words of a title: lower case, accents dropped, short and empty words out, plurals folded. */
export function wordsOf(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
  return new Set(words);
}

/** Shared words over all words (0 when either title has no meaningful word). */
export function alike(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * The reports in blocks, keeping the order given (the first report of a block
 * places it). A report joins the first block whose FIRST report it is alike
 * enough to; comparing to the first only keeps a block from drifting from one
 * bug to another through a chain of half-similar titles.
 */
export function blocksOf<T extends { title: string }>(reports: T[]): T[][] {
  const blocks: { words: Set<string>; items: T[] }[] = [];
  for (const r of reports) {
    const words = wordsOf(r.title);
    const home = blocks.find((b) => alike(b.words, words) >= SAME_BLOCK);
    if (home) home.items.push(r);
    else blocks.push({ words, items: [r] });
  }
  return blocks.map((b) => b.items);
}
