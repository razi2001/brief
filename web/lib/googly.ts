/**
 * Googly-eye maths for the podium crown (components/PodiumHats.tsx).
 *
 * Pure so it can be tested without a DOM: the component measures where the eye
 * and the pointer are, this decides where the pupil sits. The pupil leans toward
 * the pointer, further the further away the pointer is, and never leaves the
 * eye: `max` is the most it may travel from the centre.
 */

export type Point = { x: number; y: number };

/** How far away (px) the pointer has to be before the pupil leans all the way. */
export const FULL_LEAN_PX = 40;

/**
 * The pupil's offset from the centre of its eye.
 *
 * `eye` and `pointer` are screen coordinates in px. The result is in whatever
 * unit `max` is in: the crown passes SVG user units, so the offset goes straight
 * into a `transform` on the pupil.
 */
export function pupilOffset(eye: Point, pointer: Point, max: number): { dx: number; dy: number } {
  const vx = pointer.x - eye.x;
  const vy = pointer.y - eye.y;
  const dist = Math.hypot(vx, vy);
  if (dist === 0 || max <= 0) return { dx: 0, dy: 0 };
  const reach = Math.min(max, (dist / FULL_LEAN_PX) * max);
  return { dx: (vx / dist) * reach, dy: (vy / dist) * reach };
}
