// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TrendChart, { type TrendDay } from "./TrendChart";

afterEach(cleanup);

/** Same formatting the component uses, so these tests hold in any locale. */
const fmt = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const barFor = (count: number, iso: string) => `${count} filed on ${fmt(iso)}`;

const days: TrendDay[] = [
  { date: "2026-09-01", count: 0 },
  { date: "2026-09-02", count: 4 },
  { date: "2026-09-03", count: 7 },
];

describe("TrendChart", () => {
  it("shows the period total when nothing is pointed at", () => {
    const { container } = render(<TrendChart days={days} />);
    expect(container.textContent).toContain("11 filed");
  });

  it("swaps the readout to the day you point at", () => {
    const { container } = render(<TrendChart days={days} />);
    fireEvent.mouseEnter(screen.getByLabelText(barFor(7, "2026-09-03")));
    expect(container.textContent).toContain("7 filed");
    expect(container.textContent).not.toContain("11 filed");
  });

  it("goes back to the total when you point away", () => {
    const { container } = render(<TrendChart days={days} />);
    const bar = screen.getByLabelText(barFor(4, "2026-09-02"));
    fireEvent.mouseEnter(bar);
    expect(container.textContent).toContain("4 filed");
    fireEvent.mouseLeave(bar.parentElement!);
    expect(container.textContent).toContain("11 filed");
  });

  it("works from the keyboard, not just the mouse", () => {
    const { container } = render(<TrendChart days={days} />);
    const bar = screen.getByLabelText(barFor(4, "2026-09-02"));
    fireEvent.focus(bar);
    expect(container.textContent).toContain("4 filed");
    fireEvent.blur(bar);
    expect(container.textContent).toContain("11 filed");
  });

  it("reads out a day with nothing filed, so an empty column is still findable", () => {
    render(<TrendChart days={days} />);
    expect(screen.getByLabelText(barFor(0, "2026-09-01"))).toBeTruthy();
  });

  it("gives every bar a control that can be reached", () => {
    render(<TrendChart days={days} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
