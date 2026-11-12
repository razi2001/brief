import { describe, it, expect } from "vitest";
import { coerceJiraFields, fillRequired, missingFieldsMessage, rejectionMessage, toFieldMeta, type JiraFieldMeta } from "./jira-fields";

// The PNAS project's create screen (2026-11-12): Story Points and Components
// are required, and Jira refused every value Brief sent as plain text.
const META: JiraFieldMeta[] = toFieldMeta({
  summary: { name: "Summary", required: true, schema: { type: "string" } },
  description: { name: "Description", required: false, schema: { type: "doc" } },
  reporter: { name: "Reporter", required: true, schema: { type: "user" } },
  customfield_10028: { name: "Story Points", required: true, schema: { type: "number" } },
  components: {
    name: "Components",
    required: true,
    schema: { type: "array", items: "component", system: "components" },
    allowedValues: [
      { id: "10100", name: "Web" },
      { id: "10101", name: "Mobile" },
    ],
  },
  customfield_10050: {
    name: "Environment",
    required: false,
    schema: { type: "option" },
    allowedValues: [
      { id: "1", value: "Production" },
      { id: "2", value: "Staging" },
    ],
  },
  customfield_10060: {
    name: "Team",
    required: true,
    schema: { type: "option" },
    allowedValues: [{ id: "7", value: "Digital" }],
  },
});

describe("toFieldMeta", () => {
  it("reads the object form keyed by field id", () => {
    expect(META.find((m) => m.fieldId === "customfield_10028")).toMatchObject({ name: "Story Points", required: true });
  });
  it("reads the array form of the per-issue-type endpoint", () => {
    const m = toFieldMeta([{ fieldId: "components", name: "Components", required: true, schema: { type: "array" } }]);
    expect(m).toEqual([expect.objectContaining({ fieldId: "components", required: true })]);
  });
});

describe("coerceJiraFields", () => {
  it("turns a story-point string into a number", () => {
    expect(coerceJiraFields({ customfield_10028: "3" }, META).fields).toEqual({ customfield_10028: 3 });
    expect(coerceJiraFields({ customfield_10028: { value: "2" } }, META).fields).toEqual({ customfield_10028: 2 });
  });

  it("reports a value that isn't a number and drops it", () => {
    const r = coerceJiraFields({ customfield_10028: "small" }, META);
    expect(r.fields).toEqual({});
    expect(r.problems[0]).toMatch(/Story Points must be a number/);
  });

  it("maps component names to the [{id}] Jira takes, whatever shape they arrive in", () => {
    for (const v of ["web", ["Web"], [{ name: "Web" }], { name: "web" }]) {
      expect(coerceJiraFields({ components: v }, META).fields).toEqual({ components: [{ id: "10100" }] });
    }
  });

  it("reports a component the project doesn't have, with the allowed ones", () => {
    const r = coerceJiraFields({ components: ["Backend", "Mobile"] }, META);
    expect(r.fields).toEqual({ components: [{ id: "10101" }] });
    expect(r.problems[0]).toBe('Components: "Backend" isn\'t one of Web, Mobile');
  });

  it("matches a field by its name too, and options by value", () => {
    expect(coerceJiraFields({ "story points": 5, Environment: "staging" }, META).fields).toEqual({
      customfield_10028: 5,
      customfield_10050: { id: "2" },
    });
  });

  it("passes a field the project doesn't list through untouched", () => {
    expect(coerceJiraFields({ customfield_99999: { x: 1 } }, META).fields).toEqual({ customfield_99999: { x: 1 } });
  });
});

describe("fillRequired", () => {
  const base = { summary: "t", description: {}, project: {}, issuetype: {} };

  it("names every required field left empty, and fills a single-choice one", () => {
    const r = fillRequired(base, META);
    expect(r.missing.map((m) => m.name)).toEqual(["Story Points", "Components"]);
    expect(r.fields.customfield_10060).toEqual({ id: "7" });
  });

  it("is satisfied once the fields are set (reporter is Jira's to fill)", () => {
    const r = fillRequired({ ...base, customfield_10028: 1, components: [{ id: "10100" }] }, META);
    expect(r.missing).toEqual([]);
  });

  it("treats an empty list as missing", () => {
    expect(fillRequired({ ...base, customfield_10028: 1, components: [] }, META).missing.map((m) => m.name)).toEqual(["Components"]);
  });
});

describe("messages", () => {
  it("says which fields are required, what they take, and how to set them", () => {
    const missing = META.filter((m) => ["customfield_10028", "components"].includes(m.fieldId));
    expect(missingFieldsMessage("EWO", missing)).toBe(
      'Jira project EWO requires Story Points (a number); Components (one of: Web, Mobile). ' +
        'Set them with create_issue\'s custom_fields, or add them to your ticket guidance ' +
        '(for example "Story Points: 1, Components: Web") and retry.',
    );
  });

  it("turns Jira's 400 into one sentence with field names", () => {
    const body = JSON.stringify({
      errorMessages: [],
      errors: { customfield_10028: "Operation value must be a number", components: "Components is required." },
    });
    expect(rejectionMessage("EWO", body, META)).toBe(
      "Jira rejected the ticket in project EWO: Story Points: Operation value must be a number; Components is required. (allowed: Web, Mobile)",
    );
  });
});
