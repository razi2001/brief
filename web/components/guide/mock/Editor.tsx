import { MockAcme, type AcmePage } from "./Acme";
import { IconCrop, IconFlag, IconMic, IconPlay, IconSound, IconTrash } from "./icons";

const RATIOS = ["Free", "16:9", "4:3", "1:1", "9:16"];

/**
 * The evidence editor (player.html / replay.html, editor.css): the title, Cancel
 * and Save; the picture on its stage; the tool pill (and crop's ratios above
 * it); play, the trim strip, the clock and the speed. Positions are % of the
 * strip. `voice` is the Record voice button's state (editor/shell.js
 * voiceButtons): a take running ("Stop 0:04") or a take kept ("Voice 0:04").
 * `glide` moves the playhead over that many seconds, as playback does.
 */
export function MockEditor({
  kind,
  page,
  searching,
  keep = [0, 100],
  cut,
  gone,
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
  cut?: number;
  gone?: [number, number];
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
  const kept = Math.round(((keep[1] - keep[0] - (gone ? gone[1] - gone[0] : 0)) / 100) * total);
  // the clock counts kept time, from the start handle
  const at = Math.min(Math.round((Math.max(0, head - keep[0]) / 100) * total), kept);
  const clock = (secs: number) => `0:${String(secs).padStart(2, "0")}`;
  return (
    <div className="gd-ed">
      <div className="eh">
        <span className="t">{kind === "replay" ? "Replay" : "Recording"}</span>
        <span className="link">Cancel</span>
        <span data-gd="ed-save" className={`save${actionOn ? " gd-hl" : ""}`}>{action}</span>
      </div>
      <div className="stagebox">
        <div className="media">
          <div className="pic">
            <MockAcme page={page} searching={searching} query={searching ? "1042" : undefined} />
          </div>
          {crop && (
            <div className="crop" style={{ left: "8%", top: "16%", width: "60%", height: "62%" }}>
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
        </div>
      </div>
      <div className="tools">
        {tool === "crop" && (
          <div className="opts">
            {RATIOS.map((r) => (
              <span key={r} className={`opt${r === "Free" ? " on" : ""}`}>
                {r}
              </span>
            ))}
          </div>
        )}
        {mark?.note && (
          <div className="markpop" style={{ left: "50%", top: "calc(-26 * var(--a))", transform: "translateX(-20%)" }}>
            <span className="note">
              <span className="gd-type gd-caret">{mark.note}</span>
            </span>
            <span className="bin">
              <IconTrash />
            </span>
          </div>
        )}
        <div className="pill">
          <span data-gd="tool-crop" className={`tool${tool === "crop" ? " on" : ""}`}>
            <IconCrop />
            Crop
            {crop && <span className="dot" />}
          </span>
          {kind === "recording" && (
            <span className="tool">
              <IconSound />
              Sound on
            </span>
          )}
          <span data-gd="tool-voice" className={`tool${voice?.rec ? " recording" : ""}`}>
            {voice?.rec ? (
              <>
                <i className="rdot" />
                Stop {clock(voice.secs)}
              </>
            ) : voice ? (
              <>
                <IconMic />
                Voice {clock(voice.secs)}
                <span className="vx">×</span>
              </>
            ) : (
              <>
                <IconMic />
                Record voice
              </>
            )}
          </span>
          <span data-gd="tool-mark" className={`tool${tool === "mark" ? " on" : ""}${mark ? " has" : ""}`}>
            <IconFlag />
            Mark{mark ? " · 1" : ""}
          </span>
        </div>
      </div>
      <div className="time">
        <span className="play">
          <IconPlay />
        </span>
        <div className="tl">
          <div className="track">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="cell" />
            ))}
          </div>
          <span className="out" style={{ left: 0, width: `${keep[0]}%` }} />
          <span className="out" style={{ left: `${keep[1]}%`, right: 0 }} />
          {gone && <span className="gone gd-in" style={{ left: `${gone[0]}%`, width: `${gone[1] - gone[0]}%` }} />}
          <span className="sel" style={{ left: `${keep[0]}%`, right: `${100 - keep[1]}%` }} />
          <span data-gd="h-start" className="h" style={{ left: `${keep[0]}%` }} />
          <span data-gd="h-end" className="h" style={{ left: `${keep[1]}%` }} />
          {cut !== undefined && <span className="cut gd-in" style={{ left: `${cut}%` }} />}
          {mark && <span className="mark" style={{ left: `${mark.at}%` }} />}
          <span className="head" style={{ left: `${head}%`, transition: glide ? `left ${glide}s linear` : undefined }} />
        </div>
        <span className="clock">
          {clock(at)} <span>/ {clock(kept)}</span>
        </span>
        <span className="speed">1×</span>
      </div>
    </div>
  );
}
