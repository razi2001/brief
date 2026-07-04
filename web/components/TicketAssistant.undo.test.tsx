// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import TicketDoc from "./TicketDoc";
import TicketChat from "./TicketChat";

// TicketDoc → ExportButtons uses the router; stub it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const enc = new TextEncoder();
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

/** Mount the doc + rail together (as the brief page does for a draft owner). */
function mountDraft(initialBody: string) {
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
        initialTitle="Title"
        initialBody={initialBody}
        assets={[]}
        hasLinear
        hasJira={false}
      />
      <TicketChat briefId="b1" mode="ready" />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("assistant undo/redo", () => {
  it("applies a targeted edit, then Undo reverts the doc and persists the original", async () => {
    const editCalls: Array<{ title?: string; body?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/chat")) {
          return {
            ok: true,
            body: streamOf(
              "<note>Renamed it.</note><edit><find>old value</find><replace>new value</replace></edit>",
            ),
          } as unknown as Response;
        }
        if (url.endsWith("/edit")) {
          editCalls.push(JSON.parse(String(init?.body ?? "{}")));
          return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const { container, getByPlaceholderText, findByText } = mountDraft(
      "The old value here.\n\n## Steps\n\n1. one",
    );
    const doc = container.querySelector(".ticket-prose") as HTMLElement;
    expect(doc.textContent).toContain("old value");

    // Fire an instruction.
    const input = getByPlaceholderText("Ask AI to edit the ticket…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "change old to new" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The edit types into the doc.
    await waitFor(() => expect(doc.textContent).toContain("new value"), { timeout: 2000 });
    expect(doc.textContent).not.toContain("old value");

    // The "Undo" affordance appears; click it.
    const undo = await findByText("Undo");
    fireEvent.click(undo);

    // The doc reverts, and the original was persisted via /edit.
    await waitFor(() => expect(doc.textContent).toContain("old value"), { timeout: 2000 });
    expect(doc.textContent).not.toContain("new value");
    await waitFor(() => expect(editCalls.length).toBeGreaterThan(0));
    expect(editCalls[editCalls.length - 1].body).toContain("old value");

    // Redo re-applies.
    const redo = await findByText("Redo");
    fireEvent.click(redo);
    await waitFor(() => expect(doc.textContent).toContain("new value"), { timeout: 2000 });
    expect(editCalls[editCalls.length - 1].body).toContain("new value");
  });

  it("undo also reverts a FULL rewrite (the path a weaker model may take)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/chat")) {
          return {
            ok: true,
            body: streamOf(
              "<note>Restructured it.</note><ticket>\n# Fresh title\n\nA completely fresh body.\n</ticket>",
            ),
          } as unknown as Response;
        }
        return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      }),
    );

    const { container, getByPlaceholderText, findByText } = mountDraft("Original body text.");
    const doc = container.querySelector(".ticket-prose") as HTMLElement;

    const input = getByPlaceholderText("Ask AI to edit the ticket…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "restructure it" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(doc.textContent).toContain("A completely fresh body."), { timeout: 2000 });

    fireEvent.click(await findByText("Undo"));
    await waitFor(() => expect(doc.textContent).toContain("Original body text."), { timeout: 2000 });
    expect(doc.textContent).not.toContain("fresh body");
  });
});
