// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import TrackerPicker, { availableFirst, menuPlacement } from "./TrackerPicker";

// The real option list lives beside the connect hook, which imports Clerk.
vi.mock("@clerk/nextjs", () => ({ useUser: vi.fn(), useReverification: vi.fn() }));
import { TRACKER_OPTIONS as OPTIONS } from "./useTrackerConnect";

afterEach(cleanup);

/** Swap in a scrollIntoView spy (jsdom has none) for the length of `run`. */
function withScrollSpy(run: (spy: ReturnType<typeof vi.fn>) => void) {
  const spy = vi.fn();
  Element.prototype.scrollIntoView = spy;
  try {
    run(spy);
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
}

const activeName = () => {
  const list = screen.getByRole("listbox");
  return document.getElementById(list.getAttribute("aria-activedescendant") ?? "")?.textContent;
};

function setup(props: Partial<ComponentProps<typeof TrackerPicker>> = {}) {
  const onConnect = vi.fn();
  const onDisconnect = vi.fn();
  const view = render(
    <TrackerPicker
      options={OPTIONS}
      connected="linear"
      stale={[]}
      busy={{}}
      messageFor={() => null}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      {...props}
    />,
  );
  return { ...view, onConnect, onDisconnect };
}

const trigger = () => screen.getByRole("button", { expanded: false });

function pick(name: string) {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }));
}

