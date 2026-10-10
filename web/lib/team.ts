/**
 * The Settings team list's data, and its order. Pure, and free of server
 * imports, so the component can use the type without pulling in org-server.
 */

export type TeamMember = {
  userId: string;
  /** First and last name when Clerk has them. */
  fullName: string;
  imageUrl?: string;
  isYou: boolean;
  /** Tickets filed, all time. */
  filed: number;
  /** The title they hold on the all-time podium, if any. */
  title?: string;
};

/**
 * Most tickets filed first: who reports the most leads the list. Ties go by
 * name (ignoring case), then user id, so two people with the same count and
 * name keep their places between renders.
 */
export function sortTeam(members: TeamMember[]): TeamMember[] {
  return [...members].sort(
    (a, b) =>
      b.filed - a.filed ||
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }) ||
      a.userId.localeCompare(b.userId),
  );
}
