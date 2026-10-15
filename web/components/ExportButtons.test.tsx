// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExportButtons from "./ExportButtons";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ queued: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("ExportButtons", () => {
  it("shows why the tracker can't file yet", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Pick your Azure DevOps organization under Settings, then retry." }),
    });
    render(<ExportButtons briefId="b1" connected={["azure"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Export to Azure DevOps/ }));

    expect(await screen.findByText("Pick your Azure DevOps organization under Settings, then retry.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows a refusal's line rather than its code", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "already_filing", message: "This brief is being filed right now." }),
    });
    render(<ExportButtons briefId="b1" connected={["linear"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Export to Linear/ }));

    expect(await screen.findByText("This brief is being filed right now.")).toBeTruthy();
    expect(screen.queryByText("already_filing")).toBeNull();
  });

  it("shows why the last export went back to draft", () => {
    render(<ExportButtons briefId="b1" connected={["jira"]} initialError="Jira refused the issue." />);
    expect(screen.getByText("Jira refused the issue.")).toBeTruthy();
  });
});
