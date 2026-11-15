import { BrowserFrame } from "../mock/Browser";
import { MockAcme, type AcmePage } from "../mock/Acme";
import { MockPopup, type Sheet, type Tile } from "../mock/Popup";
import { MockEditor } from "../mock/Editor";
import { MockApp, MockFeed, MockSettings, type SettingsState } from "../mock/App";
import { Mark, u } from "../mock/Stage";
import { IconMic } from "../mock/icons";
import { AT, scene } from "./types";

const APP = "cloud.get-brief.app";
const ACME_URL: Record<AcmePage, string> = {
  checkout: "acme.com/checkout",
  pricing: "acme.com/pricing",
  search: "acme.com/orders",
  profile: "acme.com/profile",
};

type PopupState = { tiles?: Tile[]; addOn?: boolean; wayOn?: "shot" | "video" | "replay"; sheet?: Sheet };

function OnAcme({
  page,
  popup,
  acme,
  brief,
  children,
}: {
  page: AcmePage;
  popup?: PopupState;
  acme?: Partial<Parameters<typeof MockAcme>[0]>;
  brief?: { busy?: boolean; badge?: string };
  children?: React.ReactNode;
}) {
  return (
    <BrowserFrame url={ACME_URL[page]} title="Acme" brief={{ pinned: true, open: !!popup, ...brief }} overlay={popup && <MockPopup {...popup} />}>
      <MockAcme page={page} {...acme} />
      {children}
    </BrowserFrame>
  );
}

// ---------------------------------------------------------------- replay

type ReplayS = {
  query?: boolean;
  searching?: boolean;
  popup?: PopupState;
  ed?: { keep: [number, number]; on?: boolean; head?: number; glide?: number; voice?: { rec?: boolean; secs: number }; said?: boolean };
  got?: boolean;
};

const SAID = "Search just spins, then fails.";

const CARD = { position: "absolute", padding: u(12), borderRadius: u(12), background: "#fffdfa", border: `${u(1)} solid rgba(26,22,18,.12)`, boxShadow: `0 ${u(18)} ${u(40)} ${u(-14)} rgba(26,22,18,.45)`, zIndex: 9 } as const;

/** What the reporter says while the voice-over records. */
function Speaking() {
  return (
    <div className="gd-slide" style={{ ...CARD, left: u(250), top: u(210), display: "flex", alignItems: "center", gap: u(8), padding: `${u(9)} ${u(14)}`, fontSize: u(10), color: "#1a1612" }}>
      <span style={{ display: "grid", width: u(14), height: u(14), color: "#e5484d" }}>
        <IconMic />
      </span>
      <span className="gd-type">“{SAID}”</span>
    </div>
  );
}

