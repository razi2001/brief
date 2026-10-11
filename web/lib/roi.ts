/**
 * The one-line case for Brief, built only from things we actually measured.
 *
 * Three numbers get claimed, and they are not equally solid - so the split is
 * deliberate:
 *
 *  - tickets filed, and how many carried a recording or screenshot: MEASURED.
 *  - how long capture took: MEASURED (created_at -> filed). Not shown any
 *    more, but still subtracted below so the hours aren't overstated.
 *  - writing time saved: an ESTIMATE, and the only one. It needs a
 *    counterfactual - how long the same report would have taken by hand - and
 *    nothing in our data can observe that. So the assumption is a named
 *    constant, it is stated in `basis` for the UI to show, and the capture time
 *    we DID measure is subtracted rather than treated as free.
 *
 * What is deliberately absent: any count of tickets that "wouldn't exist
 * without Brief". It is the most flattering claim available and there is no
 * signal for it whatsoever - a number invented for it is the one a customer
 * would be right to challenge.
 */

/**
 * Minutes to write a comparable report by hand: title, repro steps, expected
 * versus actual, and attaching a screenshot. Deliberately conservative - the
 * point is a figure that survives someone arguing with it.
 */
export const MINUTES_BY_HAND = 15;

/**
 * The most capture time one ticket is charged. The measured figure is
 * created_at -> updated_at, and updated_at also moves whenever the ticket's
 * status syncs back from the tracker - days later - so an uncapped mean ran
 * into days and wiped the saving out entirely. A real capture is minutes.
 */
export const MAX_CAPTURE_SECONDS = 5 * 60;

/** Below this the sentence isn't worth the space, and rounds to "0 hours". */
const MIN_HOURS = 1;

export type RoiInput = {
  filed: number;
  withEvidence: number;
  /** Mean capture-to-filed seconds. 0 when unknown. */
  avgSeconds: number;
};

export type RoiSummary = {
  filed: number;
  withEvidence: number;
  hoursSaved: number;
  /** The assumption behind hoursSaved, for the UI to show rather than hide. */
  basis: string;
};

export function summarizeRoi(input: RoiInput): RoiSummary | null {
  const filed = Math.max(0, Math.floor(input.filed));
  if (filed === 0) return null;

  // Can't have carried evidence more often than it was filed.
  const withEvidence = Math.min(filed, Math.max(0, Math.floor(input.withEvidence)));

  const avgSeconds = Math.min(MAX_CAPTURE_SECONDS, Math.max(0, input.avgSeconds));
  // Net, not gross: capture is quick but it isn't nothing, and claiming the
  // full by-hand estimate would be overstating it.
  const savedMinutes = filed * MINUTES_BY_HAND - (filed * avgSeconds) / 60;
  const hoursSaved = Math.round(savedMinutes / 60);
  if (hoursSaved < MIN_HOURS) return null;

  return {
    filed,
    withEvidence,
    hoursSaved,
    basis: `Estimated against ${MINUTES_BY_HAND} minutes to write a comparable report by hand, less the capture time actually measured.`,
  };
}
