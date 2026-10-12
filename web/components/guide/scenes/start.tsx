import BrandMark from "@/components/BrandMark";
import { BrowserFrame } from "../mock/Browser";
import { MockApp, MockSettings, TRACKERS, type SettingsState } from "../mock/App";
import { MockPopup } from "../mock/Popup";
import { Mark, u } from "../mock/Stage";
import { IconCheck, IconMic, IconPin, IconPuzzle } from "../mock/icons";
import { AT, scene } from "./types";

const APP = "cloud.get-brief.app";

// ---------------------------------------------------------------- install

type InstallS = {
  page: "store" | "perm" | "connected";
  installed?: boolean;
  dialog?: boolean;
  prompt?: boolean;
  granted?: boolean;
  menu?: boolean;
  pinned?: boolean;
  popup?: boolean;
};

function Store({ installed, dialog }: { installed?: boolean; dialog?: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff", fontFamily: "system-ui, sans-serif", color: "#202124" }}>
      <div style={{ display: "flex", alignItems: "center", gap: u(8), height: u(40), padding: `0 ${u(20)}`, borderBottom: `${u(1)} solid #e8eaed`, fontSize: u(12), color: "#5f6368" }}>
        <span style={{ width: u(18), height: u(18), borderRadius: "50%", background: "conic-gradient(#ea4335 0 33%, #fbbc04 0 66%, #34a853 0)" }} />
        chrome web store
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: u(16), padding: `${u(24)} ${u(40)}` }}>
        <Mark size={56} />
        <span style={{ flex: 1 }}>
          <div style={{ fontSize: u(19), fontWeight: 500 }}>Brief Cloud</div>
          <div style={{ fontSize: u(10), color: "#5f6368", marginTop: u(3) }}>get-brief.app · Workflow and planning</div>
        </span>
        <span
          key={installed ? "i" : "n"}
          data-gd="add-to-chrome"
          className="gd-in"
          style={{ padding: `${u(8)} ${u(16)}`, borderRadius: 999, fontSize: u(11), fontWeight: 500, background: installed ? "#fff" : "#0b57d0", color: installed ? "#0b57d0" : "#fff", border: installed ? `${u(1)} solid #c4c7c5` : "none" }}
        >
          {installed ? "Remove from Chrome" : "Add to Chrome"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: u(14), padding: `0 ${u(40)}` }}>
        <div style={{ height: u(170), borderRadius: u(10), background: "#f5f1e8" }} />
        <div style={{ display: "grid", gap: u(10) }}>
          <div style={{ borderRadius: u(10), background: "#f1f3f4" }} />
          <div style={{ borderRadius: u(10), background: "#f1f3f4" }} />
        </div>
      </div>
      {dialog && (
        <div className="gd-pop" style={{ position: "absolute", top: u(8), left: "50%", marginLeft: u(-170), width: u(340), padding: u(20), borderRadius: u(10), background: "#fff", boxShadow: `0 ${u(4)} ${u(16)} rgba(0,0,0,.25)`, fontSize: u(11) }}>
          <div style={{ display: "flex", alignItems: "center", gap: u(10), fontSize: u(14), fontWeight: 500 }}>
            <Mark size={22} />
            Add &quot;Brief Cloud&quot;?
          </div>
          <div style={{ color: "#5f6368", margin: `${u(12)} 0 ${u(16)}`, lineHeight: 1.5 }}>It can: read and change your data on the websites you visit</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: u(8) }}>
            <span style={{ padding: `${u(6)} ${u(14)}`, borderRadius: 999, border: `${u(1)} solid #c4c7c5`, color: "#0b57d0" }}>Cancel</span>
            <span data-gd="add-extension" style={{ padding: `${u(6)} ${u(14)}`, borderRadius: 999, background: "#0b57d0", color: "#fff" }}>Add extension</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** permission.html: the setup tab the extension opens when it's installed. */
