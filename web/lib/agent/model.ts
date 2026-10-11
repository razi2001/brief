/**
 * Which OpenAI model each path uses, and the request params it needs, in one
 * place. Transcription is separate (a speech model; see transcribe.ts).
 */

/** Writing and filing tickets: the filing agent, the draft composer, the live draft stream. */
export function agentModel(): string {
  return process.env.AGENT_MODEL || "gpt-5.6-luna";
}

/** The in-page ticket assistant, where every turn should feel instant. */
export function fastModel(): string {
  return process.env.AGENT_FAST_MODEL || "gpt-5.6-luna";
}

/**
 * Extra params for /v1/chat/completions (the in-page assistant). gpt-5.6 and
 * gpt-6 refuse function tools there at any reasoning effort but 'none', and
 * 'none' is also the fast path for everything from gpt-5.1 on. Older models get
 * nothing: gpt-4o rejects the param outright, and gpt-5.0 rejects 'none'.
 */
export function chatParams(model: string): { reasoning_effort?: "none" } {
  return /^gpt-(?:5\.[1-9]\d*|[6-9])(?:[.-]|$)/.test(model) ? { reasoning_effort: "none" } : {};
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** How hard the ticket writers think: AGENT_REASONING, low unless set. */
export function reasoningEffort(): ReasoningEffort {
  const v = (process.env.AGENT_REASONING || "").trim().toLowerCase();
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : "low";
}

/**
 * Extra params for /v1/responses, where gpt-5.6 takes function tools AND
 * reasoning. A model that reasons gets the effort, and its reasoning back
 * encrypted so a tool loop with store:false keeps its thinking turn to turn.
 * gpt-4o has no reasoning and gets nothing; gpt-5.0's lowest is 'minimal'.
 */
export function responsesParams(
  model: string,
  effort: ReasoningEffort = reasoningEffort(),
): { reasoning?: { effort: ReasoningEffort | "minimal" }; include?: Array<"reasoning.encrypted_content"> } {
  if (!/^(?:gpt-(?:5|[6-9])|o\d)/.test(model)) return {};
  const e = effort === "none" && /^gpt-5(?:-|$)/.test(model) ? "minimal" : effort;
  return { reasoning: { effort: e }, include: ["reasoning.encrypted_content"] };
}
