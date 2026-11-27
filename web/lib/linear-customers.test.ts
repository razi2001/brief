import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCustomers, makeLinearTracker, resolveCustomer, type LinearCustomer } from "./linear";

const CUSTOMERS: LinearCustomer[] = [
  { id: "c-acme", name: "Acme Corp", domains: ["acme.com"] },
  { id: "c-globex", name: "Globex", domains: ["globex.io", "www.globex.com"] },
];

describe("detectCustomers", () => {
  it("finds names as whole words and domains with subdomains", () => {
    expect(detectCustomers("Reported by ACME CORP support", CUSTOMERS).map((c) => c.id)).toEqual(["c-acme"]);
    expect(detectCustomers("on https://eu.acme.com/x", CUSTOMERS).map((c) => c.id)).toEqual(["c-acme"]);
    expect(detectCustomers("www.globex.com and acme.com", CUSTOMERS).map((c) => c.id)).toEqual(["c-acme", "c-globex"]);
  });
  it("ignores partial words, look-alike domains and short names", () => {
    expect(detectCustomers("acmecorp, notacme.com, acme.com.evil.net", CUSTOMERS)).toEqual([]);
    expect(detectCustomers("io is fine", [{ id: "x", name: "io", domains: [] }])).toEqual([]);
  });
});

describe("resolveCustomer", () => {
  it("matches a name, a domain, an email or a URL", () => {
    expect(resolveCustomer("Globex", CUSTOMERS)?.id).toBe("c-globex");
    expect(resolveCustomer("acme.com", CUSTOMERS)?.id).toBe("c-acme");
    expect(resolveCustomer("jane@acme.com", CUSTOMERS)?.id).toBe("c-acme");
    expect(resolveCustomer("https://www.globex.com/billing?x=1", CUSTOMERS)?.id).toBe("c-globex");
    expect(resolveCustomer("acme", CUSTOMERS)?.id).toBe("c-acme");
  });
  it("finds nothing for an unknown customer", () => {
    expect(resolveCustomer("Initech", CUSTOMERS)).toBeUndefined();
    expect(resolveCustomer("  ", CUSTOMERS)).toBeUndefined();
  });
});

/** A fake Linear GraphQL endpoint that records every operation it receives. */
function fakeLinear(opts: { customers: LinearCustomer[] | "disabled" }) {
  const ops: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    ops.push({ query, variables });
    const json = (data: unknown, errors?: unknown) => new Response(JSON.stringify({ data, errors }), { status: 200 });
    if (query.includes("query Customers")) {
      if (opts.customers === "disabled") return json(null, [{ message: "Customer requests are not enabled" }]);
      return json({ customers: { nodes: opts.customers } });
    }
    if (query.includes("TeamsWithMeta")) {
      return json({ teams: { nodes: [{ id: "t1", name: "Eng", key: "ENG", description: null, states: { nodes: [] }, labels: { nodes: [] }, projects: { nodes: [] } }] }, issueLabels: { nodes: [] } });
    }
    if (query.includes("IssueCreate")) {
      return json({ issueCreate: { success: true, issue: { id: "i1", identifier: "ENG-1", url: "https://linear.app/x/ENG-1", title: "t" } } });
    }
    if (query.includes("NeedCreate")) return json({ customerNeedCreate: { success: true } });
    if (query.includes("IssueRef")) return json({ issue: { id: "i1", team: { id: "t1" } } });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return ops;
}

afterEach(() => vi.unstubAllGlobals());

const base = { targetId: "t1", title: "Checkout 500", descriptionMarkdown: "body", evidence: [] };

describe("Linear customer requests", () => {
  it("links the filed issue to the named customer", async () => {
    const ops = fakeLinear({ customers: CUSTOMERS });
    const tracker = makeLinearTracker({ token: "tok" });
    await tracker.fileIssue({ ...base, customer: "acme.com" });
    const need = ops.find((o) => o.query.includes("NeedCreate"));
    expect(need?.variables.input).toEqual({ issueId: "i1", customerId: "c-acme", body: "Checkout 500" });
  });

  it("links a customer the ticket mentions, by default, when the agent set none", async () => {
    const ops = fakeLinear({ customers: CUSTOMERS });
    await makeLinearTracker({ token: "tok" }).fileIssue({
      ...base,
      descriptionMarkdown: "Page: https://app.globex.io/billing\n\nThe invoice total is wrong.",
    });
    const needs = ops.filter((o) => o.query.includes("NeedCreate"));
    expect(needs.map((o) => (o.variables.input as { customerId: string }).customerId)).toEqual(["c-globex"]);
  });

  it("links nothing when no customer is mentioned", async () => {
    const ops = fakeLinear({ customers: CUSTOMERS });
    await makeLinearTracker({ token: "tok" }).fileIssue({ ...base, descriptionMarkdown: "acmecorp-style typo and globexx.io" });
    expect(ops.some((o) => o.query.includes("NeedCreate"))).toBe(false);
  });

  it("files the issue without a link when the customer is unknown", async () => {
    const ops = fakeLinear({ customers: CUSTOMERS });
    const created = await makeLinearTracker({ token: "tok" }).fileIssue({ ...base, customer: "Initech" });
    expect(created.identifier).toBe("ENG-1");
    expect(ops.some((o) => o.query.includes("NeedCreate"))).toBe(false);
  });

  it("files normally when the workspace has customer requests turned off", async () => {
    fakeLinear({ customers: "disabled" });
    const tracker = makeLinearTracker({ token: "tok" });
    const created = await tracker.fileIssue({ ...base, customer: "Acme" });
    expect(created.identifier).toBe("ENG-1");
    const details = await tracker.getTargetDetails!("t1");
    expect(details.customers).toBeUndefined();
  });

  it("offers the customers in the team details, and update_issue can link one", async () => {
    const ops = fakeLinear({ customers: CUSTOMERS });
    const tracker = makeLinearTracker({ token: "tok" });
    const details = await tracker.getTargetDetails!("t1");
    expect(details.customers?.map((c) => c.name)).toEqual(["Acme Corp", "Globex"]);
    expect(await tracker.updateIssue!("ENG-1", { customer: "Globex" })).toEqual({ ok: true });
    expect(ops.find((o) => o.query.includes("NeedCreate"))?.variables.input).toMatchObject({ customerId: "c-globex" });
    const miss = await tracker.updateIssue!("ENG-1", { customer: "Initech" });
    expect(miss).toMatchObject({ ok: false });
    expect(!miss.ok && miss.error).toContain("Acme Corp, Globex");
  });
});
