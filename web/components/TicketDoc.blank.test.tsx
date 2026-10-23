// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import TicketDoc from "./TicketDoc";
import TicketChat from "./TicketChat";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/** A draft started from the Drafts page: no title, no body. */
function mountBlank() {
  return render(
    <>
      <TicketDoc
        briefId="b1"
        shareId="s1"
        isOwner
        isDraft
        filing={false}
        ticketUrl={null}
        provider="linear"
        providerName="Linear"
        initialTitle=""
        initialBody=""
        assets={[]}
        connected={["linear"]}
      />
      <TicketChat briefId="b1" mode="ready" />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a blank draft", () => {
  it("opens empty, with placeholders and the caret in the title", () => {
    const { container } = mountBlank();
    const title = container.querySelector("h1") as HTMLElement;
    const body = container.querySelector(".ticket-prose") as HTMLElement;

    expect(title.textContent).toBe("");
    expect(title.dataset.placeholder).toBe("Untitled");
    expect(body.innerHTML).toBe("");
    expect(body.dataset.placeholder).toBe("Add description…");
    expect(document.activeElement).toBe(title);
  });

  it("asks the assistant to write it, with no suggestions about an empty ticket", async () => {
    const { findByPlaceholderText, queryByText } = mountBlank();

    await findByPlaceholderText("Ask AI to write the ticket…");
    expect(queryByText("Improve layout")).toBeNull();
    expect(queryByText("Fix the writing")).toBeNull();
  });

  it("saves the body without writing the word Untitled into the title", async () => {
    const edits: Array<{ title?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/edit")) edits.push(JSON.parse(String(init?.body ?? "{}")));
        return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      }),
    );
    const { container } = mountBlank();
    const body = container.querySelector(".ticket-prose") as HTMLElement;

    body.innerHTML = "<p>The export button does nothing.</p>";
    fireEvent.input(body);
    fireEvent.blur(body);

    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({ title: "", body: "The export button does nothing." });
  });

  it("clears what an erased field leaves behind, so its placeholder shows again", () => {
    const { container } = mountBlank();
    const title = container.querySelector("h1") as HTMLElement;

    title.innerHTML = "<br>";
    fireEvent.input(title);

    expect(title.innerHTML).toBe("");
  });
});
