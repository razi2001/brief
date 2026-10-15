import { checkTracker } from "@/lib/trackers/registry";
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
 *
 * Not every miss is stale, though, and each kind is reported apart because the
 * fix differs. A connection that only lacks its workspace pick (Azure DevOps
 * with several organizations, Asana with several workspaces) is `needsWorkspace`:
 * reconnecting would land the user right back where they are. A tracker this
 * deployment has no credentials for is `unavailable`: nothing the user does
 * will help.
 */
export type TrackerHealth = {
  stale: ProviderKey[];
  needsWorkspace: ProviderKey[];
  unavailable: ProviderKey[];
};

export async function checkTrackerHealth(
  userId: string,
  connected: ProviderKey[],
): Promise<TrackerHealth> {
  // One check per tracker: it resolves and explains a miss in the same pass,
  // so a revoked grant is never refreshed twice.
  const checks = await Promise.all(
    connected.map(async (key) => ({ key, check: await checkTracker(userId, key) })),
  );
  const health: TrackerHealth = { stale: [], needsWorkspace: [], unavailable: [] };
  for (const { key, check } of checks) {
    if (check && !check.tracker) health[check.problem].push(key);
  }
  return health;
}
