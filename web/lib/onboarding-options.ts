/**
 * Shared onboarding/profile option lists, used by both the first-run wizard
 * (Onboarding) and the editable profile field on the Connections page
 * (ProfileSettings) so the two never drift.
 */

/** Roles, each with a tiny glyph so a chip grid reads at a glance. */
export const ROLES: { label: string; icon: string }[] = [
  { label: "Engineer", icon: "</>" },
  { label: "QA / Tester", icon: "✓" },
  { label: "Product manager", icon: "◷" },
  { label: "Designer", icon: "✎" },
  { label: "Support", icon: "☎" },
  { label: "Founder", icon: "★" },
  { label: "Marketing", icon: "◔" },
  { label: "Other", icon: "•" },
];

/** "How'd you hear about Brief?" — attribution captured once at onboarding. */
export const SOURCES: string[] = [
  "A friend or colleague",
  "X / Twitter",
  "LinkedIn",
  "Search",
  "Product Hunt",
  "Somewhere else",
];
