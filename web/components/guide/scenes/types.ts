import type { ComponentType } from "react";
import type { Frame } from "../useScene";

/**
 * One lesson's illustration: the frames to play and the view that draws a
 * frame's state. `poster` is the frame shown as a still (hub cards).
 */
export type SceneDef<S = unknown> = {
  frames: Frame<S>[];
  View: ComponentType<{ s: S }>;
  poster: number;
};

export function scene<S>(def: SceneDef<S>): SceneDef<S> {
  return def;
}

// Where things are, in % of the stage, for the cursor. Measured on the
// rendered mocks (the popup sits under the Brief icon, top right).
export const AT = {
  briefIcon: [94.5, 13.2],
  puzzle: [90.5, 13.2],
  cloud: [92.4, 21.8],
  addTile: [66.6, 40.1],
  addTileAfterOne: [76, 40.1],
  firstTile: [66.6, 39],
  field: [78.1, 61],
  create: [78.1, 80.4],
  draft: [78.1, 87.4],
  choice: { shot: [78, 42], video: [78, 55.1], replay: [78, 68.2], upload: [78, 81.2] },
  stop: [36.5, 92.7],
  rest: [56, 70],
} as const satisfies Record<string, unknown>;
