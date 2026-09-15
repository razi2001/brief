import type { RoiSummary } from "@/lib/roi";

/**
 * The one-line case for Brief, above everything else on the dashboard.
 *
 * Plain text rather than another card: a headline should read as a headline,
 * not compete with the panels underneath it.
 *
 * The estimated figure is marked as estimated - the tickets, the evidence and
 * the capture time are measured, the hours are not, and the tooltip carries the
 * assumption so anyone who wants to argue with the number can see what it rests
 * on. A dashboard that hides its assumptions is one nobody can defend in front
 * of a customer.
 */
export default function RoiHeadline({
  roi,
  orgName,
}: {
  roi: RoiSummary;
  orgName: string;
}) {
  const n = (v: number) => v.toLocaleString();
  return (
    <section className="animate-rise mb-6">
      <p className="max-w-3xl font-display text-2xl leading-snug text-ink sm:text-[1.75rem]">
        {orgName} has filed <span className="text-accent">{n(roi.filed)} tickets</span>{" "}
        with Brief
        {roi.withEvidence > 0 && (
          <>
            {" "}
            — <span className="text-accent">{n(roi.withEvidence)}</span> of them
            carrying a recording or screenshot
          </>
        )}
        {roi.capture && <>, {roi.capture} each from capture to filed</>}.
      </p>
      <p className="mt-1.5 text-xs text-muted">
        <span title={roi.basis} className="cursor-help border-b border-dotted hairline">
          Roughly {n(roi.hoursSaved)} hours of writing saved
        </span>{" "}
        · estimated, unlike the figures above
      </p>
    </section>
  );
}
