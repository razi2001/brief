"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * One moment of a Guide illustration. A scene is a list of these, played in a
 * loop: each shows for `ms`, the cursor glides to `cursor` and clicks if asked,
 * and `s` is whatever the scene's view needs to draw that moment.
 */
export type Frame<S> = {
  ms: number;
  /** The lesson step this moment illustrates (0-based). */
  step: number;
  /**
   * What the cursor points at: an element of the mock marked data-gd="name"
   * (or "name:left" / "name:right" for its edge). Measured on the rendered
   * frame, so it lands where the thing really is.
   */
  target?: string;
  /** Or a free spot, in % of the stage (x, y). No cursor when neither is set. */
  cursor?: readonly [number, number];
  /** Click where the cursor lands. */
  click?: boolean;
  /** Keys held down, shown big over the scene. */
  keys?: string[];
  s: S;
};

export function stepCount(frames: readonly Frame<unknown>[]): number {
  return frames.reduce((n, f) => Math.max(n, f.step + 1), 0);
}

export function useScene<S>(
  frames: readonly Frame<S>[],
  { playing, start = 0 }: { playing: boolean; start?: number },
) {
  const [index, setIndex] = useState(start);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % frames.length), frames[index]?.ms ?? 1000);
    return () => clearTimeout(t);
  }, [index, playing, frames]);

  /** Show a step: its first moment (to play on from), or its last (to hold). */
  const jumpToStep = useCallback(
    (step: number, at: "first" | "last" = "first") => {
      const i = at === "first" ? frames.findIndex((f) => f.step === step) : frames.findLastIndex((f) => f.step === step);
      if (i >= 0) setIndex(i);
    },
    [frames],
  );

  const i = Math.min(index, frames.length - 1);
  return { index: i, frame: frames[i], jumpToStep };
}
