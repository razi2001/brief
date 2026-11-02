// Where a visit or a sign-up came from, as a name a person reads: the many
// hosts and app ids one place shows up under (www.linkedin.com,
// com.linkedin.android, lnkd.in) fold into "LinkedIn".

import type { SignupSource } from "@/lib/signup-source";

export const NO_REFERRER = "No referrer";
export const BRIEF_TICKETS = "Brief tickets";

// First match wins, so the Web Store comes before Google.
const HOSTS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$|^com\.linkedin\.|^lnkd\.in$/, "LinkedIn"],
  [/^(chromewebstore|chrome)\.google\.com$/, "Chrome Web Store"],
  [/(^|\.)google\.[a-z.]+$|^com\.google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)teams\.(microsoft|live)\.com$|^teams\..*\.microsoft$|(^|\.)teams\.cdn\.office\.net$/, "Microsoft Teams"],
  [/(^|\.)slack\.com$|^com\.slack/, "Slack"],
  [/(^|\.)(x|twitter)\.com$|^t\.co$/, "X"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/^news\.ycombinator\.com$/, "Hacker News"],
  [/(^|\.)producthunt\.com$/, "Product Hunt"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)youtube\.com$/, "YouTube"],
  [/(^|\.)ministryoftesting\.com$/, "Ministry of Testing"],
  [/^cloud\.get-brief\.app$/, "Brief app"],
  // A teammate opening "Reported with Brief" at the end of a filed ticket.
  [
    /(^|\.)(linear\.app|atlassian\.net|gitlab\.com|dev\.azure\.com|clickup\.com|notion\.so|trello\.com|asana\.com|monday\.com)$/,
    BRIEF_TICKETS,
  ],
];

// utm_source values that mean a channel above (anything else shows as given).
const UTM: Record<string, string> = {
  ticket: BRIEF_TICKETS,
  linkedin: "LinkedIn",
  li: "LinkedIn",
  google: "Google",
  producthunt: "Product Hunt",
  ph: "Product Hunt",
  reddit: "Reddit",
  hn: "Hacker News",
  hackernews: "Hacker News",
  twitter: "X",
  x: "X",
  slack: "Slack",
  teams: "Microsoft Teams",
  github: "GitHub",
  newsletter: "Newsletter",
  email: "Email",
};

/** The channel for a referring host and an optional utm_source; the utm tag wins. */
export function channelOf(ref: string | undefined, utmSource?: string): string {
  const utm = utmSource?.trim().toLowerCase();
  if (utm) return UTM[utm] ?? utmSource!.trim();
  const host = (ref ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!host) return NO_REFERRER;
  return HOSTS.find(([re]) => re.test(host))?.[1] ?? host;
}

/**
 * Where a sign-up came from, measured: the website tags its sign-up links, so
 * a tagged link with no site or campaign still means "the website, no
 * referrer". Null when the person never came through a tagged link.
 */
export function signupChannel(s: SignupSource | null): string | null {
  if (!s) return null;
  return channelOf(s.ref, s.utm_source);
}
