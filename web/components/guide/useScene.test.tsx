// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepCount, useScene, type Frame } from "./useScene";

const frames: Frame<string>[] = [
  { ms: 1000, step: 0, s: "a" },
  { ms: 500, step: 0, s: "b" },
  { ms: 800, step: 1, s: "c" },
  { ms: 800, step: 2, s: "d" },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useScene", () => {
  it("shows each frame for its own time, then loops", () => {
    const { result } = renderHook(() => useScene(frames, { playing: true }));
    expect(result.current.frame.s).toBe("a");
    act(() => void vi.advanceTimersByTime(999));
    expect(result.current.frame.s).toBe("a");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.frame.s).toBe("b");
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.frame.s).toBe("c");
    // each frame's timer starts once it is on screen, so step frame by frame
    act(() => void vi.advanceTimersByTime(800));
    expect(result.current.frame.s).toBe("d");
    act(() => void vi.advanceTimersByTime(800));
    expect(result.current.frame.s).toBe("a");
  });

  it("holds still when not playing", () => {
    const { result } = renderHook(() => useScene(frames, { playing: false }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current.frame.s).toBe("a");
  });

  it("jumps to a step and plays on from there", () => {
    const { result } = renderHook(() => useScene(frames, { playing: true }));
    act(() => result.current.jumpToStep(1));
    expect(result.current.frame.s).toBe("c");
    act(() => void vi.advanceTimersByTime(800));
    expect(result.current.frame.s).toBe("d");
  });

  it("can land on a step's last frame (for reduced motion)", () => {
    const { result } = renderHook(() => useScene(frames, { playing: false }));
    act(() => result.current.jumpToStep(0, "last"));
    expect(result.current.frame.s).toBe("b");
  });

  it("starts where asked", () => {
    const { result } = renderHook(() => useScene(frames, { playing: false, start: 2 }));
    expect(result.current.frame.s).toBe("c");
  });

  it("counts the steps a scene illustrates", () => {
    expect(stepCount(frames)).toBe(3);
  });
});
