// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import BriefListRow from "./BriefListRow";
import TicketList from "./TicketList";
import type { DashboardBrief, TicketInfo } from "@/lib/brief-types";

// BriefListRow → RetryButton uses the router; stub it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const TRACKER = "https://linear.app/acme/issue/APP-4690/gone-ticket";

const deletedTicket: TicketInfo = {
  title: "Old title",
  url: TRACKER,
  stateName: "Deleted",
  stateColor: "#c9c3b5",
  createdAt: "2026-07-12T16:47:58.000Z",
  deleted: true,
};
const liveTicket: TicketInfo = {
  title: "Live title",
  url: TRACKER,
  stateName: "Todo",
  stateColor: "#3e955f",
  createdAt: "2026-07-12T16:47:58.000Z",
};

function brief(ticket: TicketInfo): DashboardBrief {
  return {
    id: "b1",
    status: "filed",
    title: "Brief name",
    source_kind: "recording",
    created_at: "2026-07-12T16:47:58.000Z",
    updated_at: null,
    ticket_url: TRACKER,
    ticket_identifier: "APP-4690",
    ticket_title: "Old title",
    share_id: "s1",
    error: null,
    seq: 3,
    provider: "linear",
    ticket,
  };
}

const hrefsIn = (root: HTMLElement) =>
  [...root.querySelectorAll("a")].map((a) => a.getAttribute("href"));

afterEach(cleanup);

describe("BriefListRow for a ticket the tracker no longer has", () => {
  it("opens the Brief page from the row and the id chip, never the tracker", () => {
    const { container } = render(
      <ul>
        <BriefListRow brief={brief(deletedTicket)} />
      </ul>,
    );

    const hrefs = hrefsIn(container);
    expect(hrefs).not.toContain(TRACKER);
    expect(hrefs).toContain("/tickets/s1");
    for (const a of container.querySelectorAll('a[href="/tickets/s1"]')) {
      expect(a.getAttribute("target")).toBeNull();
    }
    // The identity and the state still read at a glance.
    expect(container.textContent).toContain("APP-4690");
    expect(container.textContent).toContain("Deleted");
    expect(container.querySelector('[title="Deleted in Linear"]')).not.toBeNull();
  });

  it("a live ticket: the row opens it in the app, its id opens the tracker", () => {
    const { container } = render(
      <ul>
        <BriefListRow brief={brief(liveTicket)} />
      </ul>,
    );

    expect(hrefsIn(container)).toContain(TRACKER);
    expect(hrefsIn(container)).toContain("/tickets/s1");
    // no separate Brief-page logo on a ticket any more
    expect(container.querySelector('[aria-label="Open the Brief page"]')).toBeNull();
    expect(container.textContent).toContain("Todo");
  });
});

describe("TicketList for a ticket the tracker no longer has", () => {
  it("opens the Brief page in the same tab", () => {
    const { container } = render(<TicketList briefs={[brief(deletedTicket)]} />);

    const link = container.querySelector("li a");
    expect(link?.getAttribute("href")).toBe("/b/s1");
    expect(link?.getAttribute("target")).toBeNull();
    expect(container.textContent).toContain("Deleted");
  });

  it("still opens the tracker in a new tab for a live ticket", () => {
    const { container } = render(<TicketList briefs={[brief(liveTicket)]} />);

    const link = container.querySelector("li a");
    expect(link?.getAttribute("href")).toBe(TRACKER);
    expect(link?.getAttribute("target")).toBe("_blank");
  });
});

describe("BriefListRow opens every ticket in its own tracker", () => {
  it("a GitHub issue's id opens GitHub, named as GitHub", () => {
    const GH = "https://github.com/acme/web/issues/12";
    const { container } = render(
      <ul>
        <BriefListRow
          brief={{ ...brief({ ...liveTicket, url: GH }), ticket_url: GH, ticket_identifier: "acme/web#12", provider: "github" }}
        />
      </ul>,
    );
    const link = container.querySelector('a[aria-label="Open in GitHub"]');
    expect(link?.getAttribute("href")).toBe(GH);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(container.textContent).toContain("web#12");
    // the row itself still opens the ticket inside the app
    expect(hrefsIn(container)).toContain("/tickets/s1");
  });
});
