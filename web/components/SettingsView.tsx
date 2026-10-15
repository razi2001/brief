import IntegrationsClient from "@/components/IntegrationsClient";
import TeamList, { teamSummary } from "@/components/TeamList";
import TicketPreferences from "@/components/TicketPreferences";
import WorkspacePicker from "@/components/WorkspacePicker";
import SettingsList from "@/components/SettingsList";
import Avatar from "@/components/Avatar";
import { TrackerLogo } from "@/components/TrackerLogo";
import { effectiveReplaySites, type ReplayMode } from "@/lib/replay-sites";
import ReplaySites from "@/components/ReplaySites";
import { providerName } from "@/lib/trackers/registry";
import type { ProviderKey } from "@/components/provider-labels";
import type { TeamMember } from "@/lib/team";
import type { GuidanceContext } from "@/lib/settings";
import type { Workspace } from "@/lib/tracker";

/**
 * The Settings page body, from plain data (the page loads it). Separate so the
 * layout can be rendered with fixtures too.
 */
export type SettingsViewProps = {
  tracker: ProviderKey | null;
  team: { org: { name: string; provider: ProviderKey }; members: TeamMember[]; replaySites: string[] } | null;
  /** The tracker's workspaces to choose a team from, when it sees several and none is picked. */
  workspaces: { provider: ProviderKey; noun: string; list: Workspace[] } | null;
  guidance: GuidanceContext;
  mySites: string[];
  replayMode: ReplayMode;
  /** Open the Team row on arrival: the connect flow sends people here to pick a workspace. */
  openTeam?: boolean;
  /** Open the Tracker row on arrival: a connect came back failing, and its error is on the card. */
  openTracker?: boolean;
};

export default function SettingsView({
  tracker,
  team,
  workspaces,
  guidance,
  mySites,
  replayMode,
  openTeam = false,
  openTracker = false,
}: SettingsViewProps) {
  const hasTeam = !!team && team.members.length > 0;
  const picking = workspaces && workspaces.list.length > 0 ? workspaces : null;
  // the list that applies: the team's, or your own (like Ticket rules)
  const sites = effectiveReplaySites({ hasTeam: !!team, mode: replayMode, team: team?.replaySites ?? [], mine: mySites });
  const rule = guidance.effective.trim().split(/\r?\n/)[0] ?? "";

  const group = (label: string) => (
    <h2 className="mb-2 px-0.5 text-[13px] font-medium text-ink-2">{label}</h2>
  );

  return (
    // The app shell is wide (for the tickets table); settings read better
    // narrower, so clamp this page to a Linear-width column.
    <div className="mx-auto w-full max-w-[720px]">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">Settings</h1>
      </header>

      <div className="mt-7">
        {group("Workspace")}
        <SettingsList
          initialOpen={openTeam ? "team" : openTracker || !tracker ? "tracker" : null}
          rows={[
            {
              id: "tracker",
              label: "Tracker",
              icon: "tracker",
              action: tracker ? "Change" : "Connect",
              summary: tracker ? (
                <>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" />
                    Connected
                  </span>
                  <span className="h-3 w-px shrink-0 bg-[var(--color-hairline)]" aria-hidden="true" />
                  <TrackerLogo kind={tracker} size={14} />
                  <span className="truncate text-ink-2">{providerName(tracker)}</span>
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
                  <span className="truncate text-muted">
                    {teamSummary(team.org.name, providerName(team.org.provider), team.members.length)}
                  </span>
                  <span className="hidden shrink-0 pl-1 sm:flex">
                    {team.members.slice(0, 4).map((m) => (
                      <span key={m.userId} className="-ml-1 rounded-full ring-2 ring-surface group-hover:ring-surface-2">
                        <Avatar name={m.fullName} imageUrl={m.imageUrl} size={22} />
                      </span>
                    ))}
                  </span>
                </>
              ) : picking ? (
                <span className="truncate text-accent">{`Pick your ${providerName(picking.provider)} ${picking.noun}`}</span>
              ) : (
                <span className="text-muted">Just you</span>
              ),
              // Nothing to show or choose: a plain row, not one that opens.
              body: hasTeam ? (
                <TeamList members={team.members} />
              ) : picking ? (
                <WorkspacePicker
                  provider={picking.provider}
                  providerName={providerName(picking.provider)}
                  noun={picking.noun}
                  workspaces={picking.list}
                />
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
                <span className="truncate text-muted">{rule}</span>
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
                    <span key={x} className="min-w-0 truncate rounded-[5px] bg-[rgba(26,22,18,.05)] px-1.5 py-px font-mono text-xs text-ink-2">
                      {x}
                    </span>
                  ))}
                  {sites.length > 2 && <span className="shrink-0 text-muted">+{sites.length - 2}</span>}
                </>
              ) : (
                <span className="text-muted">Off</span>
              ),
              body: (
                <ReplaySites
                  team={team && { name: team.org.name, sites: team.replaySites, members: team.members.length }}
                  mine={mySites}
                  mode={replayMode}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
