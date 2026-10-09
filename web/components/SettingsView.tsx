import IntegrationsClient from "@/components/IntegrationsClient";
import TeamList, { teamSummary } from "@/components/TeamList";
import TicketPreferences, { GithubOrgPicker } from "@/components/TicketPreferences";
import SettingsList from "@/components/SettingsList";
import Avatar from "@/components/Avatar";
import { TrackerLogo } from "@/components/TrackerLogo";
import { mergeSiteLists } from "@/lib/replay-sites";
import ReplaySites from "@/components/ReplaySites";
import { providerName } from "@/lib/trackers/registry";
import type { ProviderKey } from "@/components/provider-labels";
import type { TeamMember } from "@/lib/team";
import type { GuidanceContext } from "@/lib/settings";

/**
 * The Settings page body, from plain data (the page loads it). Separate so the
 * layout can be rendered with fixtures too.
 */
export type SettingsViewProps = {
  tracker: ProviderKey | null;
  team: { org: { name: string; provider: ProviderKey }; members: TeamMember[]; replaySites: string[] } | null;
  githubOrgs: Array<{ login: string; avatarUrl?: string }>;
  guidance: GuidanceContext;
  mySites: string[];
};

export default function SettingsView({ tracker, team, githubOrgs, guidance, mySites }: SettingsViewProps) {
  const hasTeam = !!team && team.members.length > 0;
  const sites = mergeSiteLists(team?.replaySites ?? [], mySites);
  const rule = guidance.effective.trim().split(/\r?\n/)[0] ?? "";

  const group = (label: string) => (
    <h2 className="mb-2.5 px-1 text-[0.6875rem] uppercase tracking-[0.14em] text-muted">{label}</h2>
  );

  return (
    // The app shell is wide (for the tickets table); settings read better
    // narrower, so clamp this page and center it in the shell.
    <div className="mx-auto w-full max-w-[760px]">
      <h1 className="font-display text-3xl leading-none text-ink">Settings</h1>

      <div className="mt-8">
        {group("Workspace")}
        <SettingsList
          initialOpen={tracker ? null : "tracker"}
          rows={[
            {
              id: "tracker",
              label: "Tracker",
              icon: "tracker",
              action: tracker ? "Change" : "Connect",
              summary: tracker ? (
                <>
                  <TrackerLogo kind={tracker} size={18} />
                  <span className="truncate text-ink">{providerName(tracker)}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[#2e7d32]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" />
                    Connected
                  </span>
                </>
              ) : (
                <span className="text-muted">Not connected</span>
              ),
              body: <IntegrationsClient />,
            },
            {
              id: "team",
              label: "Team",
              icon: "team",
              action: hasTeam ? "View" : "Pick",
              summary: hasTeam ? (
                <>
                  <span className="flex shrink-0 pl-1">
                    {team.members.slice(0, 4).map((m) => (
                      <span key={m.userId} className="-ml-1 rounded-full ring-2 ring-[#fffdf8]">
                        <Avatar name={m.fullName} imageUrl={m.imageUrl} size={24} />
                      </span>
                    ))}
                  </span>
                  <span className="truncate text-muted">
                    {teamSummary(team.org.name, providerName(team.org.provider), team.members.length)}
                  </span>
                </>
              ) : githubOrgs.length > 0 ? (
                <span className="text-accent">Pick your GitHub organization</span>
              ) : (
                <span className="text-muted">Just you</span>
              ),
              // Nothing to show or choose: a plain row, not one that opens.
              body: hasTeam ? (
                <TeamList members={team.members} />
              ) : githubOrgs.length > 0 ? (
                <GithubOrgPicker orgs={githubOrgs} />
              ) : undefined,
            },
          ]}
        />

        <div className="mt-8">{group("Tickets")}</div>
        <SettingsList
          rows={[
            {
              id: "ticket-preferences",
              label: "Ticket rules",
              icon: "rules",
              action: rule ? "Edit" : "Add rules",
              summary: rule ? (
                <span className="truncate font-mono text-[13px] text-ink-2">{rule}</span>
              ) : (
                <span className="text-muted">Not set</span>
              ),
              body: <TicketPreferences {...guidance} />,
            },
            {
              id: "replay",
              label: "Replay",
              icon: "replay",
              action: sites.length ? "Edit" : "Add sites",
              summary: sites.length ? (
                <>
                  {sites.slice(0, 2).map((x) => (
                    <span key={x} className="shrink-0 rounded-md border hairline bg-[#fffdf8] px-2 py-0.5 font-mono text-xs text-ink">
                      {x}
                    </span>
                  ))}
                  {sites.length > 2 && <span className="shrink-0 text-xs text-muted">+{sites.length - 2}</span>}
                </>
              ) : (
                <span className="text-muted">Off</span>
              ),
              body: <ReplaySites team={team && { name: team.org.name, sites: team.replaySites }} mine={mySites} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
