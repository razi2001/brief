"use client";
/* eslint-disable @next/next/no-img-element -- data: posters, as popup.js draws them */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Real } from "./Real";
import "./real/popup.css";

/**
 * The extension popup, drawn by the extension's own stylesheet
 * (real/popup.css, a scoped copy of extension/popup.css) on popup.html's own
 * markup, filled the way popup.js fills it: the ways (Record and talk,
 * Screenshot, Last minute) while there is no evidence, then the evidence as
 * rows with "+ Add" over them; the field; the quality competition row while your clock
 * runs in one; the Create button and its menu; the Add evidence and
 * screenshot sheets, the toast, and the dot that flies into Home.
 *
 * `data-gd` names what the Guide's cursor points at.
 */

export type Tile = {
  kind: "shot" | "video" | "replay";
  /** A screenshot's note. */
  label?: string;
  uploading?: boolean;
  /** Just added: it comes in the way popup.js brings in a new row. */
  on?: boolean;
};

export type ChoiceKey = "shot" | "video" | "replay";

export type Sheet = { kind: "chooser"; on?: ChoiceKey } | { kind: "shot"; note?: string; typing?: boolean; editOn?: boolean };

export type CreateMode = "ticket" | "draft" | "prompt";

/** What the reporter said in the video (its first words under it). */
export const SAID = "I click Pay and nothing happens";

