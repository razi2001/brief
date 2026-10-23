// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import AutoRefresh from "./AutoRefresh";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// No polling in these tests: only the mount behavior is under test.
const mount = (renderId: string) =>
  render(
    <StrictMode>
      <AutoRefresh active={false} idleIntervalMs={0} renderId={renderId} />
    </StrictMode>,
  );

afterEach(() => {
  cleanup();
  router.refresh.mockClear();
});

describe("a feed coming back from the client cache", () => {
  it("doesn't refetch a page the server just rendered", () => {
    mount("fresh-1");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("refetches, once, when the same render shows again (Back, or a cached link)", () => {
    mount("cached-1");
    cleanup();

    mount("cached-1");

    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("takes the render a refresh brought in as fresh, and refetches when it comes back", () => {
    const { rerender } = mount("first-2");
    rerender(
      <StrictMode>
        <AutoRefresh active={false} idleIntervalMs={0} renderId="second-2" />
      </StrictMode>,
    );
    expect(router.refresh).not.toHaveBeenCalled();
    cleanup();

    mount("second-2");

    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
