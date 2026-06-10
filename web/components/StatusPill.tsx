type BriefStatus = "uploaded" | "processing" | "filed" | "failed";

const styles: Record<string, string> = {
  filed: "border-[rgba(46,125,50,.35)] bg-[rgba(46,125,50,.1)] text-[#2e7d32]",
  failed: "border-[rgba(198,40,40,.35)] bg-[rgba(198,40,40,.1)] text-[#c62828]",
  processing: "border-[rgba(221,105,54,.4)] bg-[rgba(221,105,54,.1)] text-accent",
  uploaded: "border-hairline bg-cream-2 text-ink-2",
};

/**
 * Status chip for a brief. Colors: uploaded = muted, processing = accent with a
 * subtle pulse dot, filed = green, failed = red.
 */
export default function StatusPill({ status }: { status: string }) {
  const s = status as BriefStatus;
  return (
    <span className={`pill ${styles[s] ?? styles.uploaded}`}>
      {s === "processing" && (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      )}
      {status}
    </span>
  );
}