describe("TrackerPicker", () => {
  it("shows only the tracker you're connected to", () => {
    setup();
    expect(trigger().textContent).toContain("Linear");
    expect(screen.queryByText("Jira")).toBeNull();
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("lists every tracker when opened, with the current one selected", () => {
    setup();
    fireEvent.click(trigger());
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent?.replace("connected", ""))).toEqual([
      "Linear",
      "Jira",
      "GitHub",
      "GitLab",
      "Azure DevOps",
      "ClickUp",
      "Notion",
      "Trello",
      "Asana",
      "Monday",
    ]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("scrolls the list rather than outgrowing the window", () => {
    setup();
    fireEvent.click(trigger());
    expect(screen.getByRole("listbox").className).toMatch(/max-h-\S+ .*overflow-y-auto/);
  });

  it("keeps the keyboard's option in view", () => {
    withScrollSpy((scrollIntoView) => {
      setup();
      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "End" });
      const last = screen.getByRole("option", { name: /Monday/ });
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(last);
    });
  });

  it("doesn't scroll the list on hover", () => {
    withScrollSpy((scrollIntoView) => {
      setup();
      fireEvent.click(trigger());
      scrollIntoView.mockClear();
      fireEvent.mouseEnter(screen.getByRole("option", { name: /Asana/ }));
      expect(activeName()).toBe("Asana");
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  it("pages through the list", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "PageDown" });
    expect(activeName()).toBe("ClickUp");
    fireEvent.keyDown(list, { key: "PageDown" });
    expect(activeName()).toBe("Monday");
    fireEvent.keyDown(list, { key: "PageUp" });
    expect(activeName()).toBe("Azure DevOps");
  });

  it("jumps to a tracker by typing its name", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "a" });
    expect(activeName()).toBe("Azure DevOps");
    // The same letter again moves on to the next tracker that starts with it.
    fireEvent.keyDown(list, { key: "a" });
    expect(activeName()).toBe("Asana");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(trigger().textContent).toContain("Asana");
  });

  it("types more than one letter", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    for (const key of "git") fireEvent.keyDown(list, { key });
    expect(activeName()).toBe("GitHub");
    fireEvent.keyDown(list, { key: "l" });
    expect(activeName()).toBe("GitLab");
  });

  it("reads a space inside a typed name as part of it, not as a pick", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    for (const key of "azure d") fireEvent.keyDown(list, { key });
    expect(screen.queryByRole("listbox")).toBeTruthy();
    expect(activeName()).toBe("Azure DevOps");
  });

  it("says in the list which trackers aren't available yet", () => {
    setup({ unavailable: ["monday"] });
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: /Monday/ }).textContent).toContain("Not available yet");
    expect(screen.getByRole("option", { name: /Asana/ }).textContent).not.toContain("Not available yet");
  });

  it("says why a stale tracker can't be reconnected here", () => {
    setup({ stale: ["linear"], unavailable: ["linear"] });
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect →" })).toHaveProperty("disabled", true);
  });

  it("shows an error that names no tracker before one is chosen", () => {
    setup({ connected: null, notice: "Couldn't connect" });
    expect(trigger().textContent).toContain("Choose a tracker");
    expect(screen.getByText("Couldn't connect")).toBeTruthy();
  });

  it("won't connect a tracker this deployment can't connect yet", () => {
    const { onConnect } = setup({ connected: null, unavailable: ["monday"] });
    pick("Monday");
    const connect = screen.getByRole("button", { name: "Connect Monday →" });
    expect(connect).toHaveProperty("disabled", true);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    fireEvent.click(connect);
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("won't switch to a tracker this deployment can't connect yet", () => {
    setup({ unavailable: ["trello"] });
    pick("Trello");
    expect(screen.getByRole("button", { name: "Switch to Trello →" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("connects an available tracker as usual next to an unavailable one", () => {
    setup({ connected: null, unavailable: ["monday"] });
    pick("Asana");
    expect(screen.getByRole("button", { name: "Connect Asana →" })).toHaveProperty("disabled", false);
    expect(screen.queryByText("Not available yet")).toBeNull();
  });

  it("asks for a workspace pick instead of calling it connected", () => {
    const { onDisconnect } = setup({ connected: "asana", needsWorkspace: ["asana"] });
    expect(screen.getByText("Workspace needed")).toBeTruthy();
    expect(screen.queryByText("Connected ✓")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect →" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledWith("asana");
    expect(screen.getByRole("link", { name: "Pick" }).getAttribute("href")).toBe("#team");
  });

  it("calls Azure DevOps' missing pick an organization", () => {
    setup({ connected: "azure", needsWorkspace: ["azure"] });
    expect(screen.getByText("Organization needed")).toBeTruthy();
    expect(screen.queryByText("Connected ✓")).toBeNull();
  });

  it("previews another tracker without switching to it", () => {
    const { onConnect } = setup();
    pick("Jira");
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Switch to Jira →" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("switches only when asked", () => {
    const { onConnect } = setup();
    pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Switch to Jira →" }));
    expect(onConnect).toHaveBeenCalledWith("jira");
  });

  it("says which tracker a switch replaces", () => {
    setup();
    pick("Jira");
    expect(screen.getByRole("button", { name: "Switch to Jira →" }).getAttribute("title")).toBe(
      "Replaces Linear",
    );
  });

  it("goes back to the connected tracker on cancel", () => {
    setup();
    pick("Jira");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger().textContent).toContain("Linear");
    expect(screen.getByText("Connected ✓")).toBeTruthy();
  });

  it("offers to connect when nothing is connected yet", () => {
    const { onConnect } = setup({ connected: null });
    expect(trigger().textContent).toContain("Choose a tracker");
    pick("GitHub");
    fireEvent.click(screen.getByRole("button", { name: "Connect GitHub →" }));
    expect(onConnect).toHaveBeenCalledWith("github");
  });

  it("asks to reconnect a tracker whose grant went stale", () => {
    const { onConnect } = setup({ stale: ["linear"] });
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect →" }));
    expect(onConnect).toHaveBeenCalledWith("linear");
  });

  it("disconnects", () => {
    const { onDisconnect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledWith("linear");
  });

  it("opens on the tracker whose last attempt didn't finish, with its message", () => {
    setup({
      connected: null,
      initialSelected: "jira",
      messageFor: (k) => (k === "jira" ? "Last connection didn’t finish" : null),
    });
    expect(trigger().textContent).toContain("Jira");
    expect(screen.getByText("Last connection didn’t finish")).toBeTruthy();
  });

  it("keeps the card on a tracker you just disconnected", () => {
    const { rerender, onConnect, onDisconnect } = setup();
    rerender(
      <TrackerPicker
        options={OPTIONS}
        connected={null}
        stale={[]}
        busy={{}}
        messageFor={() => null}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );
    expect(screen.getByRole("button", { name: "Connect Linear →" })).toBeTruthy();
  });

  it("works from the keyboard", () => {
    setup();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to Jira →" })).toBeTruthy();
  });

  it("closes on Escape and hands focus back", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    setup();
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("locks the choice while something is in flight", () => {
    setup({ busy: { linear: true } });
    expect(trigger()).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Disconnecting…" })).toBeTruthy();
  });
});

// The Settings list clips its rows (overflow: hidden), and ten trackers no longer
// fit inside one, so the menu is portalled to <body> and placed by hand.
describe("menu placement", () => {
  const rect = (top: number, bottom: number, left = 200) => ({ top, bottom, left }) as DOMRect;

  it("opens below the trigger when there is room", () => {
    expect(menuPlacement(rect(100, 124), 820)).toEqual({ left: 196, top: 130, maxHeight: 352 });
  });

  it("opens above the trigger near the bottom of the window", () => {
    const place = menuPlacement(rect(700, 724), 820);
    expect(place.top).toBeUndefined();
    expect(place.bottom).toBe(126);
    expect(place.maxHeight).toBe(352);
  });

  it("takes the roomier side, never runs past the window and never starts off its left edge", () => {
    // 158px below the trigger, 282px above it: the menu goes up, capped to fit.
    const place = menuPlacement(rect(300, 324, 4), 500);
    expect(place.left).toBe(12);
    expect(place.bottom).toBe(206);
    expect(place.maxHeight).toBe(282);
  });

  it("is rendered outside the card, so a clipping parent can't cut it off", () => {
    const { container } = render(
      <div style={{ overflow: "hidden" }}>
        <TrackerPicker options={OPTIONS} connected={null} stale={[]} busy={{}} defaultOpen messageFor={() => null} onConnect={() => {}} onDisconnect={() => {}} />
      </div>,
    );
    const list = screen.getByRole("listbox");
    expect(container.contains(list)).toBe(false);
    expect(list.parentElement).toBe(document.body);
  });
});

// The trackers someone can actually connect come first; "Soon" ones follow,
// each group keeping the registry order.
describe("available trackers first", () => {
  it("moves unavailable trackers after the others, keeping each group's order", () => {
    const keys = availableFirst(OPTIONS, ["gitlab", "clickup", "monday"]).map((o) => o.key);
    expect(keys).toEqual(["linear", "jira", "github", "azure", "notion", "trello", "asana", "gitlab", "clickup", "monday"]);
  });

  it("leaves the order alone when everything is available", () => {
    expect(availableFirst(OPTIONS, []).map((o) => o.key)).toEqual(OPTIONS.map((o) => o.key));
  });

  it("lists the menu in that order", () => {
    render(
      <TrackerPicker
        options={OPTIONS}
        connected="github"
        stale={[]}
        unavailable={["gitlab", "clickup", "notion", "trello", "asana", "monday"]}
        busy={{}}
        defaultOpen
        messageFor={() => null}
        onConnect={() => {}}
        onDisconnect={() => {}}
      />,
    );
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.slice(0, 4).map((n) => n.split(/connected|Soon|Not available/)[0].trim())).toEqual([
      "Linear",
      "Jira",
      "GitHub",
      "Azure DevOps",
    ]);
    expect(names.slice(4).every((n) => n.includes("Soon"))).toBe(true);
  });
});
