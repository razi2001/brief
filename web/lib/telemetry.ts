import { createHash } from "node:crypto";

/**
 * The anonymous heartbeat a self-hosted Brief sends once a day, so the
 * project can tell how many instances run and whether they work. Counts only:
 * no names, emails, org names, URLs, titles or ticket text. TELEMETRY.md
 * lists every field; the test in telemetry.test.ts holds the payload to that
 * list. Turn it off with BRIEF_TELEMETRY=off.
 */

export const DEFAULT_TELEMETRY_URL = "https://cloud.get-brief.app/api/telemetry";

export type Ping = {
  /** sha256 of the instance's Supabase URL: stable, and says nothing about it. */
  instance: string;
  version: string;
  /** Accounts that made at least one brief, ever. */
  users: number;
  /** Briefs created, filed and failed in the last 7 days. */
  created7d: number;
  filed7d: number;
  failed7d: number;
  /** Tracker kinds with a filed ticket in the last 7 days, e.g. ["jira", "linear"]. */
  trackers: string[];
};

export const PING_FIELDS = ["instance", "version", "users", "created7d", "filed7d", "failed7d", "trackers"] as const;

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.BRIEF_TELEMETRY ?? "on").trim().toLowerCase();
  return !["off", "0", "false", "no"].includes(v);
}

export function instanceId(supabaseUrl: string): string {
  return createHash("sha256").update(`brief:${supabaseUrl}`).digest("hex").slice(0, 32);
}

type BriefRow = { user_id: string; status: string; created_at: string; ticket_provider: string | null };

/** The ping, from the instance's brief rows. Pure: tested without a database. */
export function buildPing(opts: {
  supabaseUrl: string;
  version: string;
  allUserIds: string[];
  recent: BriefRow[];
}): Ping {
  const filed = opts.recent.filter((b) => b.status === "filed");
  return {
    instance: instanceId(opts.supabaseUrl),
    version: opts.version,
    users: new Set(opts.allUserIds).size,
    created7d: opts.recent.length,
    filed7d: filed.length,
    failed7d: opts.recent.filter((b) => b.status === "failed").length,
    trackers: [...new Set(filed.flatMap((b) => (b.ticket_provider ? [b.ticket_provider] : [])))].sort(),
  };
}

const KEY = /^[a-z0-9_-]{1,32}$/;

/** A ping as received, or null. Anything not in PING_FIELDS is dropped. */
export function parsePing(body: unknown): Ping | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);
  if (typeof b.instance !== "string" || !/^[0-9a-f]{32}$/.test(b.instance)) return null;
  const nums = [n(b.users), n(b.created7d), n(b.filed7d), n(b.failed7d)];
  if (nums.some((x) => x === null)) return null;
  return {
    instance: b.instance,
    version: typeof b.version === "string" ? b.version.slice(0, 20) : "",
    users: nums[0]!,
    created7d: nums[1]!,
    filed7d: nums[2]!,
    failed7d: nums[3]!,
    trackers: Array.isArray(b.trackers) ? b.trackers.filter((t): t is string => typeof t === "string" && KEY.test(t)).slice(0, 12) : [],
  };
}
