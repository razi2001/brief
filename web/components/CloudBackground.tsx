/**
 * The sky behind every page: a warm cream gradient with a soft sun glow, and
 * puffy clouds - lit from above, shaded underneath - travelling slowly across
 * in three depths (far ones small, hazy and slow; near ones big and crisper).
 * Fixed and decorative (pointer-events: none). Rendered once in
 * app/layout.tsx; the app panel is translucent so the clouds glide visibly
 * behind it. Frozen under prefers-reduced-motion (globals.css).
 */

// [layer, top %, width px, travel seconds, delay seconds, shape]
const CLOUDS: Array<[string, number, number, number, number, "a" | "b" | "c"]> = [
  ["far", 6, 260, 260, -30, "b"],
  ["far", 34, 220, 300, -170, "a"],
  ["far", 62, 300, 280, -90, "c"],
  ["far", 86, 240, 320, -240, "b"],
  ["mid", 14, 300, 190, -60, "c"],
  ["mid", 46, 260, 210, -150, "b"],
  ["mid", 74, 320, 200, -20, "a"],
  ["near", 24, 340, 150, -100, "a"],
  ["near", 58, 300, 170, -10, "b"],
  ["near", 90, 360, 160, -70, "c"],
];

export default function CloudBackground() {
  return (
    <div className="sky" aria-hidden="true">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <linearGradient id="cloudFill" gradientUnits="userSpaceOnUse" x1="0" y1="4" x2="0" y2="84">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#fffcf6" />
            <stop offset="1" stopColor="#f6efe4" />
          </linearGradient>
        </defs>
        {/* three silhouettes, each a flat-bottomed heap of round puffs */}
        <symbol id="cloudA" viewBox="0 0 200 90">
          <g fill="url(#cloudFill)">
            <circle cx="62" cy="52" r="26" />
            <circle cx="96" cy="38" r="34" />
            <circle cx="136" cy="50" r="26" />
            <circle cx="160" cy="62" r="18" />
            <circle cx="38" cy="64" r="16" />
            <rect x="34" y="56" width="140" height="26" rx="13" />
          </g>
        </symbol>
        <symbol id="cloudB" viewBox="0 0 240 90">
          <g fill="url(#cloudFill)">
            <circle cx="50" cy="60" r="20" />
            <circle cx="82" cy="44" r="28" />
            <circle cx="122" cy="34" r="32" />
            <circle cx="162" cy="46" r="26" />
            <circle cx="196" cy="62" r="18" />
            <rect x="34" y="58" width="180" height="24" rx="12" />
          </g>
        </symbol>
        <symbol id="cloudC" viewBox="0 0 180 80">
          <g fill="url(#cloudFill)">
            <circle cx="56" cy="50" r="22" />
            <circle cx="88" cy="36" r="28" />
            <circle cx="122" cy="48" r="22" />
            <rect x="34" y="50" width="112" height="22" rx="11" />
          </g>
        </symbol>
      </svg>

      <div className="sky-sun" />

      {CLOUDS.map(([layer, top, width, dur, delay, shape], i) => (
        <div
          key={i}
          className={`cloud cloud-${layer}`}
          style={{ top: `${top}%`, width, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
        >
          <div className="cloud-bob" style={{ animationDelay: `${-i * 1.7}s` }}>
            <svg viewBox={shape === "b" ? "0 0 240 90" : shape === "a" ? "0 0 200 90" : "0 0 180 80"}>
              <use href={`#cloud${shape.toUpperCase()}`} />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
