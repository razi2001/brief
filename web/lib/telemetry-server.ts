import { createAdminSupabase } from "@/lib/supabase/server";
import { DEFAULT_TELEMETRY_URL, buildPing, telemetryEnabled, type Ping } from "@/lib/telemetry";
import pkg from "../package.json";

const DAY = 86_400_000;

/** This instance's ping, read from its own database. */
export async function currentPing(): Promise<Ping> {
  const db = createAdminSupabase();
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [all, recent] = await Promise.all([
    db.from("briefs").select("user_id").limit(50_000),
    db.from("briefs").select("user_id, status, created_at, ticket_provider").gte("created_at", since).limit(50_000),
  ]);
  if (all.error) throw new Error(all.error.message);
  if (recent.error) throw new Error(recent.error.message);
  return buildPing({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    version: pkg.version,
    allUserIds: (all.data ?? []).map((r) => r.user_id as string),
    recent: (recent.data ?? []) as Parameters<typeof buildPing>[0]["recent"],
  });
}

/** Send one ping. Never throws: telemetry must not break the app. */
export async function sendPing(): Promise<void> {
  if (!telemetryEnabled()) return;
  try {
    const ping = await currentPing();
    const url = process.env.BRIEF_TELEMETRY_URL || DEFAULT_TELEMETRY_URL;
    console.log(`[telemetry] sending to ${url}: ${JSON.stringify(ping)} (BRIEF_TELEMETRY=off to stop)`);
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ping),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn("[telemetry] not sent:", e instanceof Error ? e.message : e);
  }
}

/** Once a minute after start, then daily. */
export function startTelemetry(): void {
  if (!telemetryEnabled()) {
    console.log("[telemetry] off");
    return;
  }
  setTimeout(() => void sendPing(), 60_000).unref?.();
  setInterval(() => void sendPing(), DAY).unref?.();
}

export type InstanceRow = Ping & { last_seen: string; first_seen: string; /** Whole days since the last ping. */ ageDays: number };

/** Every self-hosted instance that pinged, for the owner's usage page. */
export async function loadInstances(): Promise<InstanceRow[]> {
  const { data, error } = await createAdminSupabase()
    .from("instance_pings")
    .select("instance, version, users, created7d, filed7d, failed7d, trackers, first_seen, last_seen")
    .order("last_seen", { ascending: false })
    .limit(500);
  if (error) return [];
  const now = Date.now();
  return ((data ?? []) as Omit<InstanceRow, "ageDays">[]).map((r) => ({
    ...r,
    ageDays: Math.max(0, Math.floor((now - Date.parse(r.last_seen)) / DAY)),
  }));
}
