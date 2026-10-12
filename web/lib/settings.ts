import { getClerkUser } from "@/lib/clerk-user";
import { effectiveGuidance, migratedMode, type GuidanceMode } from "@/lib/guidance";
import { getOrg, getOrgMemberIds, getOrgSettings } from "@/lib/org-server";
import { cleanSiteList, replayModeOf, type ReplayMode } from "@/lib/replay-sites";

/**
 * Account-level settings: the natural-language ticket guidance the server agent
 * applies when filing, plus the reporter's role captured during onboarding.
 *
 * Guidance now has two sources - the org-wide default shared by everyone whose
 * tracker points at the same workspace, and the user's personal override. This
 * resolves them (see lib/guidance.ts for the precedence) and hands back the ONE
 * string that applies, so callers stay unaware there are two.
 *
 * Reading is best-effort throughout: any failure (Clerk unreachable, org lookup
 * down, user missing) degrades to empty rather than throwing, since the agent
 * must still be able to file.
 */
export async function getUserSettings(
  userId: string,
): Promise<{ ticketGuidance: string; role: string }> {
  try {
    const user = await getClerkUser(userId);
    const personal = (user.privateMetadata?.ticketGuidance as string) ?? "";
    const role = ((user.privateMetadata?.role as string) ?? "").trim();
    const mode = migratedMode({
      storedMode: user.privateMetadata?.ticketGuidanceMode as string | undefined,
      personal,
    });

    // Only pay for the org lookup when it can actually change the answer.
    let org = "";
    if (mode === "inherit") {
      const identity = await getOrg(userId);
      if (identity) org = (await getOrgSettings(identity.key)).ticketGuidance;
    }

    return { ticketGuidance: effectiveGuidance({ mode, personal, org }), role };
  } catch {
    return { ticketGuidance: "", role: "" };
  }
}

/**
 * The full preference picture for the Connections editor: both sources, the
 * mode, and which one is currently winning.
 */
export type GuidanceContext = {
  mode: GuidanceMode;
  personal: string;
  org: string;
  orgName: string;
  orgMembers: number;
  hasOrg: boolean;
  /** Who last changed the team defaults, and when. Empty until someone has. */
  orgUpdatedByName: string;
  orgUpdatedAt: string | null;
  effective: string;
};

/**
 * Everything the Connections editor needs to show both sources at once.
 *
 * Unlike getUserSettings - which resolves to the single string the agent uses -
 * this deliberately returns BOTH, because the editor has to show you the team's
 * rules even while your own override is the one in force.
 */
export async function getGuidanceContext(userId: string): Promise<GuidanceContext> {
  const empty: GuidanceContext = {
    mode: "inherit",
    personal: "",
    org: "",
    orgName: "",
    orgMembers: 0,
    hasOrg: false,
    orgUpdatedByName: "",
    orgUpdatedAt: null,
    effective: "",
  };

  try {
    // the user and their team at once: neither waits for the other
    const [user, identity] = await Promise.all([getClerkUser(userId), getOrg(userId)]);
    const personal = (user.privateMetadata?.ticketGuidance as string) ?? "";
    const mode = migratedMode({
      storedMode: user.privateMetadata?.ticketGuidanceMode as string | undefined,
      personal,
    });

    if (!identity) {
      return { ...empty, mode, personal, effective: effectiveGuidance({ mode, personal }) };
    }

    const [settings, members] = await Promise.all([
      getOrgSettings(identity.key),
      getOrgMemberIds(identity.key),
    ]);

    return {
      mode,
      personal,
      org: settings.ticketGuidance,
      orgName: identity.name,
      orgMembers: members.length,
      hasOrg: true,
      orgUpdatedByName: settings.updatedByName,
      orgUpdatedAt: settings.updatedAt,
      effective: effectiveGuidance({ mode, personal, org: settings.ticketGuidance }),
    };
  } catch {
    return empty;
  }
}

/**
 * The user's own Replay sites and whether they follow the team's or use these
 * (Settings → Replay, like Ticket rules). Empty, team's, on any failure.
 */
export async function getUserReplay(userId: string): Promise<{ sites: string[]; mode: ReplayMode }> {
  try {
    const user = await getClerkUser(userId);
    const sites = cleanSiteList(user.privateMetadata?.replaySites);
    return { sites, mode: replayModeOf(user.privateMetadata?.replaySitesMode, sites) };
  } catch {
    return { sites: [], mode: "inherit" };
  }
}
