import type { RoiSummary } from "@/lib/roi";

/**
 * The case for Brief, above everything else on the dashboard.
 *
 * Short on purpose: the first version was a full sentence and read as prose to
 * be skimmed past. The numbers are the argument, so they carry the line and the
 * words around them are the minimum that makes them mean something.
 *
 * The measured figures lead. The estimate follows, marked with a ~ and the word
 * estimate, and carrying its assumption in the tooltip - a dashboard that hides
 * what its numbers rest on is one nobody can defend in front of a customer.
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
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted">
        {orgName}
      </p>

      <p className="mt-1 font-display text-[1.75rem] leading-tight text-ink sm:text-[2.125rem]">
        <span className="text-accent">{n(roi.filed)} bugs</span> spotted and filed
        with Brief.
      </p>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {roi.withEvidence > 0 && (
          <>
            <span>
              <span className="text-ink-2">{n(roi.withEvidence)}</span> with a video
              or screenshot attached
            </span>
            <span aria-hidden>·</span>
          </>
        )}
        <span title={roi.basis} className="cursor-help border-b border-dotted hairline">
          ~<span className="text-ink-2">{n(roi.hoursSaved)} hours</span> saved
        </span>
        <span className="text-muted/70">(estimate)</span>
      </p>
    </section>
  );
}
