import { describe, expect, it } from "vitest";
import { errorKind, pagePath, parseClientEvent } from "./events";

describe("pagePath", () => {
  it("keeps the kind of page, drops which brief", () => {
    expect(pagePath("/b/Xk3aP9qLm2")).toBe("/b/:share");
    expect(pagePath("/tickets/6f1c2a9e-1b2c-4d5e-8f90-123456789abc")).toBe("/tickets/:id");
    expect(pagePath("/tickets?folder=abc")).toBe("/tickets");
    expect(pagePath("/competition")).toBe("/competition");
    expect(pagePath("/")).toBe("/");
  });

  it("is applied to every page.view the browser sends", () => {
    const e = parseClientEvent({ name: "page.view", props: { path: "/b/SECRETSHARE1" } });
    expect(e?.props.path).toBe("/b/:share");
  });
});

describe("errorKind", () => {
  it("keeps the tracker and status, never the message", () => {
    const raw = 'Jira issue create failed: 400 {"errors":{"summary":"Checkout fails for ACME card 4242"}}';
    expect(errorKind(raw)).toBe("Jira 400");
    expect(errorKind("Linear request timed out")).toBe("Linear timeout");
    expect(errorKind("agent did not create an issue")).toBe("agent made no ticket");
    expect(errorKind("something odd about the invoice for Bob")).toBe("other");
  });
});
