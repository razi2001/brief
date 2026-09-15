import { PROVIDERS } from "@/lib/trackers/registry";
import type { ProviderKey } from "@/lib/tracker";

/**
 * Whether a connected tracker can actually be used.
 *
 * Connections decides "connected" from the Clerk external-account record, which
 * is the only thing a browser component can see. But Clerk will happily report
 * an account as `verified` while refusing to vend a token for it (HTTP 400 -
 * the underlying OAuth grant went stale). The page then says Connected while
 * every filing attempt fails with "No tracker connected", which is both
 * contradictory and impossible for the user to act on.
 *
 * Resolving the tracker is the honest test, because it is exactly what filing
 * does: a provider that resolves can file, and one that doesn't, can't.
 */
export type TrackerHealth = { stale: ProviderKey[] };

export async function checkTrackerHealth(
  userId: string,
  connected: ProviderKey[],
): Promise<TrackerHealth> {
  const checks = await Promise.all(
    connected.map(async (key) => {
      const def = PROVIDERS.find((p) => p.key === key);
      if (!def) return null;
      try {
        // Non-null means filing would work; null means the token is gone.
        return (await def.resolve(userId)) ? null : key;
      } catch {
        // A provider that throws can't file either, so it needs reconnecting
        // just the same.
        return key;
      }
    }),
  );
  return { stale: checks.filter((k): k is ProviderKey => k !== null) };
}
