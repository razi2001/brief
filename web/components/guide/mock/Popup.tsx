import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import {
  IconCheck,
  IconChevron,
  IconChevronDown,
  IconCloud,
  IconLink,
  IconMic,
  IconPencil,
  IconPlane,
  IconPlay,
  IconPlus,
  IconReplay,
  IconReset,
  IconShot,
  IconTerminal,
  IconVideo,
  IconX,
} from "./icons";

export type Tile = {
  kind: "shot" | "video" | "replay";
  /** A screenshot's note; the video's footer ("Recording", "Uploading"). */
  label?: string;
  uploading?: boolean;
  on?: boolean;
};

export type ChoiceKey = "shot" | "video" | "replay";

export type Sheet =
  | { kind: "chooser"; on?: ChoiceKey }
  | { kind: "shot"; note?: string; typing?: boolean; editOn?: boolean };

/** The ways to add evidence, as popup.html names them. */
const CHOICES: Array<{ key: ChoiceKey; title: string; sub: string; icon: ReactNode }> = [
  { key: "video", title: "Record and talk", sub: "Brief writes it", icon: <IconVideo /> },
  { key: "shot", title: "Screenshot", sub: "Mark what is wrong on it", icon: <IconShot /> },
  { key: "replay", title: "Last minute", sub: "Replay this tab", icon: <IconReplay /> },
];

