// How many users of one Clerk instance still hold Linear, Jira or GitHub
// through a Clerk connected account, per tracker, and how many of those also
// have a Brief row for it (a row is what files once it exists, so their Clerk
// account is only a leftover). For watching the move off Clerk
// (TRACKERS.md, "Moving off Clerk").
//
// Read-only: it lists Clerk users and the user_id and provider columns of
// tracker_connections, and prints counts. Never an id, an email or a token.
//
//   node --env-file=.env.local scripts/count-clerk-trackers.mjs
//
// Env: CLERK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_URL or
// NEXT_PUBLIC_SUPABASE_URL. NEXT_PUBLIC_<TRACKER>_CLERK_STRATEGY, when set,
// adds that custom connector's accounts to the built-in ones.

import { pathToFileURL } from "node:url";

export const TRACKERS = ["linear", "jira", "github"];

/** Clerk's built-in strategy for each tracker (lib/clerk-strategies.ts). */
const BUILT_IN = { linear: "oauth_linear", jira: "oauth_atlassian", github: "oauth_github" };

const CLERK_PAGE = 100;
const SUPABASE_PAGE = 1000;

/**
 * What each tracker's Clerk accounts are matched on, as lib/clerk-strategies
 * matches them: the strategy without its "oauth_" prefix, as a substring of
 * the account's provider. The built-in strategy always counts; a configured
 * custom connector counts beside it, so accounts made before the switch to
 * it are not missed.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string[]>}
 */
export function clerkMatches(env = process.env) {
  const custom = {
    linear: env.NEXT_PUBLIC_LINEAR_CLERK_STRATEGY,
    jira: env.NEXT_PUBLIC_JIRA_CLERK_STRATEGY,
    github: env.NEXT_PUBLIC_GITHUB_CLERK_STRATEGY,
  };
  return Object.fromEntries(
    TRACKERS.map((key) => {
      const strategies = [BUILT_IN[key], (custom[key] ?? "").trim()].filter(Boolean);
      return [key, [...new Set(strategies.map((s) => s.toLowerCase().replace(/^oauth_/, "")))]];
    }),
  );
}

/**
 * The counts, from Clerk Backend API users (only `id` and each external
 * account's `provider` and `verification.status` are read) and Brief's
 * tracker_connections rows ({ user_id, provider }). Per tracker:
 *
 *  - `clerk`       users with a verified Clerk account for it: connected
 *  - `alsoBrief`   of those, the ones with a Brief row for the same tracker
 *  - `unverified`  users whose only Clerk accounts for it never verified
 *                  (an abandoned connect), still in the way of the cleanup
 *
 * `anyClerk` is the users with a verified account for at least one tracker.
 */
export function countClerkTrackers(users, briefRows, matches) {
  const brief = new Set(briefRows.map((r) => `${r.provider}:${r.user_id}`));
  const trackers = Object.fromEntries(TRACKERS.map((key) => [key, { clerk: 0, alsoBrief: 0, unverified: 0 }]));
  let anyClerk = 0;
  for (const user of users) {
    let onClerk = false;
    for (const key of TRACKERS) {
      const wanted = matches[key] ?? [];
      const accounts = (user.external_accounts ?? []).filter((a) => {
        const provider = String(a?.provider ?? "").toLowerCase();
        return wanted.some((m) => provider.includes(m));
      });
      if (!accounts.length) continue;
      if (!accounts.some((a) => a?.verification?.status === "verified")) {
        trackers[key].unverified++;
        continue;
      }
      onClerk = true;
      trackers[key].clerk++;
      if (brief.has(`${key}:${user.id}`)) trackers[key].alsoBrief++;
    }
    if (onClerk) anyClerk++;
  }
  return { users: users.length, anyClerk, trackers };
}

/** The counts as a small table. */
export function formatCounts({ users, anyClerk, trackers }, instance = "") {
  const rows = [
    ["tracker", "on Clerk", "also Brief row", "unverified only"],
    ...TRACKERS.map((key) => [key, trackers[key].clerk, trackers[key].alsoBrief, trackers[key].unverified]),
  ].map((r) => r.map(String));
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const table = rows.map((r) => r.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  "));
  return [
    `Clerk users scanned${instance ? ` (${instance})` : ""}: ${users}`,
    `With a Clerk tracker account: ${anyClerk}`,
    "",
    ...table,
  ].join("\n");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with a few retries on 429 and 5xx. Never logs the request's headers. */
async function getJson(url, headers, what) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) throw new Error(`${what}: HTTP ${res.status}`);
    const after = Number(res.headers.get("retry-after"));
    await wait(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
  }
}

/** Every user of the Clerk instance the key belongs to, oldest first. */
async function listClerkUsers(secret, apiBase) {
  const users = [];
  for (let offset = 0; ; ) {
    const url = `${apiBase}/v1/users?limit=${CLERK_PAGE}&offset=${offset}&order_by=${encodeURIComponent("+created_at")}`;
    const page = await getJson(url, { Authorization: `Bearer ${secret}` }, "Clerk users");
    if (!Array.isArray(page)) throw new Error("Clerk users: unexpected response");
    if (!page.length) return users;
    for (const u of page) {
      users.push({
        id: u.id,
        external_accounts: (u.external_accounts ?? []).map((a) => ({
          provider: a.provider,
          verification: { status: a.verification?.status },
        })),
      });
    }
    offset += page.length;
  }
}

/** Brief's Linear, Jira and GitHub rows: user_id and provider only. */
async function listBriefRows(supabaseUrl, serviceKey) {
  const rows = [];
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  for (let offset = 0; ; ) {
    const url =
      `${supabaseUrl}/rest/v1/tracker_connections?select=user_id,provider` +
      `&provider=in.(${TRACKERS.join(",")})&order=user_id.asc,provider.asc` +
      `&limit=${SUPABASE_PAGE}&offset=${offset}`;
    const page = await getJson(url, headers, "tracker_connections");
    if (!Array.isArray(page)) throw new Error("tracker_connections: unexpected response");
    if (!page.length) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function main() {
  const env = process.env;
  const secret = env.CLERK_SECRET_KEY;
  const supabaseUrl = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    !secret && "CLERK_SECRET_KEY",
    !supabaseUrl && "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
  const apiBase = (env.CLERK_API_URL || "https://api.clerk.com").replace(/\/+$/, "");
  const instance = secret.startsWith("sk_live_") ? "production" : secret.startsWith("sk_test_") ? "development" : "";

  const [users, rows] = await Promise.all([listClerkUsers(secret, apiBase), listBriefRows(supabaseUrl, serviceKey)]);
  console.log(formatCounts(countClerkTrackers(users, rows, clerkMatches(env)), instance));
}

// Run when executed, whether as a file or piped in on stdin (`node -`), and
// not when a test imports it.
const entry = process.argv[1];
if (entry === "-" || (entry && import.meta.url === pathToFileURL(entry).href)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : "failed");
    process.exit(1);
  });
}
