import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import { NAV_ITEMS } from "@/components/Nav";
import { SettingsGlyph } from "@/components/SettingsSection";
import {
  AsanaLogo,
  AzureDevopsLogo,
  ClickUpLogo,
  GithubLogo,
  GitlabLogo,
  JiraLogo,
  LinearLogo,
  MondayLogo,
  NotionLogo,
  TrelloLogo,
} from "@/components/TrackerLogo";
import { IconChevron, IconChevronDown, IconRefresh, IconX } from "./icons";

type Tab = (typeof NAV_ITEMS)[number]["label"];

/** Brief Cloud as it is: the sunset sidebar (real icons), and the page. */
export function MockApp({ active, children }: { active: Tab; children: ReactNode }) {
  return (
    <div className="gd-app">
      <aside className="gd-side">
        <div className="brand">
          <span className="mk">
            <BrandMark />
          </span>
          <span className="w">Brief</span>
        </div>
        <nav>
          {NAV_ITEMS.map((n) => (
            <div key={n.href} className={`gd-nav${n.label === active ? " on" : ""}`}>
              {n.icon}
              {n.label}
            </div>
          ))}
        </nav>
        <div className="me">
          <span className="gd-av">S</span>
        </div>
      </aside>
      <div className="gd-main">{children}</div>
    </div>
  );
}

/** Every tracker the real picker lists (useTrackerConnect's TRACKER_DEFS), in the registry's order. */
export const TRACKERS = {
  linear: { name: "Linear", Logo: LinearLogo, caption: "Files tickets with embedded evidence." },
  jira: { name: "Jira", Logo: JiraLogo, caption: "Atlassian Cloud - file to a project." },
  github: { name: "GitHub", Logo: GithubLogo, caption: "File issues to a repository." },
  gitlab: { name: "GitLab", Logo: GitlabLogo, caption: "File issues to a project." },
  azure: { name: "Azure DevOps", Logo: AzureDevopsLogo, caption: "File work items to a project." },
  clickup: { name: "ClickUp", Logo: ClickUpLogo, caption: "File tasks to a list." },
  notion: { name: "Notion", Logo: NotionLogo, caption: "File pages to a database." },
  trello: { name: "Trello", Logo: TrelloLogo, caption: "File cards to a board." },
  asana: { name: "Asana", Logo: AsanaLogo, caption: "File tasks to a project." },
  monday: { name: "Monday", Logo: MondayLogo, caption: "File items to a board." },
} as const;

export function TrackerMark({ kind, size = 13 }: { kind: keyof typeof TRACKERS; size?: number }) {
  const { Logo } = TRACKERS[kind];
  return (
    <span className="gd-fill" style={{ display: "inline-block", width: `calc(${size} * var(--a))`, height: `calc(${size} * var(--a))`, flex: "0 0 auto" }}>
      <Logo />
    </span>
  );
}

// ---------------------------------------------------------------- Settings

export type SettingsState = {
  open?: "tracker" | "rules" | "replay";
  /** Tracker row: nothing yet, the dropdown open, Linear picked, connected. */
  tracker?: "none" | "menu" | "picked" | "connected";
  connectOn?: boolean;
  rules?: string;
  rulesTyping?: boolean;
  rulesSaveOn?: boolean;
  sites?: string[];
  siteInput?: string;
  siteTyping?: boolean;
  addOn?: boolean;
};

