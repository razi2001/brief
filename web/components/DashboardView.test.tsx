// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import DashboardView, { type DashboardViewProps } from "./DashboardView";
import { CHROME_STORE_URL } from "@/lib/chrome-store";

const props = (over: Partial<DashboardViewProps> = {}): DashboardViewProps => ({
  hasTracker: true,
  extensionPaired: false,
  filed: 0,
  thisWeek: 0,
  org: null,
  roi: null,
  boards: { month: [], all: [] },
  ...over,
});

const stepRow = (label: string) => screen.getByText(label).closest("li")!;

// Reduced motion: the count-ups and the bug cloud render still.
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard's Get started", () => {
  it("sends the extension step straight to the Chrome Web Store", () => {
    render(<DashboardView {...props()} />);
    const link = within(stepRow("Add the Brief extension to Chrome")).getByRole("link");
    expect(link.getAttribute("href")).toBe(CHROME_STORE_URL);
  });

  it("gives the first ticket a page to practice on", () => {
    render(<DashboardView {...props({ extensionPaired: true })} />);
    const link = within(stepRow("File your first ticket")).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://get-brief.app/demo-sandbox");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
