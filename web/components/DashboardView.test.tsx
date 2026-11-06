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

const entry = (userId: string, rank: number, filed: number, isYou = false) => ({
  userId,
  rank,
  filed,
  name: `Person ${userId}`,
  isYou,
});

describe("Dashboard's leaderboard", () => {
  const boards = {
    month: [entry("a", 1, 6, true), entry("b", 2, 3), entry("c", 3, 1)],
    all: [entry("a", 1, 20, true), entry("b", 2, 9), entry("c", 3, 4)],
  };

  it("is called Quality competition and comes before everything else on the page", () => {
    render(<DashboardView {...props({ boards, filed: 6, extensionPaired: true })} />);
    const competition = screen.getByRole("heading", { name: "Quality competition" });
    expect(screen.queryByText(/top brief reporters/i)).toBeNull();

    const home = screen.getByRole("heading", { name: "Home" });
    const hero = screen.getByText("Tickets filed");
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    // Home title, then the competition, then the return on Brief.
    expect(home.compareDocumentPosition(competition) & FOLLOWING).toBeTruthy();
    expect(competition.compareDocumentPosition(hero) & FOLLOWING).toBeTruthy();
  });

  it("still puts the return on Brief on the page when nobody is on the board yet", () => {
    render(<DashboardView {...props()} />);
    expect(screen.queryByRole("heading", { name: "Quality competition" })).toBeNull();
    expect(screen.getByText("Tickets filed")).toBeTruthy();
  });
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