/** Settings (SettingsView): Workspace and Tickets, one row each, a row opens in place. */
export function MockSettings({ s }: { s: SettingsState }) {
  const tracker = s.tracker ?? "connected";
  // The card clips to its rounded corners, which cut the open list off at its
  // edge; the real list hangs over the cards below, so while it is open the
  // card stops clipping and the tracker row rounds its own top corners.
  const menuOpen = tracker === "menu";
  const row = (id: string, icon: "tracker" | "team" | "rules" | "replay", label: string, sum: ReactNode, opens = true) => (
    <div
      data-gd={`row-${id}`}
      className={`gd-row${s.open === id ? " on" : ""}`}
      style={menuOpen && id === "tracker" ? { borderRadius: "calc(11 * var(--a)) calc(11 * var(--a)) 0 0" } : undefined}
    >
      <span className="ic">
        <SettingsGlyph icon={icon} />
      </span>
      {label}
      <span className="sum">{sum}</span>
      {opens ? (
        <span className="chev">
          <IconChevron />
        </span>
      ) : (
        <span style={{ width: "calc(14 * var(--a))" }} />
      )}
    </div>
  );
  return (
    <div className="gd-set">
      <div className="gd-h1">Settings</div>
      <div className="grp">Workspace</div>
      <div className="gd-card" style={menuOpen ? { overflow: "visible" } : undefined}>
        {row(
          "tracker",
          "tracker",
          "Tracker",
          tracker === "connected" ? (
            <>
              <span className="dot" />
              Connected
              <span className="vsep" />
              <TrackerMark kind="linear" />
              <span className="val">Linear</span>
            </>
          ) : (
            "Not connected"
          ),
        )}
        {s.open === "tracker" && (
          <div className="gd-rbody">
            <div className="gd-pick" style={{ position: "relative" }}>
              {tracker === "none" || tracker === "menu" ? (
                <>
                  <span className="sq empty" />
                  <span className="nm" data-gd="choose-tracker">
                    Choose a tracker <IconChevronDown />
                  </span>
                  {tracker === "menu" && (
                    // TrackerPicker's list: 240px wide, every tracker in one
                    // column. Rows are 30 here against the real 32, so all ten
                    // fit above the bottom of the frame.
                    <div className="gd-dd" style={{ left: "calc(60 * var(--a))", top: "calc(48 * var(--a))", width: "calc(240 * var(--a))" }}>
                      {(Object.keys(TRACKERS) as Array<keyof typeof TRACKERS>).map((k, i) => (
                        <div
                          key={k}
                          data-gd={`dd-${k}`}
                          className={`it${i === 0 ? " on" : ""}`}
                          style={{ height: "calc(30 * var(--a))", paddingTop: 0, paddingBottom: 0 }}
                        >
                          <TrackerMark kind={k} size={16} />
                          {TRACKERS[k].name}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span className="sq">
                    <TrackerMark kind="linear" size={20} />
                  </span>
                  <span>
                    <span className="nm">
                      Linear <IconChevronDown />
                    </span>
                    <div className="cap">{TRACKERS.linear.caption}</div>
                  </span>
                  <span className="right">
                    {tracker === "connected" ? (
                      <>
                        <span style={{ display: "flex", alignItems: "center", gap: "calc(6 * var(--a))", color: "#8a8378" }}>
                          <span style={{ width: "calc(6 * var(--a))", height: "calc(6 * var(--a))", borderRadius: "50%", background: "#2e7d32" }} />
                          Connected ✓
                        </span>
                        <span className="gd-btn">Disconnect</span>
                      </>
                    ) : (
                      <span data-gd="connect" className={`gd-btn accent${s.connectOn ? " gd-hl" : ""}`}>Connect</span>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
        {row("team", "team", "Team", "Just you", false)}
      </div>
      <div className="grp">Tickets</div>
      <div className="gd-card">
        {row("rules", "rules", "Ticket rules", s.rules && !s.rulesTyping ? s.rules : "Not set")}
        {s.open === "rules" && (
          <div className="gd-rbody">
            <div className="gd-small" style={{ color: "#1a1612", marginBottom: "calc(8 * var(--a))" }}>
              Your preferences
            </div>
            <div data-gd="rules-ta" className={`gd-ta${s.rulesTyping ? " on" : ""}`}>{s.rules && <span className={s.rulesTyping ? "gd-type gd-caret" : ""}>{s.rules}</span>}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "calc(12 * var(--a))", marginTop: "calc(12 * var(--a))" }}>
              <span data-gd="rules-save" className={`gd-btn accent${s.rulesSaveOn ? " gd-hl" : ""}`}>Save</span>
              <span className="gd-small">Only affects your tickets</span>
            </div>
          </div>
        )}
        {row(
          "replay",
          "replay",
          "Replay",
          s.sites?.length ? s.sites.map((x) => (
            <span key={x} className="gd-site chip">
              {x}
            </span>
          )) : "Off",
        )}
        {s.open === "replay" && (
          <div className="gd-rbody">
            {!!s.sites?.length && (
              <div style={{ display: "flex", gap: "calc(6 * var(--a))", marginBottom: "calc(10 * var(--a))" }}>
                {s.sites.map((x) => (
                  <span key={x} className="gd-site">
                    {x}
                    <span className="gd-fill" style={{ display: "inline-block", width: "calc(10 * var(--a))", height: "calc(10 * var(--a))", color: "#8a8378" }}>
                      <IconX />
                    </span>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "calc(8 * var(--a))" }}>
              <span data-gd="site-input" className={`gd-inp${s.siteTyping ? " on" : ""}`}>
                {s.siteInput ? <span className={s.siteTyping ? "gd-type gd-caret" : ""}>{s.siteInput}</span> : <span className="ph">https://app.acme.com</span>}
                <span className="sub">
                  <i />
                  Subdomains
                </span>
              </span>
              <span data-gd="site-add" className={`gd-btn accent${s.siteInput ? "" : " faded"}${s.addOn ? " gd-hl" : ""}`}>Add</span>
            </div>
            <div className="gd-small" style={{ marginTop: "calc(8 * var(--a))" }}>
              Only affects you
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tickets / Drafts

export type Row = {
  id: string;
  title: string;
  /** A tracker state (label + its color), or Brief's own. */
  status: { label: string; color: string } | "filing" | "failed" | "draft";
  who?: string;
  when: string;
  err?: string;
  fresh?: boolean;
};

const FEED_TABS: Array<[string, string | null]> = [
  ["All", null],
  ["Drafts", "#8a8378"],
  ["Open", "#3b6fb6"],
  ["In progress", "#dd6936"],
  ["Done", "#2e7d32"],
  ["Closed", "#c9c3b5"],
];

/** The Tickets table, as BriefsFeed draws it: one page, a tab per state. `view` is the tab that is open. */
export function MockFeed({ rows, view = "Tickets" }: { view?: "Tickets" | "Drafts"; rows: Row[] }) {
  const open = view === "Drafts" ? "Drafts" : "All";
  return (
    <div className="gd-feed">
      <div className="top">
        <div>
          {/* one page for both: the heading is always Tickets */}
          <div className="gd-h1">Tickets</div>
          <div className="tabs">
            {FEED_TABS.map(([label, color]) => (
              <span key={label} className={label === open ? "on" : ""}>
                {color && <i style={{ background: color }} />}
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="acts">
          <span className="refresh">
            <IconRefresh />
          </span>
          <span className="new">New draft</span>
        </div>
      </div>
      <div className="gd-card" style={{ marginTop: "calc(18 * var(--a))" }}>
        <div className="gd-tr th">
          <span className="box" />
          <span>ID</span>
          <span>Title</span>
          <span>Status</span>
          <span>Assignee</span>
          <span>Updated</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.id + r.title} data-gd={`trow-${i}`} className={`gd-tr${r.fresh ? " fresh" : ""}`}>
            <span />
            <span className="id">
              {r.status === "failed" ? (
                <span className="retry">Retry</span>
              ) : r.status === "draft" || r.status === "filing" ? (
                <span className="draftid">{r.id}</span>
              ) : (
                <>
                  <LinearLogo />
                  {r.id}
                </>
              )}
            </span>
            <span data-gd={`trow-${i}-title`} className={`ti${r.status === "failed" ? " fail" : ""}`}>
              {r.title}
              {r.err && <span className="err">{r.err}</span>}
            </span>
            <span className="st">
              {r.status === "filing" ? (
                <>
                  <i className="spin" />
                  Filing…
                </>
              ) : r.status === "failed" ? (
                <>
                  <i style={{ background: "#c62828" }} />
                  Didn&apos;t file
                </>
              ) : r.status === "draft" ? (
                <>
                  <i style={{ background: "#dd6936" }} />
                  Draft
                </>
              ) : (
                <>
                  <i style={{ background: r.status.color }} />
                  {r.status.label}
                </>
              )}
            </span>
            <span className="as">
              {r.who && (
                <>
                  <span className="gd-av">{r.who[0]}</span>
                  {r.who}
                </>
              )}
            </span>
            <span className="up">{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
