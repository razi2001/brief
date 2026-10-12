import type { AutoKey } from "./lessons";

/** What the app already knows about you (tracker connected, extension paired...). */
export type AutoFacts = Partial<Record<AutoKey, boolean>>;

type Doneable = { slug: string; auto?: AutoKey };

/** The tried list from storage: only lessons that exist, each once, never a throw. */
export function parseTried(raw: string | null, known: readonly string[]): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && known.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function addTried(list: readonly string[], slug: string): string[] {
  return list.includes(slug) ? [...list] : [...list, slug];
}

export function isDone(lesson: Doneable, facts: AutoFacts, tried: readonly string[]): boolean {
  return tried.includes(lesson.slug) || (!!lesson.auto && !!facts[lesson.auto]);
}

export function countDone(lessons: readonly Doneable[], facts: AutoFacts, tried: readonly string[]): number {
  return lessons.filter((l) => isDone(l, facts, tried)).length;
}
