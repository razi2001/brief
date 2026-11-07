// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NudgeAdmin, { PushCardButton } from "./NudgeAdmin";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
const preview = () => screen.getByLabelText("Card preview").textContent;

describe("NudgeAdmin", () => {
  it("previews the built-in text when nothing is saved, and the typed text live", () => {
    render(<NudgeAdmin saved={{ message: "", button: "" }} lastEveryone={null} />);
    expect(preview()).toContain("Seen a bug?");
    expect(preview()).toContain("Brief it");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Found a glitch?" } });
    expect(preview()).toContain("Found a glitch?");
  });

  it("saves the text, and Save stays off until something changes", async () => {
    fetchMock.mockReturnValue(ok({ ok: true, message: "Found a glitch?", button: "Report" }));
    render(<NudgeAdmin saved={{ message: "", button: "" }} lastEveryone={null} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Found a glitch?" } });
    fireEvent.change(screen.getByLabelText("Button"), { target: { value: "Report" } });
    fireEvent.click(save);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge", expect.objectContaining({ method: "PUT", body: JSON.stringify({ message: "Found a glitch?", button: "Report" }) }));
  });

  it("asks before showing it to everyone", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<NudgeAdmin saved={{ message: "", button: "" }} lastEveryone={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Show to everyone" }));
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fetchMock.mockReturnValue(ok({ ok: true, at: "2026-11-07T10:00:00Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Show to everyone" }));
    await screen.findByText(/Last sent/);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge/push", expect.objectContaining({ body: "{}" }));
  });
});

describe("PushCardButton", () => {
  it("pushes to one person without asking, and says when", async () => {
    fetchMock.mockReturnValue(ok({ ok: true, at: "2026-11-07T10:00:00Z" }));
    render(<PushCardButton userId="user_2abc" last={null} label="Show the bug card" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the bug card" }));
    await screen.findByText(/Last sent 7 Nov/);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge/push", expect.objectContaining({ body: JSON.stringify({ userId: "user_2abc" }) }));
  });

  it("says so when it fails", async () => {
    fetchMock.mockReturnValue(Promise.resolve({ ok: false }));
    render(<PushCardButton userId="user_2abc" last={null} label="Show the bug card" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the bug card" }));
    await screen.findByText("Not sent");
  });
});
