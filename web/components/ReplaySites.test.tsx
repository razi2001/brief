// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReplaySites from "./ReplaySites";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    json: async () => ({ ok: true, replaySites: JSON.parse(String(init.body)).replaySites }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const field = () => screen.getByLabelText("Site") as HTMLInputElement;
const add = () => screen.getByText("Add") as HTMLButtonElement;

describe("the site field", () => {
  it("checks the site as you type", () => {
    render(<ReplaySites team={null} mine={[]} />);
    expect(add().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "acme..com" } });
    expect(screen.getByText("Not a site")).toBeTruthy();
    expect(add().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    expect(screen.queryByText("Not a site")).toBeNull();
    expect(add().disabled).toBe(false);
  });

  it("typing *. turns Subdomains on, and the saved site is the wildcard", async () => {
    render(<ReplaySites team={null} mine={[]} />);
    fireEvent.change(field(), { target: { value: "*.acme.com" } });
    expect(field().value).toBe("acme.com");
    expect(screen.getByText("Subdomains").closest("button")?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(add());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).replaySites).toEqual(["*.acme.com"]);
    expect(await screen.findByLabelText("Remove *.acme.com")).toBeTruthy();
  });

  it("a paste of a full URL keeps only its host", () => {
    render(<ReplaySites team={null} mine={[]} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => "https://Staging.Acme.io:8443/orders/12?tab=x" } });
    expect(field().value).toBe("staging.acme.io:8443");
  });
});

describe("saving", () => {
  it("your sites go to your settings; the team's to the org", async () => {
    render(<ReplaySites team={{ name: "Acme", sites: ["*.acme.com"] }} mine={[]} />);
    fireEvent.click(screen.getByLabelText("Remove *.acme.com"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/org/replay-sites");
  });

  it("an answer without a list (signed out) puts the list back and says so", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new Error("html"); } });
    render(<ReplaySites team={null} mine={["localhost:3000"]} />);
    fireEvent.change(field(), { target: { value: "app.acme.com" } });
    fireEvent.click(add());
    expect(await screen.findByText("Couldn't save. Reload and try again.")).toBeTruthy();
    expect(screen.getByLabelText("Remove localhost:3000")).toBeTruthy();
    expect(screen.queryByLabelText("Remove app.acme.com")).toBeNull();
  });
});
