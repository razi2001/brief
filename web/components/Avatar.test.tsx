// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Avatar from "./Avatar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PHOTO = "https://img.clerk.com/photo";

describe("Avatar", () => {
  it("shows the photo when there is one", () => {
    const { container } = render(<Avatar name="Adnen Farhani" imageUrl={PHOTO} size={22} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
    expect(screen.queryByText("AF")).toBeNull();
  });

  it("shows the initials when there is no photo", () => {
    const { container } = render(<Avatar name="Adnen Farhani" size={22} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AF")).toBeTruthy();
  });

  it("falls back to the initials when the photo fails to load", () => {
    const { container } = render(<Avatar name="Adnen Farhani" imageUrl={PHOTO} size={22} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AF")).toBeTruthy();
  });

  it("falls back when the photo had already failed before the page was live", () => {
    // A server-rendered <img> can fail before React listens for its error event.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    const { container } = render(<Avatar name="Adnen Farhani" imageUrl={PHOTO} size={22} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AF")).toBeTruthy();
  });

  it("gives a new photo its own try", () => {
    const { container, rerender } = render(<Avatar name="Adnen Farhani" imageUrl={PHOTO} size={22} />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Avatar name="Adnen Farhani" imageUrl={`${PHOTO}-2`} size={22} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`${PHOTO}-2`);
  });
});
