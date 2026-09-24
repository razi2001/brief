// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { GooglyCrown, Hatted } from "./PodiumHats";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GooglyCrown", () => {
  it("looks toward the pointer", async () => {
    const { container } = render(<GooglyCrown />);
    // jsdom lays nothing out, so both eyes sit at (0, 0): a pointer far to the
    // right should push both pupils all the way right.
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 0 }));
    await waitFor(() => {
      const pupils = container.querySelectorAll(".googly-pupil");
      expect(pupils).toHaveLength(2);
      pupils.forEach((p) => expect(p.getAttribute("transform")).toBe("translate(2.40 0.00)"));
    });
  });

  it("holds still for people who asked for less motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { container } = render(<GooglyCrown />);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 50));
    container
      .querySelectorAll(".googly-pupil")
      .forEach((p) => expect(p.getAttribute("transform")).toBeNull());
  });

  it("blinks now and then", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0); // the shortest gap: 2.5s
    const { container } = render(<GooglyCrown />);
    const eye = () => container.querySelector(".googly-eye")!;
    expect(eye().getAttribute("data-blink")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(eye().getAttribute("data-blink")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(140);
    });
    expect(eye().getAttribute("data-blink")).toBe("false");
  });
});

describe("Hatted", () => {
  it.each([
    [1, "crown"],
    [2, "party"],
    [3, "paper"],
  ])("gives place %i the %s", (rank, hat) => {
    const { container } = render(
      <Hatted rank={rank}>
        <span>face</span>
      </Hatted>,
    );
    expect(container.querySelector(`[data-hat="${hat}"]`)).toBeTruthy();
  });

  it("leaves everyone past third bareheaded", () => {
    const { container } = render(
      <Hatted rank={4}>
        <span>face</span>
      </Hatted>,
    );
    expect(container.querySelector("[data-hat]")).toBeNull();
    expect(container.textContent).toBe("face");
  });
});
