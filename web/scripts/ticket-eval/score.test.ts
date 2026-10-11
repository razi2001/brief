import { expect, test } from "vitest";
import { codeChecks, summaryOf } from "./score";

const good = {
  title: "Saving a test case does nothing",
  body: [
    "Clicking Save on a test case leaves the form as it was and the case is not saved, so the edit is lost.",
    "",
    "**Steps to reproduce**",
    "1. Open a test case",
    "2. Click Save",
    "",
    "**Expected**",
    "The case is saved.",
    "",
    "**Actual**",
    "Nothing happens.",
    "",
    "**Technical notes**",
    "- The save call (PUT /api/cases/42) returns 500.",
    "",
    "**Context:** [Edit test case - Acme QA](https://app.x/cases/42)",
  ].join("\n"),
};

test("a ticket that follows every rule passes every check (the Technical notes may be technical)", () => {
  expect(codeChecks(good, "failure")).toEqual({
    sections: true, contextLink: true, noBannedWords: true, noDashes: true, plainSummary: true, techNotes: true,
  });
});

test("a summary or title that opens on a log line is not plain", () => {
  expect(codeChecks({ ...good, body: "GET /api/test-cases took 7.9 s, so the list is slow.\n\n" + good.body }, "failure").plainSummary).toBe(false);
  expect(codeChecks({ ...good, title: "Save returns 500" }, "failure").plainSummary).toBe(false);
  expect(codeChecks({ ...good, title: "TypeError on save" }, "failure").plainSummary).toBe(false);
});

test("a Summary label is read as the summary, inline or on its own line", () => {
  expect(summaryOf("**Summary**\nThe list never loads.\n\n**Steps to reproduce**\n1. x")).toBe("The list never loads.");
  expect(summaryOf("**Summary:** The list never loads.\n\n**Expected**\nIt loads.")).toBe("The list never loads.");
});

test("nothing wrong: no sections required, and Technical notes are a fail", () => {
  const clean = { title: "Adding a to-do works", body: "Adding an item works; no error showed up.\n\n**Context:** [Todos](https://app.x/todos)" };
  expect(codeChecks(clean, "none")).toMatchObject({ sections: null, techNotes: true });
  expect(codeChecks({ ...clean, body: clean.body + "\n\n**Technical notes**\n- none" }, "none").techNotes).toBe(false);
});

test("a UI-only bug doesn't grade the Technical notes", () => {
  expect(codeChecks(good, "ui").techNotes).toBeNull();
});

test("missing sections, a bare URL, banned words and dashes are caught", () => {
  const bad = { title: "Save fails — see recording", body: "It breaks.\n\nhttps://app.x/cases/42" };
  expect(codeChecks(bad, "failure")).toMatchObject({ sections: false, contextLink: false, noBannedWords: false, noDashes: false, techNotes: false });
});

test("a page address is not prose: a host named brief.localhost is no banned word", () => {
  const t = { ...good, body: good.body.replace("https://app.x/cases/42", "http://cases.brief.localhost:3997/save-500") };
  expect(codeChecks(t, "failure").noBannedWords).toBe(true);
});
