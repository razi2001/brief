import { describe, expect, it } from "vitest";
import { LESSONS } from "@/lib/guide/lessons";
import { stepCount } from "../useScene";
import { SCENES } from "./index";

describe("guide scenes", () => {
  it("every lesson has its scene, with one picture group per step", () => {
    for (const l of LESSONS) {
      const def = SCENES[l.scene];
      expect(def, l.slug).toBeDefined();
      expect(stepCount(def.frames), l.slug).toBe(l.steps.length);
    }
  });

  it("every step of a scene is shown, in order", () => {
    for (const [key, def] of Object.entries(SCENES)) {
      const steps = def.frames.map((f) => f.step);
      expect(steps, key).toEqual([...steps].sort((a, b) => a - b));
      expect(new Set(steps).size, key).toBe(stepCount(def.frames));
    }
  });

  it("posters and cursors stay on the stage", () => {
    for (const [key, def] of Object.entries(SCENES)) {
      expect(def.poster, key).toBeGreaterThanOrEqual(0);
      expect(def.poster, key).toBeLessThan(def.frames.length);
      for (const f of def.frames) {
        expect(f.ms, key).toBeGreaterThan(0);
        if (f.cursor) for (const v of f.cursor) expect(v >= 0 && v <= 100, `${key} ${f.cursor}`).toBe(true);
      }
    }
  });
});
