/**
 * Ambient cloud background — a faithful port of get-brief.app's sky: soft SVG
 * cloud shapes (cloudA/cloudB) drifting in parallax layers over the cream base.
 * Fixed behind everything (decorative, pointer-events: none). Rendered once in
 * app/layout.tsx so every page shares the same calm, alive backdrop. Frozen
 * under prefers-reduced-motion (handled in globals.css).
 */
export default function CloudBackground() {
  return (
    <div className="sky" aria-hidden="true">
      {/* cloud shape definitions (same paths as the marketing site) */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <symbol id="cloudA" viewBox="0 0 100 36">
          <path
            d="M16 28 C6 28 4 18 12 16 C10 8 22 4 26 12 C30 4 46 6 46 16 C56 14 60 24 52 28 Z"
            fill="currentColor"
          />
        </symbol>
        <symbol id="cloudB" viewBox="0 0 120 40">
          <path
            d="M14 32 C2 32 2 18 12 18 C8 10 24 4 30 14 C34 4 54 6 54 18 C60 12 78 14 76 22 C90 22 90 34 80 34 Z"
            fill="currentColor"
          />
        </symbol>
      </svg>

      {/* back layer */}
      <div className="cloud bg-1"><svg viewBox="0 0 120 40"><use href="#cloudB" /></svg></div>
      <div className="cloud bg-2"><svg viewBox="0 0 120 40"><use href="#cloudB" /></svg></div>
      {/* mid layer */}
      <div className="cloud mid-1"><svg viewBox="0 0 100 36"><use href="#cloudA" /></svg></div>
      <div className="cloud mid-2"><svg viewBox="0 0 120 40"><use href="#cloudB" /></svg></div>
      <div className="cloud mid-3"><svg viewBox="0 0 120 40"><use href="#cloudB" /></svg></div>
      {/* front layer */}
      <div className="cloud fg-1"><svg viewBox="0 0 100 36"><use href="#cloudA" /></svg></div>
      <div className="cloud fg-2"><svg viewBox="0 0 100 36"><use href="#cloudA" /></svg></div>
    </div>
  );
}
