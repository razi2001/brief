import { describe, it, expect, vi } from "vitest";
import { describeNarration, cleanDescription } from "./describe-narration";

const reply = (content: string) => ({ choices: [{ message: { content } }] });

describe("cleanDescription", () => {
  it("strips wrapping quotes and markdown markers", () => {
    expect(cleanDescription('"**Pay** does nothing on checkout."')).toBe("Pay does nothing on checkout.");
    expect(cleanDescription("- The export button is greyed out.")).toBe("The export button is greyed out.");
    expect(cleanDescription("# Login fails")).toBe("Login fails");
    expect(cleanDescription("“Login fails.”")).toBe("Login fails.");
  });

  it("keeps quotes that belong to the text", () => {
    expect(cleanDescription('The button still says "Pay"')).toBe('The button still says "Pay"');
    expect(cleanDescription('"Pay" does nothing')).toBe('"Pay" does nothing');
  });

  it("turns em and en dashes into commas", () => {
    expect(cleanDescription("Pay spins forever — it never opens the confirmation page.")).toBe(
      "Pay spins forever, it never opens the confirmation page.",
    );
    expect(cleanDescription("Pay spins–forever")).toBe("Pay spins, forever");
  });

  it("collapses whitespace and newlines", () => {
    expect(cleanDescription("  Pay spins.\n\nIt should   finish.  ")).toBe("Pay spins. It should finish.");
  });

  it("caps long answers on a word boundary", () => {
    const out = cleanDescription("word ".repeat(400));
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out.endsWith("word")).toBe(true);
  });

  it("maps NONE and empty answers to an empty string", () => {
    expect(cleanDescription("NONE")).toBe("");
    expect(cleanDescription(" none. ")).toBe("");
    expect(cleanDescription("   ")).toBe("");
  });
});

describe("describeNarration", () => {
  it("returns null without calling the model for an empty transcript", async () => {
    const create = vi.fn();
    expect(await describeNarration("   ", { create })).toBe(null);
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the transcript and returns the cleaned description", async () => {
    const create = vi.fn().mockResolvedValue(reply('"Clicking Pay on checkout spins forever."'));
    const out = await describeNarration("ok so um I click pay and it spins forever", { create, model: "gpt-4o-mini" });
    expect(out).toBe("Clicking Pay on checkout spins forever.");
    const args = create.mock.calls[0][0];
    expect(args.model).toBe("gpt-4o-mini");
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[1].content).toContain("I click pay and it spins forever");
  });

  it("caps a very long transcript before sending it", async () => {
    const create = vi.fn().mockResolvedValue(reply("Something broke."));
    await describeNarration("a".repeat(20000), { create });
    expect(create.mock.calls[0][0].messages[1].content.length).toBeLessThan(8200);
  });

  it("returns null when the model answers NONE", async () => {
    const create = vi.fn().mockResolvedValue(reply("NONE"));
    expect(await describeNarration("testing testing one two", { create })).toBe(null);
  });

  it("returns null (never throws) when the model errors", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await describeNarration("the page is blank", { create })).toBe(null);
  });

  it("sends reasoning_effort none to gpt-5.6 models", async () => {
    const create = vi.fn().mockResolvedValue(reply("Blank page."));
    await describeNarration("the page is blank", { create, model: "gpt-5.6-luna" });
    expect(create.mock.calls[0][0]).toMatchObject({ reasoning_effort: "none" });
  });
});
