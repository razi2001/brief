// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import StartButton, { Countdown } from "./StartButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the start button", () => {
  it("starts on a press, and not while disabled", () => {
    const onStart = vi.fn();
    const { rerender } = render(<StartButton label="Start my 1 h" onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /Start my 1 h/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<StartButton label="Start my 1 h" onStart={onStart} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /Start my 1 h/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe("the countdown", () => {
  it("shows nothing until a press, then 3, 2, 1, GO! and goes away", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Countdown run={null} />);
    expect(container.textContent).toBe("");
    rerender(<Countdown run={1} />);
    const seen = [container.textContent];
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(620));
      seen.push(container.textContent);
    }
    expect(seen).toEqual(["3", "2", "1", "GO!", "GO!"]);
    act(() => vi.advanceTimersByTime(200));
    expect(container.textContent).toBe("");
  });
});
