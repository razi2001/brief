import { describe, it, expect } from "vitest";
import { summarizeReplay, type Node, type ReplayFile, type RrEvent } from "./replay-steps";

const el = (id: number, tagName: string, attributes: Record<string, string> = {}, childNodes: Node[] = []): Node => ({
  id, type: 2, tagName, attributes, childNodes,
});
const txt = (id: number, textContent: string): Node => ({ id, type: 3, textContent });

const page: Node = {
  id: 1, type: 0, childNodes: [
    el(2, "html", {}, [
      el(3, "body", {}, [
        el(4, "button", {}, [el(5, "span", {}, [txt(6, "Add item")])]),
        el(7, "input", { placeholder: "Card number" }),
        el(8, "input", { type: "checkbox", name: "terms" }),
      ]),
    ]),
  ],
};

describe("summarizeReplay", () => {
  it("turns rrweb events into readable steps, climbing to the real control", () => {
    const events: RrEvent[] = [
      { type: 4, timestamp: 1000, data: { href: "https://app.thunders.ai/checkout" } },
      { type: 2, timestamp: 1000, data: { node: page } },
      { type: 3, timestamp: 2000, data: { source: 2, type: 2, id: 6 } }, // click on the text inside the button
      { type: 3, timestamp: 3000, data: { source: 5, id: 7, text: "****" } },
      { type: 3, timestamp: 3100, data: { source: 5, id: 7, text: "*****" } }, // same field: one step
      { type: 3, timestamp: 4000, data: { source: 5, id: 8, isChecked: true } },
      // a button added later by a mutation is still nameable
      { type: 3, timestamp: 5000, data: { source: 0, adds: [{ parentId: 3, node: el(9, "button", { "aria-label": "Pay now" }) }] } },
      { type: 3, timestamp: 6000, data: { source: 2, type: 2, id: 9 } },
      { type: 4, timestamp: 9000, data: { href: "https://app.thunders.ai/error" } },
    ];
    const chips = [
      { label: "app.thunders.ai", recorded: true, a: 0, b: 5000 },
      { label: "Unwatched tab", recorded: false, a: 7000, b: 8000 },
    ];
    const r = summarizeReplay({ events, chips, durationMs: 8000 });
    expect(r.sites).toEqual(["app.thunders.ai"]);
    expect(r.durationMs).toBe(8000);
    expect(r.steps).toEqual([
      "0:00 Opened https://app.thunders.ai/checkout",
      '0:01 Clicked "Add item"',
      '0:02 Typed into "Card number"',
      '0:03 Checked "terms"',
      '0:05 Clicked "Pay now"',
      "0:07 Switched to a tab that is not recorded",
      "0:08 Opened https://app.thunders.ai/error",
    ]);
  });

  it("never leaks typed values", () => {
    const events: RrEvent[] = [
      { type: 4, timestamp: 0, data: { href: "https://x.test/" } },
      { type: 2, timestamp: 0, data: { node: page } },
      { type: 3, timestamp: 10, data: { source: 5, id: 7, text: "4242424242424242" } },
    ];
    expect(summarizeReplay({ events }).steps.join("\n")).not.toContain("4242");
  });

  it("caps long sessions, keeping the start and the end", () => {
    const events: RrEvent[] = [{ type: 4, timestamp: 0, data: { href: "https://x.test/" } }, { type: 2, timestamp: 0, data: { node: page } }];
    for (let i = 1; i <= 100; i++) events.push({ type: 3, timestamp: i * 1000, data: { source: 2, type: 2, id: 4 } });
    const r = summarizeReplay({ events }, 20);
    expect(r.steps).toHaveLength(20);
    expect(r.steps).toContain("…");
    expect(r.steps[r.steps.length - 1]).toBe('1:40 Clicked "Add item"');
  });

  it("is safe on junk", () => {
    expect(summarizeReplay({ events: [] }).steps).toEqual([]);
    expect(summarizeReplay(null as unknown as ReplayFile).steps).toEqual([]);
  });
});

describe("summarizeReplay - form fields", () => {
  // a checkbox inside its <label>, and a text field named by <label for>
  const form: Node = {
    id: 1, type: 0, childNodes: [
      el(2, "body", {}, [
        el(3, "label", {}, [el(4, "input", { type: "checkbox", id: "done" }), txt(5, " Review release notes")]),
        el(6, "label", { for: "email" }, [txt(7, "Email")]),
        el(8, "input", { id: "email", placeholder: "name@company.com" }),
      ]),
    ],
  };

  it("names a field by its label, and a click that ticks a box is one step", () => {
    const events: RrEvent[] = [
      { type: 4, timestamp: 1000, data: { href: "https://app.test/todo" } },
      { type: 2, timestamp: 1000, data: { node: form } },
      { type: 3, timestamp: 2000, data: { source: 5, id: 8, text: "*****" } },
      { type: 3, timestamp: 3000, data: { source: 2, type: 2, id: 4 } },
      { type: 3, timestamp: 3000, data: { source: 5, id: 4, isChecked: true } },
    ];
    expect(summarizeReplay({ events }).steps).toEqual([
      "0:00 Opened https://app.test/todo",
      '0:01 Typed into "Email"',
      '0:02 Checked "Review release notes"',
    ]);
  });
});