function Ways({ on }: { on?: ChoiceKey }) {
  return (
    <div className="choices">
      {CHOICES.map((c) => (
        <div key={c.key} data-gd={`choice-${c.key}`} className={`choice${on === c.key ? " on" : ""}`}>
          <span className="ci">{c.icon}</span>
          <span>
            <div className="ct">{c.title}</div>
            <div className="cs">{c.sub}</div>
          </span>
          <span className="chev">
            <IconChevron />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The checkout capture, Pay circled in red: a screenshot's picture. */
export function ShotPicture({ circled = true }: { circled?: boolean }) {
  const bar = (top: number, left: number, w: number, c = "#d5dbe6", h = 6) => (
    <span style={{ position: "absolute", top: `${top}%`, left: `${left}%`, width: `${w}%`, height: `${h}%`, borderRadius: 2, background: c }} />
  );
  return (
    <span style={{ position: "absolute", inset: 0, background: "#f4f6fa" }}>
      <span style={{ position: "absolute", inset: "0 0 auto", height: "13%", background: "#fff" }} />
      {bar(22, 7, 20, "#1d2330", 7)}
      <span style={{ position: "absolute", top: "36%", left: "7%", width: "50%", height: "48%", borderRadius: 4, background: "#fff", border: "1px solid #e3e7ee" }} />
      {bar(44, 11, 40)}
      {bar(56, 11, 34)}
      {bar(68, 11, 40)}
      <span style={{ position: "absolute", top: "36%", left: "61%", width: "32%", height: "48%", borderRadius: 4, background: "#fff", border: "1px solid #e3e7ee" }} />
      {bar(44, 65, 18)}
      <span style={{ position: "absolute", top: "64%", left: "65%", width: "24%", height: "10%", borderRadius: 3, background: "#2f5bd3" }} />
      {circled && <span style={{ position: "absolute", top: "57%", left: "60%", width: "34%", height: "24%", border: "1.5px solid #e5484d", borderRadius: "50%" }} />}
    </span>
  );
}

function Thumb({ kind }: { kind: Tile["kind"] }) {
  if (kind === "shot") return <ShotPicture />;
  const dark = kind === "video";
  return (
    <span style={{ position: "absolute", inset: 0, background: dark ? "#2b2622" : "#f1ede6" }}>
      {[22, 40, 58].map((t, i) => (
        <span key={t} style={{ position: "absolute", top: `${t}%`, left: "12%", width: `${[52, 70, 40][i]}%`, height: "7%", borderRadius: 2, background: dark ? "rgba(245,241,232,.18)" : "rgba(26,22,18,.08)" }} />
      ))}
      <span className="play">
        <IconPlay />
      </span>
    </span>
  );
}

export type CreateMode = "ticket" | "draft" | "prompt";
const MODE_LABEL: Record<CreateMode, string> = {
  ticket: "Create in Linear",
  draft: "Share link",
  prompt: "Fix prompt",
};
const MENU: Array<{ key: CreateMode; icon: ReactNode; t: string; s: string }> = [
  { key: "ticket", icon: <IconPlane />, t: "Create in Linear", s: "File the ticket now" },
  { key: "draft", icon: <IconLink />, t: "Share link", s: "Public page, kept in Drafts" },
  { key: "prompt", icon: <IconTerminal />, t: "Fix prompt", s: "Copies a prompt for your agent" },
];

/**
 * The extension popup, as popup.html draws it: the header (reset, Home), the
 * Evidence card (with nothing yet, the ways to add it: Record and talk,
 * Screenshot, Last minute; then the tiles, and "+ Add" beside Evidence), the
 * "What went wrong?" field, the bug bash row while your clock runs in one, and
 * the Create button with its menu (Create in Linear, Share link, Fix prompt);
 * with the Add evidence sheet or a screenshot's sheet over it, the "Ticket
 * queued" toast, and the dot that flies into Home.
 */
export function MockPopup({
  tiles = [],
  addOn,
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
  wayOn,
  bash,
}: {
  tiles?: Tile[];
  addOn?: boolean;
  /** With no evidence yet: the way the cursor is on. */
  wayOn?: ChoiceKey;
  /** The bug bash your clock runs in: its name, the time left, and whether it holds reports for a review. */
  bash?: { name: string; left: string; hold?: boolean };
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
  /** The dot from Create ticket to the cloud button. */
  fly?: boolean;
  cloud?: "landed" | "unseen" | "sending";
}) {
  let shotNo = 0;
  return (
    <div className="gd-pp">
      <div className="hd">
        <span className="mk">
          <BrandMark />
        </span>
        <span className="title">
          What&apos;s the <em>brief</em>?
        </span>
        <span className="hb">
          <IconReset />
        </span>
        <span key={cloud} data-gd="cloud" className={`hb${cloud === "landed" ? " landed unseen" : cloud ? ` ${cloud}` : ""}`}>
          <IconCloud />
        </span>
      </div>

      <div className="part">
        <div className="lbl ev">
          Evidence
          {tiles.length > 0 && (
            <span data-gd="add" className={`evadd${addOn ? " on" : ""}`}>
              <IconPlus />
              Add
            </span>
          )}
        </div>
        {tiles.length === 0 ? (
          <Ways on={wayOn} />
        ) : (
          <div className="gal">
            {tiles.map((t, i) => {
              if (t.kind === "shot") shotNo++;
              return (
                <div key={`${t.kind}${i}`} data-gd={`tile-${i}`} className={`tile gd-pop${t.on ? " on" : ""}`}>
                  <div className="th">
                    <Thumb kind={t.kind} />
                    {t.kind === "shot" && <span className="badge">{shotNo}</span>}
                    <span className="x">
                      <IconX />
                    </span>
                  </div>
                  {t.kind === "shot" && !t.label ? (
                    <div className="strip empty">Describe it</div>
                  ) : (
                    <div className="strip">
                      {t.kind !== "shot" && <span className={`ok${t.uploading ? " up" : ""}`} />}
                      {t.label ?? (t.kind === "video" ? "Recording" : "Replay")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="part">
        <div data-gd="field" className={`field desc${fieldOn ? " on" : ""}`}>
          {desc ? <span className={typing ? "gd-type gd-caret" : ""}>{desc}</span> : <span className="ph">What went wrong? What did you expect?</span>}
          <span className="mic">
            <IconMic />
          </span>
        </div>
      </div>

      <div className="go">
        {bash && (
          <div data-gd="bash-row" className="bashrow">
            <span className="bico" />
            <span className="btxt">
              <span className="bl">
                Bug bash <span className="bt">{bash.left}</span>
              </span>
              <span className="bn">{bash.name}</span>
            </span>
            <span className="bsw">
              <span />
            </span>
          </div>
        )}
        {menuOn && (
          <div className="cmenu">
            {MENU.map((m) => (
              <div key={m.key} data-gd={`m-${m.key}`} className={`cmi${menuHover === m.key ? " on" : ""}`}>
                <span className={`cmi-ico${mode === m.key ? " cur" : ""}`}>{m.icon}</span>
                <span className="cmi-txt">
                  <span className="cmi-t">{m.t}</span>
                  <span className="cmi-s">{m.s}</span>
                </span>
                {mode === m.key && (
                  <span className="cmi-ck">
                    <IconCheck />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="split">
          <div data-gd="create" className={`create${createDown ? " down" : ""}`}>
            {mode === "draft" ? <IconLink /> : mode === "prompt" ? <IconTerminal /> : null}
            {mode === "ticket" && bash?.hold ? `Add to ${bash.name}` : MODE_LABEL[mode]}
          </div>
          <div data-gd="caret" className={`caret${menuOn ? " open" : ""}`}>
            <IconChevronDown />
          </div>
        </div>
      </div>

      {sheet && (
        <>
          <div className="scrim" />
          <div className="sheet">
            <div className="handle" />
            {sheet.kind === "chooser" ? (
              <>
                <div className="sh">
                  <span className="st">
                    Add <em>evidence</em>
                  </span>
                  <span className="sbtn">
                    <IconX />
                  </span>
                </div>
                <div className="sb">
                  <Ways on={sheet.on} />
                </div>
              </>
            ) : (
              <>
                <div className="sh">
                  <span className="st">
                    Screenshot <em>1</em>
                  </span>
                  <span data-gd="edit-drawing" className={`sbtn${sheet.editOn ? " on" : ""}`}>
                    <IconPencil />
                  </span>
                  <span className="sbtn">
                    <IconX />
                  </span>
                </div>
                <div className="sb">
                  <div className="preview">
                    <ShotPicture />
                  </div>
                  <div className="flabel">Note</div>
                  <div data-gd="note" className={`field${sheet.typing ? " on" : ""}`} style={{ height: "calc(80 * var(--p))" }}>
                    {sheet.note ? (
                      <span className={sheet.typing ? "gd-type gd-caret" : ""}>{sheet.note}</span>
                    ) : (
                      <span className="ph">What is wrong in this screenshot?</span>
                    )}
                    <span className="mic">
                      <IconMic />
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {fly && (
        <span
          className="fly"
          style={
            {
              left: "calc(174 * var(--p))",
              top: "calc(404 * var(--p))",
              "--dx": "calc(146 * var(--p))",
              "--dy": "calc(-369 * var(--p))",
            } as React.CSSProperties
          }
        />
      )}
      {toast && (
        <div className="toast">
          <IconCheck />
          {toast}
        </div>
      )}
    </div>
  );
}
