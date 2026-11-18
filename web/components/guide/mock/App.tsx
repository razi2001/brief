"use client";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import CloudBackground from "@/components/CloudBackground";
import { NAV_ITEMS } from "@/components/Nav";
import { SettingsGlyph, Eyebrow, buttonClass } from "@/components/SettingsSection";
import { TrackerLogo } from "@/components/TrackerLogo";
import BriefListRow from "@/components/BriefListRow";
import { StatusGlyph } from "@/components/StatusBadge";
import { TRACKER_OPTIONS } from "@/components/useTrackerConnect";
import type { DashboardBrief } from "@/lib/brief-types";
import type { ProviderKey } from "@/lib/tracker";
import { Real } from "./Real";

/*
 * Brief in the Guide: the app's own markup and classes (AppShell, Nav,
 * BriefsFeed, SettingsView and the rows it opens), drawn at real size inside
 * <Real> and scaled as a whole, so the pictures are the app. Where the real
 * component only draws from its props (StatusGlyph, TrackerLogo, BriefListRow)
 * it is the real component. Nothing here can be clicked: a frame says what it
 * shows. `data-gd` names what the Guide's cursor points at.
 */

type Tab = (typeof NAV_ITEMS)[number]["label"];
const HELP = ["/guide", "/requests"];

/** AppShell as it is on a computer: the sky, the sidebar (Nav with the current page lit), and the page as one sheet. */
export function MockApp({ active, children }: { active: Tab; children: ReactNode }) {
  const link = (n: (typeof NAV_ITEMS)[number], quiet: boolean) => {
    const on = n.label === active;
    return (
      <span
        key={n.href}
        data-gd={`nav-${n.href.slice(1)}`}
        aria-current={on ? "page" : undefined}
        className={`nav-link relative flex h-[30px] shrink-0 items-center gap-2.5 rounded-[7px] px-2 text-[13.5px] no-underline ${quiet ? "" : "font-medium"} ${on ? "text-ink" : quiet ? "text-muted" : "text-ink-2"}`}
      >
        <span className={`relative ${on ? "text-accent" : "text-muted"}`}>{n.icon}</span>
        <span className="relative">{n.label}</span>
      </span>
    );
  };
  return (
    <Real>
      <div className="gd-appbox relative flex h-full flex-row overflow-hidden text-ink">
        <CloudBackground />
        <aside className="sidebar flex h-full w-[232px] shrink-0 flex-col items-stretch px-2.5 pb-2.5 pt-3">
          <span className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
            <BrandMark size={28} className="shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="font-display text-[1.375rem] leading-[0.95] text-ink">Brief</span>
              <span className="mt-1 block truncate text-xs font-medium text-ink-2/60">Acme</span>
            </span>
          </span>
          <div className="mt-5 flex min-h-0 min-w-0 flex-1 flex-col">
            <nav className="nav relative flex flex-1 flex-col gap-px">
              {NAV_ITEMS.filter((n) => !HELP.includes(n.href)).map((n) => link(n, false))}
              <div className="mt-auto flex flex-col gap-px pt-4">{NAV_ITEMS.filter((n) => HELP.includes(n.href)).map((n) => link(n, true))}</div>
            </nav>
          </div>
          <div className="mt-2 flex items-center px-1.5 pt-1">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#e8dccb] text-xs font-medium text-ink-2">S</span>
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-2 pr-2">
          <div className="sheet h-full overflow-hidden">
            <div className="app-page mx-auto w-full max-w-[1040px] px-10 py-9">{children}</div>
          </div>
        </main>
      </div>
    </Real>
  );
}

// ---------------------------------------------------------------- Tickets

/** A ticket as the Guide tells it; made into the brief BriefListRow draws. */
export type Row = {
  id: string;
  title: string;
  /** Filed (a Linear state), being written and filed, a draft, or didn't file. */
  status: { label: string; type: "unstarted" | "started" | "completed" } | "filing" | "failed" | "draft";
  /** Minutes ago. */
  ago: number;
  fresh?: boolean;
};

const STATE_COLOR = { unstarted: "#e2e2e2", started: "#f2c94c", completed: "#5e6ad2" } as const;

