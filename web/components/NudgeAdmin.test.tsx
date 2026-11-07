// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NudgeAdmin, { EveryoneRow, PushCardButton } from "./NudgeAdmin";

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
  it("previews the built-in line when nothing is saved, and the typed text live", () => {
    render(<NudgeAdmin saved={{ message: "", button: "" }} />);
    expect(preview()).toContain("Seen a bug?");
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Found a glitch?" } });
    expect(preview()).toContain("Found a glitch?");
  });

  it("saves the text, and Save stays off until something changes", async () => {
    fetchMock.mockReturnValue(ok({ ok: true, message: "Found a glitch?", button: "" }));
    render(<NudgeAdmin saved={{ message: "", button: "" }} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Found a glitch?" } });
    fireEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge", expect.objectContaining({ method: "PUT", body: JSON.stringify({ message: "Found a glitch?" }) }));
  });
});

describe("EveryoneRow", () => {
  it("says what happened to the last one", () => {
    render(<EveryoneRow last={{ at: "2026-11-07T10:00:00Z", shown: 4, closed: 2, briefed: 1 }} />);
    expect(screen.getByText(/4 saw it · 2 closed · 1 briefed/)).toBeTruthy();
  });

  it("asks before showing it to everyone", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<EveryoneRow last={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Show to everyone" }));
    expect(fetchMock).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fetchMock.mockReturnValue(ok({ ok: true, at: "2026-11-07T10:00:00Z" }));
    fireEvent.click(screen.getByRole("button", { name: "Show to everyone" }));
    await screen.findByText(/Sent 7 Nov/);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge/push", expect.objectContaining({ body: "{}" }));
  });
});

describe("PushCardButton", () => {
  it("sends to one person and says when; says so when it fails", async () => {
    fetchMock.mockReturnValueOnce(ok({ ok: true, at: "2026-11-07T10:00:00Z" })).mockReturnValueOnce(Promise.resolve({ ok: false }));
    render(<PushCardButton userId="user_2abc" last={null} label="Show the reminder" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the reminder" }));
    await screen.findByText(/Last sent 7 Nov/);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/nudge/push", expect.objectContaining({ body: JSON.stringify({ userIds: ["user_2abc"] }) }));
    fireEvent.click(screen.getByRole("button", { name: "Show the reminder" }));
    await screen.findByText("Not sent");
  });
});
