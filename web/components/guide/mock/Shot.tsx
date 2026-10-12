import { MockAcme, type AcmePage } from "./Acme";

/**
 * The screenshot annotator (shot.html): the page dims, the capture sits in the
 * middle, red pen strokes on it, and the bar at the bottom.
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
    <div className="gd-shot">
      <div data-gd="shot-layer" className="layer">
        <div className="pic">
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
              strokeWidth="2"
              strokeLinecap="round"
              pathLength={1}
              style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: "gd-draw 1s 0.4s ease-out forwards" }}
            />
          </svg>
        )}
      </div>
      <div className="bar">
        <span className="hint">Draw in red to point at the issue</span>
        <span className={`tool${drawn ? "" : " dim"}`}>Undo</span>
        <span className={`tool${drawn ? "" : " dim"}`}>Clear</span>
        <span className="tool ghost">Cancel</span>
        <span data-gd="shot-save" className={`tool primary${saveOn ? " gd-hl" : ""}`}>Save</span>
      </div>
    </div>
  );
}