function toBrief(r: Row, now: number): DashboardBrief {
  const at = new Date(now - r.ago * 60000).toISOString();
  if (r.status === "draft") return { id: r.id, status: "draft", draft: true, ticket_title: r.title, title: r.title, created_at: at, updated_at: at, seq: 15 };
  if (r.status === "filing") return { id: r.id, status: "processing", title: r.title, created_at: at, updated_at: at, provider: "linear" };
  if (r.status === "failed") return { id: r.id, status: "failed", title: r.title, created_at: at, updated_at: at, provider: "linear", error: "Linear rejected the ticket" };
  return {
    id: r.id,
    status: "filed",
    created_at: at,
    updated_at: at,
    provider: "linear",
    ticket_identifier: r.id,
    ticket_url: `https://linear.app/acme/issue/${r.id}`,
    ticket: { identifier: r.id, title: r.title, url: `https://linear.app/acme/issue/${r.id}`, stateName: r.status.label, stateColor: STATE_COLOR[r.status.type], createdAt: at },
  };
}

const NOW = Date.UTC(2026, 10, 15, 15, 0, 0);
const ageText = (ago: number) => (ago < 1 ? "just now" : ago < 60 ? `${Math.round(ago)}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`);

/**
 * The Tickets page as BriefsFeed draws it: the header (Search, New draft), the
 * one you just filed as a card, then everything else as rows by day. With
 * `draftsOnly`, what needs you: the drafts, each a card with Finish.
 */
