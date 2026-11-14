"use client";

import { useState } from "react";

/**
 * A person's picture, or their initials on the accent tint when there isn't
 * one or it won't load. Shared by the podium, the admin list and the Settings
 * team list.
 */

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // "Razi Fezzani" -> RF; a lone first name keeps its first two letters.
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

export default function Avatar({
  name,
  imageUrl,
  size,
}: {
  name: string;
  imageUrl?: string;
  size: number;
}) {
  // The photo that failed, so a new one gets its own try.
  const [failed, setFailed] = useState<string>();
  return imageUrl && imageUrl !== failed ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={imageUrl}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
      onError={() => setFailed(imageUrl)}
      // A server-rendered photo can fail before React listens for onError.
      ref={(el) => {
        if (el?.complete && el.naturalWidth === 0) setFailed(imageUrl);
      }}
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[#fbe9df] text-[0.6875rem] text-accent"
    >
      {initialsOf(name)}
    </span>
  );
}
