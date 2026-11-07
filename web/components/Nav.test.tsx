// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import { cleanup, render, screen } from "@testing-library/react";
import Nav from "./Nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
afterEach(cleanup);

const labels = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("the sidebar", () => {
  it("lists the fixed items with Feature requests last", () => {
    render(<Nav />);
    expect(labels()).toEqual(["Home", "Tickets", "Drafts", "Settings", "How to use Brief", "Feature requests"]);
  });

  it("keeps Feature requests last even after the owner's links", () => {
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
      "Drafts",
      "Settings",
      "How to use Brief",
      "All tickets",
      "Activity",
      "Feature requests",
    ]);
  });

  it("points Feature requests at /requests", () => {
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Feature requests" }).getAttribute("href")).toBe("/requests");
  });
});
