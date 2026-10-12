// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { GuideFactsProvider, useGuideFacts } from "./GuideFacts";
import type { AutoFacts } from "@/lib/guide/progress";

afterEach(cleanup);

function Show() {
  const f = useGuideFacts();
  return <span data-testid="f">{JSON.stringify(f)}</span>;
}

describe("GuideFactsProvider", () => {
  it("takes the server's streamed thenable, whose then() returns nothing", async () => {
    // what React hands a client component for a promise prop from the server
    const thenable = { then: (ok: (f: AutoFacts) => void) => void ok({ tracker: true }) } as unknown as Promise<AutoFacts>;
    render(
      <GuideFactsProvider facts={thenable}>
        <Show />
      </GuideFactsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("f").textContent).toBe('{"tracker":true}'));
  });

  it("stays empty when the facts never come", async () => {
    render(
      <GuideFactsProvider facts={Promise.reject(new Error("down"))}>
        <Show />
      </GuideFactsProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("f").textContent).toBe("{}");
  });
});
