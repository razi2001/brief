import { describe, expect, it } from "vitest";
import { FULL_LEAN_PX, pupilOffset } from "./googly";

describe("pupilOffset", () => {
  it("looks straight ahead when the pointer is on the eye", () => {
    expect(pupilOffset({ x: 10, y: 10 }, { x: 10, y: 10 }, 2)).toEqual({ dx: 0, dy: 0 });
  });

  it("leans all the way toward a far pointer, and no further", () => {
    const { dx, dy } = pupilOffset({ x: 0, y: 0 }, { x: 500, y: 0 }, 2);
    expect(dx).toBeCloseTo(2);
    expect(dy).toBeCloseTo(0);
  });

  it("looks the way the pointer is", () => {
    const { dx, dy } = pupilOffset({ x: 0, y: 0 }, { x: -300, y: -300 }, 2);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
    expect(Math.hypot(dx, dy)).toBeCloseTo(2);
  });

  it("leans only part of the way toward a nearby pointer", () => {
    const { dx } = pupilOffset({ x: 0, y: 0 }, { x: FULL_LEAN_PX / 2, y: 0 }, 2);
    expect(dx).toBeCloseTo(1);
  });

  it("stays put when it has no room to move", () => {
    expect(pupilOffset({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual({ dx: 0, dy: 0 });
  });
});
