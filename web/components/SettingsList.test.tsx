// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SettingsList from "./SettingsList";

afterEach(cleanup);

const rows = [
  { id: "tracker", label: "Tracker", icon: "tracker" as const, summary: "Linear", body: <p>tracker editor</p> },
  { id: "replay", label: "Replay", icon: "replay" as const, summary: "2 sites", body: <p>replay editor</p> },
];

describe("SettingsList", () => {
  it("shows every row with its value, editors closed", () => {
    render(<SettingsList rows={rows} />);
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.getByText("2 sites")).toBeTruthy();
    expect(screen.queryByText("tracker editor")).toBeNull();
  });

  it("a click opens a row in place, one at a time, and closes it again", () => {
    render(<SettingsList rows={rows} />);
    fireEvent.click(screen.getByText("Tracker"));
    expect(screen.getByText("tracker editor")).toBeTruthy();
    fireEvent.click(screen.getByText("Replay"));
    expect(screen.queryByText("tracker editor")).toBeNull();
    expect(screen.getByText("replay editor")).toBeTruthy();
    fireEvent.click(screen.getByText("Replay"));
    expect(screen.queryByText("replay editor")).toBeNull();
  });

  it("a row with nothing to edit is plain: no button, never opens", () => {
    render(<SettingsList rows={[...rows, { id: "team", label: "Team", icon: "team" as const, summary: "Just you" }]} />);
    expect(screen.getByText("Just you")).toBeTruthy();
    expect(screen.getByText("Team").closest("button")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("opens on the row it is asked to, or the one in the link", () => {
    render(<SettingsList rows={rows} initialOpen="tracker" />);
    expect(screen.getByText("tracker editor")).toBeTruthy();
    cleanup();
    window.location.hash = "#replay";
    render(<SettingsList rows={rows} />);
    expect(screen.getByText("replay editor")).toBeTruthy();
    window.location.hash = "";
  });
});
