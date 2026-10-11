import { afterEach, describe, expect, test } from "vitest";
import { agentModel, chatParams, fastModel, reasoningEffort, responsesParams } from "./model";

afterEach(() => {
  delete process.env.AGENT_MODEL;
  delete process.env.AGENT_FAST_MODEL;
  delete process.env.AGENT_REASONING;
});

describe("agentModel / fastModel", () => {
  test("default to gpt-5.6-luna", () => {
    expect(agentModel()).toBe("gpt-5.6-luna");
    expect(fastModel()).toBe("gpt-5.6-luna");
  });

  test("AGENT_MODEL and AGENT_FAST_MODEL still override", () => {
    process.env.AGENT_MODEL = "gpt-5.4";
    process.env.AGENT_FAST_MODEL = "gpt-4o-mini";
    expect(agentModel()).toBe("gpt-5.4");
    expect(fastModel()).toBe("gpt-4o-mini");
  });
});

describe("chatParams", () => {
  // Mirrors what /v1/chat/completions answered on 2026-09-29.
  test("gpt-5.1 and later get reasoning_effort 'none'", () => {
    // gpt-5.6 and gpt-6 refuse function tools on chat completions at any other
    // effort; 5.1 to 5.5 accept 'none', and it is their fast path.
    for (const m of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-luna", "gpt-5.5", "gpt-5.4-mini", "gpt-5.1", "gpt-5.1-2025-11-13"]) {
      expect(chatParams(m), m).toEqual({ reasoning_effort: "none" });
    }
  });

  test("older models get nothing: gpt-4o rejects the param, gpt-5.0 rejects 'none'", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-2025-08-07"]) {
      expect(chatParams(m), m).toEqual({});
    }
  });
});

describe("responsesParams", () => {
  test("gpt-5.6 reasons at low by default, its reasoning carried back encrypted", () => {
    expect(responsesParams("gpt-5.6-luna")).toEqual({ reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"] });
  });

  test("AGENT_REASONING sets the effort; anything else falls back to low", () => {
    process.env.AGENT_REASONING = "medium";
    expect(reasoningEffort()).toBe("medium");
    expect(responsesParams("gpt-5.6-luna").reasoning).toEqual({ effort: "medium" });
    process.env.AGENT_REASONING = "turbo";
    expect(reasoningEffort()).toBe("low");
  });

  test("gpt-4o has no reasoning: it gets nothing", () => {
    expect(responsesParams("gpt-4o")).toEqual({});
    expect(responsesParams("gpt-4o-mini")).toEqual({});
  });

  test("gpt-5.0 has no 'none': it gets 'minimal'", () => {
    expect(responsesParams("gpt-5", "none").reasoning).toEqual({ effort: "minimal" });
    expect(responsesParams("gpt-5.4", "none").reasoning).toEqual({ effort: "none" });
  });
});
