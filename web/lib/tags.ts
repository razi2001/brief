/**
 * Tags: a person's own folders for their briefs. What a tag is and the pure
 * rules behind the list; loading and writing live in tags-server.ts.
 */

/** Muted, on-brand folder colours. The key is what the database stores. */
export const TAG_COLORS = {
  clay: "#c9714a",
  ochre: "#c99a3a",
  sage: "#6f9a72",
  denim: "#4f7cae",
  plum: "#8a6aa8",
  berry: "#b5567a",
} as const;
export type TagColor = keyof typeof TAG_COLORS;
export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[];

export const MAX_TAG_NAME = 32;
/** Tags one person may keep. */
export const MAX_TAGS = 60;
/** Briefs one request may tag or untag. */
export const MAX_BRIEFS_PER_CHANGE = 200;

/** The folder for briefs with no tag, as it reads in the URL (?tag=none). */
export const UNTAGGED = "none";


export type Tag = {
  id: string;
  name: string;
  color: TagColor;
  /** Tickets carrying it. */
  count: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id from a URL or a request body, checked before it reaches the database. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function isTagColor(v: unknown): v is TagColor {
  return typeof v === "string" && Object.hasOwn(TAG_COLORS, v);
}

/** A tag's name as typed: one line, single spaces, capped. Null when empty. */
export function cleanTagName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/\s+/g, " ").trim().slice(0, MAX_TAG_NAME).trim();
  return name || null;
}

/** The colour a new tag gets: the least used one, so folders stay tellable apart. */
export function nextTagColor(existing: { color: string }[]): TagColor {
  const used = new Map<string, number>();
  for (const t of existing) used.set(t.color, (used.get(t.color) ?? 0) + 1);
  let best = TAG_COLOR_KEYS[0];
  for (const c of TAG_COLOR_KEYS) if ((used.get(c) ?? 0) < (used.get(best) ?? 0)) best = c;
  return best;
}

/** Up to MAX_BRIEFS_PER_CHANGE distinct brief ids from a request body. */
export function cleanBriefIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isUuid))].slice(0, MAX_BRIEFS_PER_CHANGE);
}

/** brief id -> its tag ids. */
export type BriefTags = Record<string, string[]>;

/** `briefTags` after putting `tagId` on (or taking it off) `briefIds`. */
export function applyTagChange(briefTags: BriefTags, briefIds: string[], tagId: string, on: boolean): BriefTags {
  const next: BriefTags = { ...briefTags };
  for (const id of briefIds) {
    const had = next[id] ?? [];
    if (on) next[id] = had.includes(tagId) ? had : [...had, tagId];
    else next[id] = had.filter((t) => t !== tagId);
  }
  return next;
}

/** How many of `briefIds` gain (or lose) the tag: what a folder's count moves by. */
export function changeDelta(briefTags: BriefTags, briefIds: string[], tagId: string, on: boolean): number {
  let n = 0;
  for (const id of briefIds) {
    const has = (briefTags[id] ?? []).includes(tagId);
    if (on && !has) n += 1;
    if (!on && has) n -= 1;
  }
  return n;
}

/** Is every one of `briefIds` carrying the tag? Drives the tick in the Tag menu. */
export function allTagged(briefTags: BriefTags, briefIds: string[], tagId: string): boolean {
  return briefIds.length > 0 && briefIds.every((id) => (briefTags[id] ?? []).includes(tagId));
}

/** The folder in the URL: a tag id, "none" for untagged, or null for everything. */
export function parseTagParam(v: unknown): string | null {
  if (v === UNTAGGED) return UNTAGGED;
  return isUuid(v) ? v : null;
}
