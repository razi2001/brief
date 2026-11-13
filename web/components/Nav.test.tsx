// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import { cleanup, render, screen } from "@testing-library/react";
import Nav from "./Nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
afterEach(cleanup);

const labels = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("the sidebar", () => {
  it("lists the places you work in, then the help links, Feature requests last", () => {
    render(<Nav />);
    expect(labels()).toEqual(["Home", "Tickets", "Bug bash", "Settings", "How to use Brief", "Feature requests"]);
  });

  it("puts the owner's links before the help links, Feature requests still last", () => {
    render(
      <Nav
        extra={
          <>
            <Link href="/admin">All tickets</Link>
            <Link href="/admin/activity">Activity</Link>
          </>
        }
      />,
    );
    expect(labels()).toEqual([
      "Home",
      "Tickets",
      "Bug bash",
      "Settings",
      "All tickets",
      "Activity",
      "How to use Brief",
      "Feature requests",
    ]);
  });

  it("points Feature requests at /requests", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Feature requests" }).getAttribute("href")).toBe("/requests");
  });
});
