/**
 * A person's picture, or their initials on the accent tint when there isn't one.
 * Shared by the podium and the Settings team list.
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
  return imageUrl ? (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={imageUrl}
      alt=""
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[rgba(221,105,54,.12)] text-[0.6875rem] text-accent"
    >
      {initialsOf(name)}
    </span>
  );
}
