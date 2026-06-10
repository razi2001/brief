/**
 * Ambient cloud background. A fixed, behind-everything layer painted over the
 * cream body: several large, heavily-blurred radial-gradient "clouds" in warm
 * tones that drift slowly. Purely decorative (aria-hidden, pointer-events: none)
 * and frozen under prefers-reduced-motion (handled in globals.css).
 *
 * Rendered once in app/layout.tsx so it sits behind every page.
 */
export default function CloudBackground() {
  return (
    <div
      aria-hidden="true"
      className="cloud-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* warm-white, top-left */}
      <span className="cloud cloud-1" />
      {/* cream-2, top-right */}
      <span className="cloud cloud-2" />
      {/* faint peach accent, bottom-right */}
      <span className="cloud cloud-3" />
      {/* bright highlight, bottom-left */}
      <span className="cloud cloud-4" />
      {/* soft warm-white, center drift */}
      <span className="cloud cloud-5" />
    </div>
  );
}