function Permission({ prompt, granted }: { prompt?: boolean; granted?: boolean }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#f5f1e8", display: "grid", placeItems: "center" }}>
      <div style={{ width: u(330), textAlign: "center", fontFamily: "var(--font-mono)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: u(8) }}>
          <Mark size={28} />
          <span className="gd-serif" style={{ fontSize: u(24) }}>
            Brief <em>Cloud</em>
          </span>
        </div>
        <div className="gd-serif" style={{ fontSize: u(19), marginTop: u(18) }}>
          Quick setup
        </div>
        <div style={{ fontSize: u(9.5), color: "#8a8378", margin: `${u(8)} 0 ${u(16)}`, lineHeight: 1.6 }}>
          Click the button below. Chrome will ask, choose <b>Allow</b>.
        </div>
        <span
          key={granted ? "g" : "n"}
          data-gd="grant"
          className="gd-in"
          style={{ display: "inline-flex", alignItems: "center", gap: u(7), padding: `${u(10)} ${u(18)}`, borderRadius: u(10), background: granted ? "#2f7d4f" : "#dd6936", color: "#f5f1e8", fontSize: u(10.5) }}
        >
          <span className="gd-fill" style={{ display: "inline-block", width: u(12), height: u(12) }}>
            {granted ? <IconCheck /> : <IconMic />}
          </span>
          {granted ? "Microphone ready" : "Grant microphone access"}
        </span>
      </div>
      {prompt && (
        <div className="gd-pop" style={{ position: "absolute", top: u(2), left: u(60), width: u(300), padding: u(16), borderRadius: u(10), background: "#fff", boxShadow: `0 ${u(4)} ${u(16)} rgba(0,0,0,.25)`, fontFamily: "system-ui, sans-serif", fontSize: u(11), color: "#202124" }}>
          <div style={{ fontWeight: 500 }}>Brief Cloud wants to</div>
          <div style={{ display: "flex", alignItems: "center", gap: u(8), margin: `${u(10)} 0 ${u(14)}`, color: "#3c4043" }}>
            <span className="gd-fill" style={{ display: "inline-block", width: u(14), height: u(14) }}>
              <IconMic />
            </span>
            Use your microphone
          </div>
          <div style={{ display: "grid", gap: u(6) }}>
            {["Allow while visiting the site", "Allow this time", "Never allow"].map((t, i) => (
              <span key={t} data-gd={i === 0 ? "allow" : undefined} style={{ textAlign: "center", padding: `${u(6)} 0`, borderRadius: 999, border: `${u(1)} solid #c4c7c5`, color: "#0b57d0", background: i === 0 ? "#e8f0fe" : "#fff" }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Connected() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "linear-gradient(180deg,#eef3f8,#f6f1e9)" }}>
      <div className="gd-pop" style={{ width: u(280), padding: u(26), borderRadius: u(14), background: "#fffdfa", border: `${u(1)} solid rgba(26,22,18,.09)`, textAlign: "center" }}>
        <span className="gd-check" style={{ margin: `0 auto ${u(10)}`, width: u(30), height: u(30) }}>
          <IconCheck />
        </span>
        <div className="gd-serif" style={{ fontSize: u(22) }}>
          Connected <em>✓</em>
        </div>
      </div>
    </div>
  );
}

export const install = scene<InstallS>({
  poster: 13,
  frames: [
    { ms: 900, step: 0, cursor: AT.rest, s: { page: "store" } },
    { ms: 1100, step: 0, target: "add-to-chrome", click: true, s: { page: "store" } },
    { ms: 1000, step: 0, target: "add-extension", s: { page: "store", dialog: true } },
    { ms: 900, step: 0, target: "add-extension", click: true, s: { page: "store", dialog: true } },
    { ms: 900, step: 1, target: "grant", s: { page: "perm", installed: true } },
    { ms: 1000, step: 1, target: "grant", click: true, s: { page: "perm", installed: true } },
    { ms: 1100, step: 1, target: "allow", click: true, s: { page: "perm", installed: true, prompt: true } },
    { ms: 900, step: 1, cursor: AT.rest, s: { page: "perm", installed: true, granted: true } },
    { ms: 1000, step: 2, target: "puzzle", click: true, s: { page: "perm", granted: true } },
    { ms: 1000, step: 2, target: "pin", click: true, s: { page: "perm", granted: true, menu: true } },
    { ms: 800, step: 2, cursor: AT.rest, s: { page: "perm", granted: true, pinned: true } },
    { ms: 1000, step: 3, target: "brief-icon", click: true, s: { page: "perm", granted: true, pinned: true } },
    { ms: 1100, step: 3, target: "cloud", click: true, s: { page: "perm", granted: true, pinned: true, popup: true } },
    { ms: 2600, step: 3, cursor: AT.rest, s: { page: "connected", pinned: true } },
  ],
  View: ({ s }) => (
    <BrowserFrame
      url={s.page === "store" ? "chromewebstore.google.com/detail/brief-cloud" : s.page === "perm" ? "Brief Cloud" : `${APP}/connect`}
      title={s.page === "store" ? "Brief Cloud - Chrome Web Store" : s.page === "perm" ? "Brief - Microphone access" : "Brief Cloud"}
      fav={s.page === "store" ? "#34a853" : "#dd6936"}
      brief={{ pinned: !!s.pinned, open: s.popup }}
      puzzleOn={s.menu}
      overlay={
        <>
          {s.menu && (
            <div className="gd-menu gd-pop">
              <div className="head">Extensions</div>
              <div className="item on">
                <Mark size={14} />
                <span className="grow">Brief Cloud</span>
                <span className="pinned" data-gd="pin">
                  <IconPin />
                </span>
              </div>
              <div className="sep" />
              <div className="item">
                <IconPuzzle />
                <span className="grow">Manage extensions</span>
              </div>
            </div>
          )}
          {s.popup && <MockPopup />}
        </>
      }
    >
      {s.page === "store" ? <Store installed={s.installed} dialog={s.dialog} /> : s.page === "perm" ? <Permission prompt={s.prompt} granted={s.granted} /> : <Connected />}
    </BrowserFrame>
  ),
});

// ---------------------------------------------------------------- connect

type ConnectS = SettingsState & { consent?: boolean };

export const connect = scene<ConnectS>({
  poster: 8,
  frames: [
    { ms: 900, step: 0, cursor: AT.rest, s: { tracker: "none" } },
    { ms: 1000, step: 0, target: "row-tracker", click: true, s: { tracker: "none" } },
    { ms: 800, step: 0, target: "choose-tracker", s: { tracker: "none", open: "tracker" } },
    { ms: 1000, step: 1, target: "choose-tracker", click: true, s: { tracker: "none", open: "tracker" } },
    { ms: 1000, step: 1, target: "dd-linear", click: true, s: { tracker: "menu", open: "tracker" } },
    { ms: 1100, step: 1, target: "connect", click: true, s: { tracker: "picked", open: "tracker", connectOn: true } },
    { ms: 1200, step: 2, target: "authorize", s: { consent: true } },
    { ms: 1000, step: 2, target: "authorize", click: true, s: { consent: true } },
    { ms: 2600, step: 3, cursor: AT.rest, s: { tracker: "connected", open: "tracker" } },
  ],
  View: ({ s }) =>
    s.consent ? (
      <BrowserFrame url="linear.app/oauth/authorize" title="Authorize Brief Cloud" fav="#5e6ad2" brief={{ pinned: true }}>
        <div className="gd-consent">
          <div className="box gd-pop">
            <div className="logos">
              <span>
                <BrandMark />
              </span>
              <span className="dots">···</span>
              <span>
                <TRACKERS.linear.Logo />
              </span>
            </div>
            <div style={{ fontWeight: 600 }}>Brief Cloud wants to access your Linear workspace</div>
            <div className="s">Create issues, and read teams, labels and states</div>
            <div className="go" data-gd="authorize">Authorize</div>
          </div>
        </div>
      </BrowserFrame>
    ) : (
      <BrowserFrame url={`${APP}/connections`} title="Settings · Brief Cloud" fav="#dd6936" brief={{ pinned: true }}>
        <MockApp active="Settings">
          <MockSettings s={s} />
        </MockApp>
      </BrowserFrame>
    ),
});