const svg = (d: string, w = 1.8) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);
const X = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" dangerouslySetInnerHTML={{ __html: '<path d="M6 6l12 12M18 6 6 18"/>' }} />;
const PLAY = <svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: '<path d="M8 5v14l11-7z"/>' }} />;
const MIC = (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>' }} />
);
const ICON = {
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  prompt: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

/** popup.js's REC_FALLBACK: the poster a video shows until its own frame lands. */
const REC_POSTER =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='%23fbfaf7'/><rect width='320' height='26' fill='%23ece6d6'/><circle cx='14' cy='13' r='4' fill='%23dd6936'/><circle cx='28' cy='13' r='4' fill='%23d9d2c4'/><circle cx='42' cy='13' r='4' fill='%23d9d2c4'/><g fill='%23d9d2c4'><rect x='16' y='52' width='200' height='10' rx='3'/><rect x='16' y='78' width='250' height='10' rx='3'/><rect x='16' y='104' width='150' height='10' rx='3'/></g></svg>";

/** A screenshot of Acme's checkout, Pay circled in red. */
export const CHECKOUT_SHOT =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'><rect width='640' height='400' fill='%23f4f6fa'/><rect width='640' height='52' fill='%23fff'/><rect x='24' y='18' width='26' height='16' rx='4' fill='%232f5bd3'/><rect x='58' y='20' width='54' height='12' rx='3' fill='%231d2330'/><rect x='44' y='84' width='150' height='18' rx='4' fill='%231d2330'/><rect x='44' y='124' width='330' height='200' rx='10' fill='%23fff' stroke='%23e3e7ee'/><g fill='%23d5dbe6'><rect x='66' y='150' width='200' height='11' rx='3'/><rect x='66' y='190' width='170' height='11' rx='3'/><rect x='66' y='230' width='190' height='11' rx='3'/></g><rect x='394' y='124' width='202' height='200' rx='10' fill='%23fff' stroke='%23e3e7ee'/><rect x='414' y='150' width='110' height='11' rx='3' fill='%23d5dbe6'/><rect x='414' y='250' width='162' height='38' rx='8' fill='%232f5bd3'/><ellipse cx='495' cy='269' rx='108' ry='38' fill='none' stroke='%23e5484d' stroke-width='4'/></svg>";

const MENU: Array<{ key: CreateMode; icon: string; t: string; s: string }> = [
  { key: "ticket", icon: ICON.send, t: "Create in Linear", s: "File the ticket now" },
  { key: "draft", icon: ICON.link, t: "Share link", s: "Public page, kept in Drafts" },
  { key: "prompt", icon: ICON.prompt, t: "Fix prompt", s: "Copies a prompt for your agent" },
];

/** popup.html's three ways, as its markup has them. */
function Ways({ on, used }: { on?: ChoiceKey; used: { video: boolean; shots: number; replay: boolean } }) {
  return (
    <div className="ev-ways-in" id="ways">
      {!used.video && (
        <button data-gd="choice-video" className={`ev-way ev-rec${on === "video" ? " gd-hover" : ""}`} type="button" tabIndex={-1}>
          <span className="ev-ic">{svg('<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>')}</span>
          <span className="ev-t">
            <b>Record and talk</b>
            <small>Brief writes it</small>
          </span>
        </button>
      )}
      {used.shots < 3 && (
        <div className={`ev-way-card${on === "shot" ? " gd-hover" : ""}`} id="shotRow">
          <div className="ev-way-split">
            <button data-gd="choice-shot" className="ev-way" id="wayShot" type="button" tabIndex={-1}>
              <span className="ev-ic">{svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>')}</span>
              <span className="ev-t">
                <b>Screenshot</b>
                <small>Mark what is wrong on it</small>
              </span>
            </button>
            <button className="way-opt" type="button" tabIndex={-1}>
              <span className="way-opt-v">No delay</span>
              {svg('<path d="m6 9 6 6 6-6"/>', 2)}
            </button>
          </div>
        </div>
      )}
      {!used.replay && (
        <button data-gd="choice-replay" className={`ev-way${on === "replay" ? " gd-hover" : ""}`} id="wayRep" type="button" tabIndex={-1}>
          <span className="ev-ic">{svg('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>')}</span>
          <span className="ev-t">
            <b>Last minute</b>
            <small>Replay this tab</small>
          </span>
        </button>
      )}
    </div>
  );
}

/** popup.js renderGallery: the video first, then the last minute and the screenshots, one row each. */
function Rows({ tiles }: { tiles: Tile[] }) {
  const order = [...tiles.map((t, i) => ({ t, i }))].sort((a, b) => rank(a.t) - rank(b.t));
  let shotNo = 0;
  return (
    <div className="tiles">
      {order.map(({ t, i }) => {
        const enter = t.on ? " enter" : "";
        if (t.kind === "video") {
          return (
            <div key={i} data-gd={`tile-${i}`} className={`tile rec${enter}`}>
              <button className="remove" aria-label="Remove recording" tabIndex={-1}>
                {X}
              </button>
              <div className="thumb">
                <img src={REC_POSTER} alt="" />
                <span className="play">{PLAY}</span>
              </div>
              <div className="rc-body">
                <div className="rec-foot">
                  <span className={`updot${t.uploading ? " up" : ""}`} />
                  {t.uploading ? "Uploading" : "Video · 0:12"}
                </div>
                {!t.uploading && (
                  <span className="voice-line">
                    <span className="ico">{MIC}</span>
                    <span className="ntxt">“{SAID}”</span>
                  </span>
                )}
              </div>
            </div>
          );
        }
        if (t.kind === "replay") {
          return (
            <div key={i} data-gd={`tile-${i}`} className={`tile rep${enter}`}>
              <div className="thumb">
                <img src={REC_POSTER} alt="" />
                <span className="play">{PLAY}</span>
              </div>
              <div className="rc-body">
                <div className="rec-foot rep-t">Last minute · 0:34</div>
                <div className="rep-s">acme.com</div>
              </div>
              <button className="remove" aria-label="Remove the last minute" tabIndex={-1}>
                {X}
              </button>
            </div>
          );
        }
        shotNo++;
        return (
          <div key={i} data-gd={`tile-${i}`} className={`tile shot${enter}`}>
            <button className="remove" aria-label="Remove screenshot" tabIndex={-1}>
              {X}
            </button>
            <div className="thumb">
              <img src={CHECKOUT_SHOT} alt="" />
            </div>
            <div className="rc-body">
              <div className="rep-t">Screenshot {shotNo}</div>
              <div className={`rep-s note-line${t.label ? "" : " empty"}`}>{t.label || "Describe what this shows"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
const rank = (t: Tile) => (t.kind === "video" ? 0 : t.kind === "replay" ? 1 : 2);

export function MockPopup({
  tiles = [],
  addOn,
  wayOn,
  desc,
  typing,
  fieldOn,
  createDown,
  mode = "ticket",
  menuOn,
  menuHover,
  sheet,
  toast,
  fly,
  cloud,
  bash,
}: {
  tiles?: Tile[];
  /** "+ Add" under the pointer. */
  addOn?: boolean;
  /** With no evidence yet: the way under the pointer. */
  wayOn?: ChoiceKey;
  desc?: string;
  typing?: boolean;
  fieldOn?: boolean;
  createDown?: boolean;
  /** What the button does (picked in its menu). */
  mode?: CreateMode;
  menuOn?: boolean;
  menuHover?: CreateMode;
  sheet?: Sheet;
  toast?: string;
  /** The dot from Create to Home. */
  fly?: boolean;
  cloud?: "landed" | "unseen" | "sending";
  /** The quality competition your clock runs in: its name, the time left, and whether it holds reports for a review. */
  bash?: { name: string; left: string; hold?: boolean; off?: boolean };
}) {
  const used = { video: tiles.some((t) => t.kind === "video"), shots: tiles.filter((t) => t.kind === "shot").length, replay: tiles.some((t) => t.kind === "replay") };
  const has = tiles.length > 0;
  const chooser = sheet?.kind === "chooser";
  const held = mode === "ticket" && bash?.hold && !bash.off;
  const label = mode === "draft" ? "Share link" : mode === "prompt" ? "Fix prompt" : held ? null : "Create in Linear";

  // the dot flies from Create to Home, as flyToCloud measures them
  const root = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!fly || !el) return setPath(null);
    const from = el.querySelector<HTMLElement>("#createBtn")!.getBoundingClientRect();
    const to = el.querySelector<HTMLElement>("#briefCloudBtn")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const k = box.width / el.offsetWidth || 1;
    setPath({
      left: (from.left - box.left + from.width / 2) / k - 6,
      top: (from.top - box.top + from.height / 2) / k - 6,
      ["--dx" as string]: `${(to.left + to.width / 2 - (from.left + from.width / 2)) / k}px`,
      ["--dy" as string]: `${(to.top + to.height / 2 - (from.top + from.height / 2)) / k}px`,
    });
  }, [fly]);

  return (
    <Real className="gd-popwrap">
      <div ref={root} className={`xp gd-xp${bash ? " gd-xp-bash" : ""}`}>
        <main className="app" id="app">
          <header className="header">
            <span className="mark" aria-hidden="true">
              <svg viewBox="0 0 128 128" width="26" height="26">
                <rect x="0" y="0" width="128" height="128" rx="28" fill="#dd6936" />
                <path fill="#f5f1e8" d="M26 38 Q26 26 38 26 L52 26 L52 34 L40 34 Q34 34 34 40 L34 52 L26 52 Z M26 90 Q26 102 38 102 L52 102 L52 94 L40 94 Q34 94 34 88 L34 76 L26 76 Z M102 90 Q102 102 90 102 L76 102 L76 94 L88 94 Q94 94 94 88 L94 76 L102 76 Z" />
                <path fill="#f5f1e8" d="M64 40 C67 52, 76 61, 88 64 C76 67, 67 76, 64 88 C61 76, 52 67, 40 64 C52 61, 61 52, 64 40 Z" />
                <g fill="#ffffff">
                  <ellipse cx="84" cy="40" rx="8" ry="7" />
                  <ellipse cx="95" cy="35" rx="10" ry="9" />
                  <ellipse cx="104" cy="40" rx="7" ry="6" />
                  <rect x="80" y="38" width="28" height="9" rx="4" />
                </g>
              </svg>
            </span>
            <h1 className="title">
              What&apos;s the <em>brief</em>?
            </h1>
            <div className="header-actions">
              <button className="hbtn reset-btn" type="button" tabIndex={-1}>
                {svg('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/>', 1.9)}
              </button>
              <button key={cloud} data-gd="cloud" className={`hbtn cloud-btn${cloud === "landed" ? " landed unseen" : cloud ? ` ${cloud}` : ""}`} id="briefCloudBtn" type="button" tabIndex={-1}>
                {svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>')}
              </button>
            </div>
          </header>

          <section className="composer">
            <div className="ev-head" hidden={!has}>
              <span className="ev-head-t">Evidence</span>
              <button data-gd="add" className={`ev-add${addOn ? " gd-hover" : ""}`} type="button" tabIndex={-1}>
                {svg('<path d="M12 5v14M5 12h14"/>', 2)}
                Add
              </button>
            </div>
            <div className={`ev-card${has ? " has" : ""}`} id="evCard">
              <div className="gallery">{has && <Rows tiles={tiles} />}</div>
              {!has && (
                <div className="ev-ways open" id="evWays">
                  <Ways on={wayOn} used={used} />
                </div>
              )}
            </div>
            <div className="ai-wrap">
              <div data-gd="field" id="descField" className={`ai-field has-mic gd-field${fieldOn ? " gd-focus" : ""}`}>
                {desc ? <span className={typing ? "gd-type gd-caret" : ""}>{desc}</span> : <span className="gd-ph">What went wrong? What did you expect?</span>}
              </div>
            </div>
          </section>

          <div className="create-wrap" id="createWrap">
            {bash && (
              <div data-gd="bash-row" className={`bash-row${bash.off ? " off" : ""}`} id="bashRow">
                <span className="bash-ico" aria-hidden="true">
                  {svg(
                    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
                    1.9,
                  )}
                </span>
                <span className="bash-txt">
                  <span className="bash-label">
                    Quality competition <span className="bash-timer">{bash.left}</span>
                  </span>
                  <span className="bash-name">{bash.name}</span>
                </span>
                <button data-gd="bash-switch" className={`switch${bash.off ? "" : " on"}`} type="button" tabIndex={-1}>
                  <span className="knob" />
                </button>
              </div>
            )}
            <div className="create-split">
              <button data-gd="create" className={`cta primary${createDown ? " gd-down" : ""}`} id="createBtn" type="button" tabIndex={-1}>
                <span className="ctk-label">
                  {held ? (
                    <>
                      <span>Add to</span> <span className="ctk-name">{bash!.name}</span>
                    </>
                  ) : (
                    <>
                      {mode !== "ticket" && svg(mode === "draft" ? ICON.link : ICON.prompt, 1.9)}
                      {label}
                    </>
                  )}
                </span>
              </button>
              <button data-gd="caret" className="cta primary caret" type="button" aria-expanded={!!menuOn} tabIndex={-1}>
                {svg('<path d="m18 15-6-6-6 6"/>', 2.2)}
              </button>
            </div>
            <div className={`create-menu${menuOn ? " open" : ""}`} role="menu">
              {MENU.map((m) => (
                <button key={m.key} data-gd={`m-${m.key}`} className={`cm-item${menuHover === m.key ? " gd-hover" : ""}`} type="button" role="menuitemradio" aria-checked={mode === m.key} tabIndex={-1}>
                  <span className="cm-ico">{svg(m.icon, 1.9)}</span>
                  <span className="cm-txt">
                    <span className="cm-t">{m.t}</span>
                    <span className="cm-s">{m.key === "ticket" && bash ? (bash.hold ? "Held for the quality competition review" : "Filed now, with the quality competition label") : m.s}</span>
                  </span>
                  <span className="cm-check">{svg(ICON.check, 1.9)}</span>
                </button>
              ))}
            </div>
          </div>
        </main>

        <div className={`scrim${sheet ? " open" : ""}`} />
        <div className={`sheet${sheet ? " open" : ""}`} role="dialog">
          <div className="handle" />
          <div className="sheet-head">
            <div className="sheet-title">
              {chooser ? (
                "Add evidence"
              ) : (
                <>
                  Screenshot <em>1</em>
                </>
              )}
            </div>
            <button className={`sheet-close${chooser ? "" : " confirm"}`} type="button" tabIndex={-1}>
              {chooser ? svg('<path d="M18 6 6 18M6 6l12 12"/>', 2) : svg('<path d="M5 13l4 4L19 7"/>', 2.6)}
            </button>
          </div>
          <div className="sheet-body">
            {sheet?.kind === "chooser" && (
              <div className="ev-ways open">
                <Ways on={sheet.on} used={used} />
              </div>
            )}
            {sheet?.kind === "shot" && (
              <>
                <button data-gd="edit-drawing" className="shot-preview shot-open" type="button" tabIndex={-1}>
                  <img src={CHECKOUT_SHOT} alt="" />
                  <span className={`rec-edit${sheet.editOn ? " gd-down" : ""}`}>
                    {svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 2)}
                    Edit
                  </span>
                </button>
                <div className="field-label">Note</div>
                <div className="ai-wrap">
                  <div data-gd="note" className={`ai-field has-mic gd-field${sheet.typing ? " gd-focus" : ""}`}>
                    {sheet.note ? <span className={sheet.typing ? "gd-type gd-caret" : ""}>{sheet.note}</span> : <span className="gd-ph">What is wrong in this screenshot?</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={`toast${toast ? " show" : ""}`}>
          {toast && svg(ICON.check, 2.4)}
          <span>{toast}</span>
        </div>
        {fly && path && <span className="fly-dot gd-xfly" style={path} />}
      </div>
    </Real>
  );
}
