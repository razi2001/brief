"use client";
import { MockAcme, type AcmePage } from "./Acme";
import { Real } from "./Real";
import "./real/editor.css";

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
/** editor/shot-editor.js's shapes, colours and icons. */
const SHAPES: Array<[string, string]> = [
  ["Pen", svg('<path d="M3 21c3-1 4.5-3 6-6s3.5-6 7-8 4.5 1.5 2.5 4-6 5-9 7"/>')],
  ["Arrow", svg('<path d="M5 19 19 5M10 5h9v9"/>')],
  ["Box", svg('<rect x="4" y="6" width="16" height="12" rx="2"/>')],
  ["Text", svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>')],
];
const COLORS = ["#ff2d2d", "#ffb020", "#2f7bff", "#22c55e"];
const DRAW = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
const CROP = svg('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>');
const UNDO = svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>');
const TRASH = svg('<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6"/>');
const Html = ({ html }: { html: string }) => <span className="gd-ico" dangerouslySetInnerHTML={{ __html: html }} />;

const MEDIA_W = 540;

/**
 * The screenshot editor (shot.html, over the page), drawn by the extension's
 * own stylesheet (real/editor.css) on the markup editor/shell.js and
 * shot-editor.js build: Screenshot, Cancel and Save; the capture; the pill
 * with Draw on (Pen, Arrow, Box, Text, the colours, Undo, Clear above it) and
 * Crop. `drawn` is the red loop around what is wrong.
 */
export function MockShot({
  page,
  drawn,
  saveOn,
  circle = { left: 25, top: 26, width: 30, height: 20 },
}: {
  page: AcmePage;
  drawn?: boolean;
  saveOn?: boolean;
  /** Where the red loop goes, in % of the capture. */
  circle?: { left: number; top: number; width: number; height: number };
}) {
  return (
    <Real className="gd-shotwrap">
      <div className="xe gd-xe">
        <header className="ed-head">
          <h1 className="ed-title">Screenshot</h1>
          <button className="link" type="button" tabIndex={-1}>
            Cancel
          </button>
          <button data-gd="shot-save" className={`save${saveOn ? " gd-press" : ""}`} type="button" tabIndex={-1}>
            Save
          </button>
        </header>
        <main className="ed-stage">
          <div data-gd="shot-layer" className="media shot-media drawing" style={{ width: MEDIA_W, height: MEDIA_W * 0.625 }}>
            <div className="gd-edpic" style={{ ["--u" as string]: `${MEDIA_W / 800}px` }}>
              <MockAcme page={page} />
            </div>
            {drawn && (
              <svg
                data-gd="shot-mark"
                viewBox="0 0 100 37"
                preserveAspectRatio="none"
                style={{ position: "absolute", left: `${circle.left}%`, top: `${circle.top}%`, width: `${circle.width}%`, height: `${circle.height}%`, overflow: "visible" }}
                aria-hidden="true"
              >
                <path
                  d="M10 21 C 8 6, 70 1, 93 12 C 103 20, 82 35, 46 35 C 18 35, 3 29, 12 15"
                  fill="none"
                  stroke="#ff2d2d"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "gd-draw 1s 0.4s ease-out forwards" }}
                />
              </svg>
            )}
          </div>
        </main>
        <div className="ed-tools">
          <div className="opts">
            {SHAPES.map(([label, icon], i) => (
              <button key={label} type="button" className={`opt${i === 0 ? " on" : ""}`} tabIndex={-1}>
                <Html html={icon} />
                <span>{label}</span>
              </button>
            ))}
            <span className="vsep" />
            {COLORS.map((c, i) => (
              <button key={c} type="button" className={`opt${i === 0 ? " on" : ""}`} tabIndex={-1}>
                <i className="swatch" style={{ background: c }} />
              </button>
            ))}
            <span className="vsep" />
            <button type="button" className="opt" disabled={!drawn} tabIndex={-1}>
              <Html html={UNDO} />
            </button>
            <button type="button" className="opt" disabled={!drawn} tabIndex={-1}>
              <Html html={TRASH} />
            </button>
          </div>
          <div className="pillbar">
            <button type="button" className="tool on" tabIndex={-1}>
              <Html html={DRAW} />
              <span>Draw</span>
            </button>
            <button type="button" className="tool" tabIndex={-1}>
              <Html html={CROP} />
              <span>Crop</span>
            </button>
          </div>
        </div>
      </div>
    </Real>
  );
}
