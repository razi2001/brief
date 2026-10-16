// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TicketMeta } from "./BriefPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(cleanup);

describe("TicketMeta", () => {
  it("names the tracker where a Notion page's id would go, in plain muted text", () => {
    const { container } = render(
      <TicketMeta stateName="In progress" stateColor="#dd6936" identifier={null} trackerName="Notion" reported="Oct 15, 2026" />,
    );
    const name = screen.getByText("Notion");
    expect(name.className).toBe("text-muted");
    expect(container.textContent).toBe("In progressNotionOct 15, 2026");
  });

  it("shows the id itself when the ticket has one", () => {
    const { container } = render(
      <TicketMeta stateName="Todo" stateColor="#8a8378" identifier="ENG-42" trackerName="Linear" reported="Oct 15, 2026" />,
    );
    expect(screen.getByText("ENG-42").className).toContain("font-mono");
    expect(container.textContent).not.toContain("Linear");
  });

  it("leaves the slot out entirely when there is neither", () => {
    const { container } = render(<TicketMeta stateName="Draft" stateColor="#8a8378" reported="Oct 15, 2026" />);
    expect(container.textContent).toBe("DraftOct 15, 2026");
  });
});
