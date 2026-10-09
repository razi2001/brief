/**
 * Which OpenAI chat model each path uses, and the request params it needs, in
 * one place. Transcription is separate (a speech model; see transcribe.ts).
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
 * Extra params for /v1/chat/completions. gpt-5.6 and gpt-6 refuse function
 * tools there at any reasoning effort but 'none', and 'none' is also the fast
 * path for everything from gpt-5.1 on. Older models get nothing: gpt-4o rejects
 * the param outright, and gpt-5.0 rejects 'none'.
 */
export function chatParams(model: string): { reasoning_effort?: "none" } {
  return /^gpt-(?:5\.[1-9]\d*|[6-9])(?:[.-]|$)/.test(model) ? { reasoning_effort: "none" } : {};
}
