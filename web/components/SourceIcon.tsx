/**
 * Small crisp inline-SVG icon for a brief's source kind. Falls back to the
 * ✦ "mix" mark for unknown kinds. Stroke uses currentColor so callers control
 * the tint via text color.
 */
export default function SourceIcon({
  kind,
  size = 14,
  className,
}: {
  kind?: string | null;
  size?: number;
  className?: string;
}) {
  const k = (kind ?? "").toLowerCase();
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (k.includes("record") || k.includes("video") || k.includes("recording")) {
    // recording — camcorder
    return (
      <svg {...common}>
        <rect x="2.5" y="6.5" width="13" height="11" rx="2" />
        <path d="M15.5 10.5 21 7.5v9l-5.5-3" />
      </svg>
    );
  }
  if (k.includes("screenshot") || k.includes("image") || k.includes("shot")) {
    // screenshot — picture frame
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="m4 17 5-5 4 4 3-3 4 4" />
      </svg>
    );
  }
  if (k.includes("text") || k.includes("note") || k.includes("write")) {
    // text — pen / write
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  // mix / fallback — ✦ four-point star
  return (
    <svg {...common}>
      <path d="M12 3c.7 3.6 2.7 5.6 6.3 6.3-3.6.7-5.6 2.7-6.3 6.3-.7-3.6-2.7-5.6-6.3-6.3C9.3 8.6 11.3 6.6 12 3Z" />
    </svg>
  );
}
