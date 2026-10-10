// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReplaySites from "./ReplaySites";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    return { ok: true, json: async () => ({ ok: true, replaySites: body.replaySites, sites: body.sites }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = () => screen.getByLabelText("Site") as HTMLInputElement;
const add = () => screen.getByText("Add") as HTMLButtonElement;
const team = { name: "Acme", sites: ["*.acme.com"], members: 6 };
const call = (i: number) => ({ url: fetchMock.mock.calls[i][0], body: JSON.parse(fetchMock.mock.calls[i][1].body) });

describe("the site field", () => {
  it("checks the site as you type", () => {
    render(<ReplaySites team={null} mine={[]} mode="override" />);
    expect(add().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "acme..com" } });
    expect(screen.getByText("Not a site")).toBeTruthy();
    expect(add().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    expect(screen.queryByText("Not a site")).toBeNull();
    expect(add().disabled).toBe(false);
  });

  it("typing *. turns Subdomains on, and the saved site is the wildcard", async () => {
    render(<ReplaySites team={null} mine={[]} mode="override" />);
    fireEvent.change(field(), { target: { value: "*.acme.com" } });
    expect(field().value).toBe("acme.com");
    expect(screen.getByText("Subdomains").closest("button")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(add());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(call(0).body.replaySites).toEqual(["*.acme.com"]);
    expect(await screen.findByLabelText("Remove *.acme.com")).toBeTruthy();
  });

  it("a paste of a full URL keeps only its host", () => {
    render(<ReplaySites team={null} mine={[]} mode="override" />);
    fireEvent.paste(field(), { clipboardData: { getData: () => "https://Staging.Acme.io:8443/orders/12?tab=x" } });
    expect(field().value).toBe("staging.acme.io:8443");
  });
});

describe("team sites or your own, like Ticket rules", () => {
  it("shows only the list that applies: the team's when following it", () => {
    render(<ReplaySites team={team} mine={["localhost:3000"]} mode="inherit" />);
    expect(screen.getByText("Team sites")).toBeTruthy();
    expect(screen.getByLabelText("Remove *.acme.com")).toBeTruthy();
    expect(screen.queryByLabelText("Remove localhost:3000")).toBeNull();
    expect(screen.getByText("Acme · 6 people")).toBeTruthy();
  });

  it("switching to your own saves the choice and shows your list", async () => {
    render(<ReplaySites team={team} mine={["localhost:3000"]} mode="inherit" />);
    fireEvent.click(screen.getByText("Use my own"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(call(0)).toEqual({ url: "/api/settings", body: { replaySitesMode: "override" } });
    expect(screen.getByText("Your sites")).toBeTruthy();
    expect(screen.getByLabelText("Remove localhost:3000")).toBeTruthy();
    expect(screen.queryByLabelText("Remove *.acme.com")).toBeNull();
  });

  it("changing the team's sites asks first, naming who and what", async () => {
    render(<ReplaySites team={team} mine={[]} mode="inherit" />);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    fireEvent.click(add());
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Change Replay sites for 6 people?");
    expect(dialog.textContent).toContain("+ app.acme.com");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Update for everyone"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(call(0)).toEqual({ url: "/api/org/replay-sites", body: { sites: ["*.acme.com", "app.acme.com"] } });
  });

  it("cancelling a team change writes nothing and keeps the list", async () => {
    render(<ReplaySites team={team} mine={[]} mode="inherit" />);
    fireEvent.click(screen.getByLabelText("Remove *.acme.com"));
    expect((await screen.findByRole("dialog")).textContent).toContain("− *.acme.com");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Remove *.acme.com")).toBeTruthy();
  });

  it("alone in the team: says these become the default for whoever joins", async () => {
    render(<ReplaySites team={{ ...team, members: 1 }} mine={[]} mode="inherit" />);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    fireEvent.click(add());
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Set the Replay sites for Acme?");
    expect(dialog.textContent).not.toContain("1 people");
  });

  it("your own sites save straight away - they only affect you", async () => {
    render(<ReplaySites team={team} mine={[]} mode="override" />);
    fireEvent.change(field(), { target: { value: "localhost:3000" } });
    fireEvent.click(add());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(call(0).url).toBe("/api/settings");
  });

  it("no team: just your list, no switch", () => {
    render(<ReplaySites team={null} mine={["localhost:3000"]} mode="inherit" />);
    expect(screen.queryByText("Use my own")).toBeNull();
    expect(screen.getByLabelText("Remove localhost:3000")).toBeTruthy();
  });

  it("an answer without a list (signed out) puts the list back and says so", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("html"); } });
    render(<ReplaySites team={null} mine={["localhost:3000"]} mode="override" />);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    fireEvent.click(add());
    expect(await screen.findByText("Couldn't save. Reload and try again.")).toBeTruthy();
    expect(screen.getByLabelText("Remove localhost:3000")).toBeTruthy();
    expect(screen.queryByLabelText("Remove app.acme.com")).toBeNull();
  });
});
