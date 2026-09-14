/**
 * Which ticket guidance actually applies to a user.
 *
 * Two sources: the org-wide default (shared by everyone whose tracker points at
 * the same workspace) and the user's personal override. The override REPLACES
 * the org default - it is never merged, because the whole point of setting one
 * is to ignore the team's.
 *
 * Which of the two wins is decided by an explicit mode rather than by the
 * personal text being empty. Emptiness is ambiguous in a way that would bite:
 * a user who clears their box can't tell whether they just fell back to the
 * team rules or opted into no rules at all. An explicit mode puts that on the
 * surface - and makes "override with deliberately nothing" expressible.
 */

export type GuidanceMode = "inherit" | "override";

export function effectiveGuidance(input: {
  mode: GuidanceMode;
  personal: string;
  /** Absent when the user has no org (no tracker connected, or GitHub unpicked). */
  org?: string;
}): string {
  const personal = (input.personal ?? "").trim();
  const org = (input.org ?? "").trim();
  return input.mode === "override" ? personal : org;
}

/**
 * The mode to use for a user, given whatever is stored on them.
 *
 * Everyone who predates org preferences has a personal `ticketGuidance` and no
 * stored mode. Reading those as "override" makes their effective guidance
 * byte-identical to what it was before orgs existed, so no one's filing
 * behaviour changes on deploy. Users with nothing stored start out inheriting,
 * which is what makes a team default useful the moment someone sets one.
 */
export function migratedMode(input: {
  storedMode: string | undefined | null;
  personal: string;
}): GuidanceMode {
  if (input.storedMode === "inherit" || input.storedMode === "override") {
    return input.storedMode;
  }
  return (input.personal ?? "").trim() ? "override" : "inherit";
}
