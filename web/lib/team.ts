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
 * You first, then everyone else by name.
 *
 * Alphabetical rather than by tickets on purpose: this is a roster, not a second
 * leaderboard - the podium already ranks people, and a list that reshuffles
 * whenever someone files reads as noise. User id breaks ties so two people with
 * the same name keep their places between renders.
 */
export function sortTeam(members: TeamMember[]): TeamMember[] {
  return [...members].sort(
    (a, b) =>
      Number(b.isYou) - Number(a.isYou) ||
      a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }) ||
      a.userId.localeCompare(b.userId),
  );
}
