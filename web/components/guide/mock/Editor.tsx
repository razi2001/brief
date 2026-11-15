"use client";
import { MockAcme, type AcmePage } from "./Acme";
import { Real } from "./Real";
import "./real/editor.css";

/** editor/shell.js's icons. */
const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6"/></svg>',
};
const Icon = ({ name }: { name: keyof typeof ICON }) => <span className="gd-ico" dangerouslySetInnerHTML={{ __html: ICON[name] }} />;

/** crop.js's formats. */
const FORMATS = ["Free", "16:9", "4:3", "1:1", "9:16"];

/** The picture, 640 by 400 real pixels; the Acme page is drawn to fill it. */
const MEDIA_W = 640;
/** Where the trim strip runs in the 1000px page: after Play, before the clock and the speed. */
const TL = { left: 78, width: 764 };

/**
 * The evidence editor (player.html, replay.html), drawn by the extension's own
 * stylesheet (real/editor.css, a scoped copy of editor/editor.css) on the
 * markup editor/shell.js builds: the title, Cancel and Save; the picture on
 * its stage (with crop.js's box while cropping); the tool pill (Crop, Sound,
 * Record voice, Mark) with crop's formats or a mark's note above it; Play,
 * the trim strip (timeline.js), the clock and the speed. Positions are % of
 * the strip. `voice` is the Record voice button: a take running ("Stop 0:04")
 * or a take kept ("Voice 0:04"). `glide` moves the playhead over that many
 * seconds, as playback does.
 */
export function MockEditor({
  kind,
  page,
  searching,
  keep = [0, 100],
  head = 30,
  crop,
  tool,
  mark,
  action = "Save",
  actionOn,
  voice,
  glide,
}: {
  kind: "recording" | "replay";
  page: AcmePage;
  searching?: boolean;
  keep?: [number, number];
  head?: number;
  crop?: boolean;
  tool?: "crop" | "mark";
  mark?: { at: number; note?: string };
  action?: string;
  actionOn?: boolean;
  voice?: { rec?: boolean; secs: number };
  glide?: number;
}) {
  const total = 33;
  const kept = Math.round(((keep[1] - keep[0]) / 100) * total);
  const at = Math.min(Math.round((Math.max(0, head - keep[0]) / 100) * total), kept);
  const clock = (secs: number) => `0:${String(secs).padStart(2, "0")}`;
  const pct = (x: number) => `${x}%`;
  const flagX = mark ? TL.left + (mark.at / 100) * TL.width : 0;
  return (
    <Real>
      <div className="xe gd-xe">
        <header className="ed-head">
          <h1 className="ed-title">{kind === "replay" ? "Replay" : "Recording"}</h1>
          <button className="link" type="button" tabIndex={-1}>
            Cancel
          </button>
          <button data-gd="ed-save" className={`save${actionOn ? " gd-press" : ""}`} type="button" tabIndex={-1}>
            {action}
          </button>
        </header>
        <main className="ed-stage">
          <div className="media" style={{ width: MEDIA_W, height: MEDIA_W * 0.625 }}>
            <div className="gd-edpic" style={{ ["--u" as string]: `${MEDIA_W / 800}px` }}>
              <MockAcme page={page} searching={searching} query={searching ? "1042" : undefined} />
            </div>
            {crop && (
              <div className={`crop-layer${tool === "crop" ? " editing" : ""}`}>
                <div className="crop-box" style={{ left: "8%", top: "16%", width: "60%", height: "62%" }}>
                  <div className="grid" />
                  <span className="c nw" />
                  <span className="c ne" />
                  <span className="c sw" />
                  <span className="c se" />
                </div>
              </div>
            )}
          </div>
        </main>
        <div className="ed-tools">
          {tool === "crop" && (
            <div className="opts">
              {FORMATS.map((f) => (
                <button key={f} type="button" className={`opt${f === "Free" ? " on" : ""}`} tabIndex={-1}>
                  {f}
                </button>
              ))}
            </div>
          )}
          <div className="pillbar">
            <button data-gd="tool-crop" type="button" className={`tool${tool === "crop" ? " on" : ""}`} tabIndex={-1}>
              <Icon name="crop" />
              <span>Crop</span>
              {crop && <span className="dot" />}
            </button>
            {kind === "recording" && (
              <button type="button" className="tool" tabIndex={-1}>
                <Icon name="speaker" />
                <span>Sound on</span>
              </button>
            )}
            <button data-gd="tool-voice" type="button" className={`tool${voice?.rec ? " recording" : ""}`} tabIndex={-1}>
              {voice?.rec ? (
                <>
                  <i className="rdot" />
                  <span>Stop {clock(voice.secs)}</span>
                </>
              ) : voice ? (
                <>
                  <Icon name="voice" />
                  <span>Voice {clock(voice.secs)}</span>
                  <span className="vx">×</span>
                </>
              ) : (
                <>
                  <Icon name="voice" />
                  <span>Record voice</span>
                </>
              )}
            </button>
            <button data-gd="tool-mark" type="button" className={`tool${tool === "mark" ? " on" : ""}${mark ? " has" : ""}`} tabIndex={-1}>
              <Icon name="flag" />
              <span>{mark ? "Mark · 1" : "Mark"}</span>
            </button>
          </div>
        </div>
        <div className="ed-time">
          <button className="play" type="button" tabIndex={-1}>
            <Icon name="play" />
          </button>
          <div className="tl">
            <div className="tl-track">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="cell" />
              ))}
            </div>
            <div className="tl-out l" style={{ left: 0, width: pct(keep[0]) }} />
            <div className="tl-out r" style={{ left: pct(keep[1]), right: 0 }} />
            <div className="tl-sel" style={{ left: pct(keep[0]), width: pct(keep[1] - keep[0]) }} />
            <span data-gd="h-start" className="tl-h" data-edge="a" style={{ left: pct(keep[0]) }} />
            <span data-gd="h-end" className="tl-h" data-edge="b" style={{ left: pct(keep[1]) }} />
            <div className="tl-marks">{mark && <span className="tl-mark" style={{ left: pct(mark.at) }} />}</div>
            <div className="tl-head" style={{ left: pct(head), transition: glide ? `left ${glide}s linear` : undefined }} />
          </div>
          <span className="clock">
            {clock(at)} <span>/ {clock(kept)}</span>
          </span>
          <button className="speed" type="button" tabIndex={-1}>
            1×
          </button>
        </div>
        {mark?.note && (
          <div className="mark-pop gd-markpop" style={{ left: flagX - 40, ["--tip" as string]: "41px" }}>
            <span className="mark-note gd-type gd-caret">{mark.note}</span>
            <button type="button" className="mx" tabIndex={-1}>
              <Icon name="trash" />
            </button>
          </div>
        )}
      </div>
    </Real>
  );
}
