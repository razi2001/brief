// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import TryItDemo from "./TryItDemo";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const q = (c: HTMLElement, s: string) => c.querySelector<HTMLElement>(s);

describe("TryItDemo", () => {
  it("opens straight on the bug 1 intro: no start screen", () => {
    const { container } = render(<TryItDemo onOpenGuide={() => {}} />);
    expect(q(container, ".gate")).toBeNull();
    const scene = q(container, ".scene")!;
    expect(scene.classList.contains("run")).toBe(true);
    expect(scene.textContent).toContain("Bug 1 of 2");
  });

  it("never offers to create an account", () => {
    const { container } = render(<TryItDemo onOpenGuide={() => {}} />);
    expect(container.textContent).not.toMatch(/Create free account|Sign up free/);
    expect(container.querySelector('a[href*="sign-up"]')).toBeNull();
  });

  it("ends on Open the Guide and Play again", () => {
    const onOpenGuide = vi.fn();
    const { container } = render(<TryItDemo onOpenGuide={onOpenGuide} />);
    const guide = q(container, '[data-act="guide"]')!;
    expect(guide.textContent).toBe("Open the Guide");
    expect(q(container, '[data-act="again"]')!.textContent).toBe("Play again");
    act(() => guide.click());
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer running once unmounted", () => {
    const { container, unmount } = render(<TryItDemo onOpenGuide={() => {}} />);
    act(() => q(container, '[data-act="pay"]')!.click()); // a 900 ms timer
    act(() => q(container, '[data-act="brief"]')!.click()); // the popup and a hint
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