export function MockFeed({ rows, draftsOnly = false, top }: { rows: Row[]; draftsOnly?: boolean; /** Above the header, like BriefsFeed's `top` (the competition podium). */ top?: ReactNode }) {
  const [latest, ...rest] = draftsOnly ? [] : rows;
  const today = rest.filter((r) => r.ago < 1440);
  const week = rest.filter((r) => r.ago >= 1440);
  const todo = draftsOnly ? rows : [];
  return (
    <section>
      {top && <div>{top}</div>}
      <header className={`flex items-center gap-2 ${top ? "pt-6" : ""}`}>
        <h1 className="page-title mr-auto">Tickets</h1>
        <label className="flex h-[30px] w-[150px] items-center gap-2 rounded-[7px] bg-[var(--color-hover)] px-2.5 text-muted">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className="shrink-0">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <span className="min-w-0 flex-1 text-[13px] text-muted">Search</span>
          <kbd aria-hidden className="rounded-[4px] border border-hairline bg-surface px-1 font-sans text-[11px] leading-[1.4] text-faint">
            /
          </kbd>
        </label>
        <span className="btn-accent h-[30px]">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New draft
        </span>
      </header>

      <div className="pb-6 pt-6">
        {latest && <Latest row={latest} />}
        {todo.length > 0 && (
          <div>
            <h2 className="section-label">
              Needs you<span className="count">{todo.length}</span>
            </h2>
            <ul className="grid grid-cols-3 gap-3">
              {todo.map((r, i) => (
                <li key={r.id} data-gd={`trow-${i}`} className={`action-card${r.fresh ? " animate-rise" : ""}`}>
                  <span className="flex items-start gap-2">
                    <span className="mt-[3px]">
                      <StatusGlyph kind="draft" color="#8a8378" />
                    </span>
                    <span data-gd={`trow-${i}-title`} className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{r.title}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs tabular-nums text-muted">Draft · {ageText(r.ago).replace(" ago", "")}</span>
                    <span className="btn h-7 !px-2.5 !py-0">Finish</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {[
          ["Today", today],
          ["This week", week],
        ].map(([d, items], gi) =>
          (items as Row[]).length ? (
            <div key={d as string} className={gi > 0 || latest ? "mt-8" : ""}>
              <h2 className="section-label">{d as string}</h2>
              <ul className="-mx-9">
                {(items as Row[]).map((r) => (
                  <BriefListRow key={r.id} brief={toBrief(r, NOW)} />
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

/** BriefsFeed's card for the one you just filed. */
function Latest({ row }: { row: Row }) {
  const filing = row.status === "filing";
  const st = typeof row.status === "object" ? row.status : null;
  return (
    <article data-gd="trow-0" className={`group relative flex items-stretch gap-5 overflow-hidden rounded-[16px] border border-hairline bg-surface p-3${row.fresh ? " animate-rise" : ""}`}>
      <div className="flex min-w-0 flex-1 flex-col py-1.5 pr-2">
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <StatusGlyph kind={filing ? "working" : st ? (st.type === "completed" ? "done" : st.type === "started" ? "progress" : "open") : "draft"} color={filing ? "#dd6936" : st ? STATE_COLOR[st.type] : "#8a8378"} />
          <span className={filing ? "font-medium tabular-nums text-accent" : "font-medium text-ink-2"}>{filing ? "Writing 0:08" : st ? st.label : "Draft"}</span>
          {st && (
            <>
              <span className="text-faint">·</span>
              <span className="font-mono text-xs">{row.id}</span>
            </>
          )}
          <span className="text-faint">·</span>
          <span className="tabular-nums">{ageText(row.ago)}</span>
        </p>
        <h2 data-gd="trow-0-title" className="mt-2 line-clamp-2 text-[19px] font-semibold leading-snug tracking-[-0.015em] text-ink">{row.title}</h2>
        <p className="relative z-10 mt-auto flex items-center gap-1 pt-3">
          {!filing && <span className="btn mr-1 h-[30px]">{st ? "Open in Linear" : "Open"}</span>}
          <span className="btn-ghost h-[30px] px-2.5">Archive</span>
        </p>
      </div>
      {filing && <span aria-hidden className="queue-bar" />}
    </article>
  );
}

// ---------------------------------------------------------------- Settings

export type SettingsState = {
  open?: "tracker" | "rules" | "replay";
  /** Tracker row: nothing yet, the list open, Linear picked, connected. */
  tracker?: "none" | "menu" | "picked" | "connected";
  connectOn?: boolean;
  rules?: string;
  rulesTyping?: boolean;
  rulesSaveOn?: boolean;
  rulesSaved?: boolean;
  sites?: string[];
  siteInput?: string;
  siteTyping?: boolean;
  addOn?: boolean;
};

const chevron = (on: boolean) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted/70 ${on ? "rotate-90" : ""}`}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

/** SettingsView: Workspace (Tracker, Team) and Tickets (Ticket rules, Replay), a row opens in place (SettingsList). */
export function MockSettings({ s }: { s: SettingsState }) {
  const tracker = s.tracker ?? "connected";
  const connected = tracker === "connected";
  const sites = s.sites ?? [];
  const rule = (s.rules && !s.rulesTyping ? s.rules : "").split("\n")[0];

  const row = (id: "tracker" | "team" | "rules" | "replay", icon: "tracker" | "team" | "rules" | "replay", label: string, summary: ReactNode, body: ReactNode | null, first = false) => {
    const on = s.open === id && !!body;
    return (
      <section key={id} className={first ? "" : "border-t hairline"}>
        <div data-gd={`row-${id}`} className={`group flex h-12 w-full items-center gap-2.5 px-4 text-left ${on ? "" : ""}`}>
          <span className="grid h-6 w-6 shrink-0 place-items-center text-muted">
            <SettingsGlyph icon={icon} size={16} />
          </span>
          <span className="shrink-0 text-sm text-ink">{label}</span>
          <span className="ml-auto flex min-w-0 items-center gap-2 overflow-hidden pl-3 text-[13px]">{summary}</span>
          {body !== null ? chevron(on) : <span aria-hidden="true" className="w-3.5 shrink-0" />}
        </div>
        {on && <div className="settings-row-body border-t hairline bg-surface-2/60 px-4 pb-5 pl-[3.25rem] pt-4">{body}</div>}
      </section>
    );
  };

  return (
    <div className="w-full max-w-[720px]">
      <header className="flex items-center justify-between gap-4">
        <h1 className="page-title">Settings</h1>
      </header>
      <div className="mt-7">
        <h2 className="group-title mb-2 px-0.5">Workspace</h2>
        <div className="card overflow-hidden">
          {row(
            "tracker",
            "tracker",
            "Tracker",
            connected ? (
              <>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" />
                  Connected
                </span>
                <span className="h-3 w-px shrink-0 bg-[var(--color-hairline)]" aria-hidden="true" />
                <TrackerLogo kind="linear" size={14} />
                <span className="truncate text-ink-2">Linear</span>
              </>
            ) : (
              <span className="text-muted">Not connected</span>
            ),
            <Picker state={tracker} connectOn={s.connectOn} />,
            true,
          )}
          {row("team", "team", "Team", <span className="text-muted">Just you</span>, null)}
        </div>

        <div className="mt-8">
          <h2 className="group-title mb-2 px-0.5">Tickets</h2>
        </div>
        <div className="card overflow-hidden">
          {row(
            "rules",
            "rules",
            "Ticket rules",
            rule ? <span className="truncate text-muted">{rule}</span> : <span className="text-muted">Not set</span>,
            <div className="card divide-y divide-[var(--color-hairline)]">
              <div className="px-4 py-4">
                <Eyebrow>Your preferences</Eyebrow>
                <div
                  data-gd="rules-ta"
                  className={`mt-2 block min-h-[118px] w-full whitespace-pre-wrap rounded-lg border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-ink ${s.rulesTyping ? "border-accent/50 ring-[3px] ring-accent/20" : "hairline"}`}
                >
                  {s.rules ? <span className={s.rulesTyping ? "gd-type gd-caret" : ""}>{s.rules}</span> : <span className="text-muted/60">{"e.g. Status: Backlog. Priority: Medium."}</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span data-gd="rules-save" className={`${buttonClass}${s.rulesSaveOn ? " gd-press" : ""}`}>
                    {s.rulesSaved ? "Saved ✓" : "Save"}
                  </span>
                  <span className="text-xs text-muted">Only affects your tickets</span>
                </div>
              </div>
            </div>,
            true,
          )}
          {row(
            "replay",
            "replay",
            "Replay",
            sites.length ? (
              sites.slice(0, 2).map((x) => (
                <span key={x} className="min-w-0 truncate rounded-[5px] bg-[rgba(26,22,18,.05)] px-1.5 py-px font-mono text-xs text-ink-2">
                  {x}
                </span>
              ))
            ) : (
              <span className="text-muted">Off</span>
            ),
            <div className="card divide-y divide-[var(--color-hairline)]">
              <div className="px-4 py-4">
                {sites.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {sites.map((x) => (
                      <li key={x} className="gd-pop">
                        <span className="inline-flex h-7 items-center gap-0.5 rounded-md border hairline bg-surface pl-2 pr-0.5 font-mono text-[12px] text-ink-2">
                          {x}
                          <span className="ml-0.5 grid h-5 w-5 place-items-center rounded text-muted/80">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2.5 flex gap-2 first:mt-0">
                  <div data-gd="site-input" className={`flex h-8 min-w-0 flex-1 items-center rounded-lg border bg-surface font-mono text-[13px] ${s.siteTyping ? "border-accent/50 ring-[3px] ring-accent/20" : "hairline"}`}>
                    <span className="select-none pl-2.5 text-muted/70">https://</span>
                    <span className="min-w-0 flex-1 pr-2 text-ink">{s.siteInput ? <span className={s.siteTyping ? "gd-type gd-caret" : ""}>{s.siteInput}</span> : <span className="text-muted/50">app.acme.com</span>}</span>
                    <span className="mr-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 font-sans text-xs text-muted">
                      <span aria-hidden className="grid h-3.5 w-3.5 place-items-center rounded-[4px] border border-[rgba(26,22,18,.25)] bg-surface" />
                      Subdomains
                    </span>
                  </div>
                  <span data-gd="site-add" className={`${buttonClass}${s.siteInput ? "" : " opacity-45 shadow-none"}${s.addOn ? " gd-press" : ""}`}>
                    Add
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">Only affects you</p>
              </div>
            </div>,
          )}
        </div>
      </div>
    </div>
  );
}

/** TrackerPicker: the card with its dropdown (drawn in place here, portalled in the app). */
function Picker({ state, connectOn }: { state: "none" | "menu" | "picked" | "connected"; connectOn?: boolean }) {
  const shown: ProviderKey | null = state === "picked" || state === "connected" ? "linear" : null;
  const opt = TRACKER_OPTIONS.find((o) => o.key === shown);
  return (
    <div className="card relative z-10 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-surface ${shown ? "hairline" : "border-dashed border-[rgba(26,22,18,.25)]"}`}>
            {shown && <TrackerLogo kind={shown} size={18} />}
          </span>
          <div className="relative min-w-0">
            <span data-gd="choose-tracker" className={`relative -left-1 inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium text-ink ${state === "menu" ? "bg-surface-2" : ""}`}>
              <span className="truncate">{opt ? opt.name : "Choose a tracker"}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            {opt && <p className="text-[13px] text-muted">{opt.caption}</p>}
            {state === "menu" && (
              <ul
                className="gd-pop absolute left-0 top-[calc(100%+6px)] z-50 w-[240px] rounded-lg border hairline bg-surface p-1"
                style={{ boxShadow: "0 1px 2px rgba(26,22,18,.06), 0 12px 32px -8px rgba(26,22,18,.18)" }}
              >
                {TRACKER_OPTIONS.slice(0, 7).map((o, i) => (
                  <li key={o.key} data-gd={`dd-${o.key}`} className={`flex h-8 items-center gap-2 rounded-md px-2 ${i === 0 ? "bg-surface-2" : ""}`}>
                    <span className="grid w-4 shrink-0 place-items-center">
                      <TrackerLogo kind={o.key} size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{o.name}</span>
                    <span className="w-3 shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {state === "connected" ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2e7d32]" aria-hidden="true" />
                Connected ✓
              </span>
              <span className="btn h-7 whitespace-nowrap">Disconnect</span>
            </>
          ) : opt ? (
            <span data-gd="connect" className={`btn-accent h-7 whitespace-nowrap${connectOn ? " gd-press" : ""}`}>
              Connect {opt.name} →
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
