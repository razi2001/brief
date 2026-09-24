// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import TrackerPicker, { type TrackerOption } from "./TrackerPicker";

afterEach(cleanup);

const OPTIONS: TrackerOption[] = [
  { key: "linear", name: "Linear", caption: "Files tickets with embedded evidence." },
  { key: "jira", name: "Jira", caption: "Atlassian Cloud - file to a project." },
  { key: "github", name: "GitHub", caption: "File issues to a repository." },
];

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
    expect(options).toHaveLength(3);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
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

  it("says which tracker a switch disconnects", () => {
    setup();
    pick("Jira");
    expect(screen.getByRole("button", { name: "Switch to Jira →" }).getAttribute("title")).toBe(
      "Disconnects Linear",
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
