// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import EditorSandbox from "./EditorSandbox";
import { DEMO_PARAGRAPHS } from "./sample-ticket";

afterEach(cleanup);

describe("EditorSandbox", () => {
  it("Improve rewrites the selected paragraph, and Undo puts it back", () => {
    const onUsed = vi.fn();
    render(<EditorSandbox onUsed={onUsed} />);
    const editor = screen.getByTestId("editor");
    const p = editor.querySelector('[data-p="0"]')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 8);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(editor);
    fireEvent.click(screen.getByRole("button", { name: /Improve/ }));
    expect(p.textContent).toBe(DEMO_PARAGRAPHS[0].improve);
    expect(onUsed).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor.querySelector('[data-p="0"]')!.textContent).toBe(DEMO_PARAGRAPHS[0].text);
  });
});