function WhatItKeeps() {
  const lines: Array<[string, string, ("net" | "voice")?]> = [
    ["0:00", `Your voice: “${SAID.replace(/\.$/, "")}”`, "voice"],
    ["0:02", "Typed in Search"],
    ["0:03", "Clicked “Search”"],
    ["0:03", "GET /orders/search", "net"],
    ["0:23", "504 after 20 s", "net"],
  ];
  return (
    <div className="gd-slide" style={{ ...CARD, left: u(24), top: u(40), width: u(280) }}>
      <div style={{ fontSize: u(9.5), fontWeight: 600, marginBottom: u(6) }}>What the ticket gets</div>
      {lines.map(([t, l, tone]) => (
        <div key={t + l} style={{ display: "flex", gap: u(8), fontSize: u(8.5), padding: `${u(3)} 0`, fontFamily: "var(--font-mono)" }}>
          <span style={{ color: "#8a8378" }}>{t}</span>
          <span style={{ color: tone === "net" ? "#c62828" : tone === "voice" ? "#dd6936" : "#3a3530" }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

const REPLAY: Tile = { kind: "replay", label: "Replay" };

export const replay = scene<ReplayS>({
  poster: 11,
  frames: [
    { ms: 1200, step: 0, target: "search-btn", click: true, s: { query: true } },
    { ms: 1300, step: 0, target: "brief-icon", click: true, s: { query: true, searching: true } },
    { ms: 1300, step: 0, target: "choice-replay", click: true, s: { query: true, searching: true, popup: { wayOn: "replay" } } },
    { ms: 900, step: 1, target: "h-start", s: { ed: { keep: [0, 100] } } },
    { ms: 1100, step: 1, target: "h-start", s: { ed: { keep: [45, 100] } } },
    // a take plays the kept part from its start and stops at its end
    { ms: 900, step: 2, target: "tool-voice", click: true, s: { ed: { keep: [45, 100], head: 45, voice: { rec: true, secs: 0 } } } },
    { ms: 2200, step: 2, target: "tool-voice", s: { ed: { keep: [45, 100], head: 80, glide: 2.2, voice: { rec: true, secs: 12 }, said: true } } },
    { ms: 800, step: 2, target: "tool-voice", s: { ed: { keep: [45, 100], head: 100, glide: 0.8, voice: { rec: true, secs: 18 }, said: true } } },
    { ms: 900, step: 2, target: "tool-voice", s: { ed: { keep: [45, 100], head: 100, voice: { secs: 18 } } } },
    { ms: 1100, step: 2, target: "ed-save", click: true, s: { ed: { keep: [45, 100], head: 100, voice: { secs: 18 }, on: true } } },
    { ms: 1200, step: 3, cursor: AT.rest, s: { query: true, searching: true, popup: { tiles: [{ ...REPLAY, on: true }] } } },
    { ms: 3000, step: 3, cursor: AT.rest, s: { query: true, searching: true, popup: { tiles: [REPLAY] }, got: true } },
  ],
  View: ({ s }) =>
    s.ed ? (
      <BrowserFrame url="Brief Cloud · Replay" title="Replay" fav="#dd6936">
        <MockEditor
          kind="replay"
          page="search"
          searching
          keep={s.ed.keep}
          action="Add to brief"
          actionOn={s.ed.on}
          head={s.ed.head ?? s.ed.keep[0] + 20}
          glide={s.ed.glide}
          voice={s.ed.voice}
        />
        {s.ed.said && <Speaking />}
      </BrowserFrame>
    ) : (
      <OnAcme page="search" popup={s.popup} acme={{ query: s.query ? "1042" : undefined, searching: s.searching }}>
        {s.got && <WhatItKeeps />}
      </OnAcme>
    ),
});

// ---------------------------------------------------------------- brief it

type BriefItS = { edited?: boolean; menu?: boolean; busy?: boolean; done?: boolean; drafts?: boolean };

/** Chrome's right-click menu, with the extension's one item in it. */
function ContextMenu() {
  return (
    <div className="gd-ctx gd-pop" style={{ left: "36%", top: "31%" }}>
      {["Back", "Forward", "Reload"].map((t) => (
        <div key={t} className="it">
          {t}
        </div>
      ))}
      <div className="sep" />
      {["Save as...", "Print..."].map((t) => (
        <div key={t} className="it">
          {t}
        </div>
      ))}
      <div className="sep" />
      <div className="it on" data-gd="ctx-brief-it">
        <Mark size={13} />
        Brief it
      </div>
      <div className="sep" />
      <div className="it">Inspect</div>
    </div>
  );
}

export const briefit = scene<BriefItS>({
  poster: 5,
  frames: [
    { ms: 1100, step: 0, target: "save", click: true, s: { edited: true } },
    { ms: 800, step: 0, target: "save", click: true, s: { edited: true } },
    { ms: 1000, step: 0, cursor: [38, 45], click: true, s: { edited: true } },
    { ms: 900, step: 0, target: "ctx-brief-it", s: { edited: true, menu: true } },
    { ms: 900, step: 0, target: "ctx-brief-it", click: true, s: { edited: true, menu: true } },
    { ms: 2400, step: 1, cursor: AT.rest, s: { edited: true, busy: true } },
    { ms: 2200, step: 2, cursor: AT.rest, s: { edited: true, done: true } },
    { ms: 1000, step: 3, target: "trow-0-title", click: true, s: { drafts: true } },
    { ms: 1500, step: 3, target: "trow-0-title", s: { drafts: true } },
  ],
  View: ({ s }) =>
    s.drafts ? (
      <BrowserFrame url={`${APP}/tickets?show=drafts`} title="Tickets · Brief Cloud" fav="#dd6936">
        <MockApp active="Tickets">
          <MockFeed
            draftsOnly
            rows={[
              { id: "brief-16", title: "Save changes on Profile does nothing", status: "draft", ago: 0, fresh: true },
              { id: "brief-12", title: "Coupon field accepts expired codes", status: "draft", ago: 2900 },
            ]}
          />
        </MockApp>
      </BrowserFrame>
    ) : (
      <OnAcme page="profile" acme={{ edited: s.edited }} brief={{ busy: s.busy, badge: s.done ? "✓" : undefined }}>
        {s.menu && <ContextMenu />}
      </OnAcme>
    ),
});

// ---------------------------------------------------------------- ticket rules

const RULES = "UI bugs get the Frontend label.";

export const rules = scene<SettingsState & { preview?: boolean }>({
  poster: 4,
  frames: [
    { ms: 1000, step: 0, target: "row-rules", click: true, s: { tracker: "connected" } },
    { ms: 2000, step: 1, target: "rules-ta", s: { tracker: "connected", open: "rules", rules: RULES, rulesTyping: true } },
    { ms: 1000, step: 1, target: "rules-save", click: true, s: { tracker: "connected", open: "rules", rules: RULES, rulesSaveOn: true } },
    { ms: 1000, step: 2, target: "row-replay", click: true, s: { tracker: "connected", rules: RULES } },
    { ms: 1700, step: 2, target: "site-input", s: { tracker: "connected", rules: RULES, open: "replay", siteInput: "app.acme.com", siteTyping: true } },
    { ms: 1000, step: 2, target: "site-add", click: true, s: { tracker: "connected", rules: RULES, open: "replay", siteInput: "app.acme.com", addOn: true } },
    { ms: 1100, step: 2, cursor: AT.rest, s: { tracker: "connected", rules: RULES, open: "replay", sites: ["app.acme.com"] } },
    { ms: 2600, step: 3, cursor: AT.rest, s: { tracker: "connected", rules: RULES, sites: ["app.acme.com"], preview: true } },
  ],
  View: ({ s }) => (
    <BrowserFrame url={`${APP}/connections`} title="Settings · Brief Cloud" fav="#dd6936">
      <MockApp active="Settings">
        <MockSettings s={s} />
      </MockApp>
      {s.preview && (
        <div className="gd-slide" style={{ position: "absolute", right: u(18), bottom: u(30), width: u(250), padding: u(12), borderRadius: u(12), background: "#fff", border: `${u(1)} solid rgba(26,22,18,.12)`, boxShadow: `0 ${u(18)} ${u(40)} ${u(-14)} rgba(26,22,18,.45)` }}>
          <div style={{ fontSize: u(8.5), color: "#8a8378", fontFamily: "var(--font-mono)" }}>ENG-143</div>
          <div style={{ fontSize: u(10.5), fontWeight: 600, margin: `${u(4)} 0 ${u(8)}` }}>The Team price spills out of its card</div>
          <span className="gd-site chip gd-pop" style={{ background: "#eef0fb", color: "#5e6ad2", animationDelay: ".4s", fontFamily: "var(--font-inter)" }}>
            Frontend
          </span>
        </div>
      )}
    </BrowserFrame>
  ),
});
