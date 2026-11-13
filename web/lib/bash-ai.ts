import OpenAI from "openai";
import { agentModel } from "@/lib/agent/model";
import { respondJson, text } from "@/lib/agent/responses";
import {
  GROUPING_INSTRUCTIONS,
  GROUPING_SCHEMA,
  groupingInput,
  normalizeGroups,
  singles,
  type Group,
  type RawGroups,
  type ReviewReport,
} from "@/lib/bash-review";
import {
  SUGGEST_INSTRUCTIONS,
  SUGGEST_SCHEMA,
  normalizeSuggestions,
  suggestInput,
  type PastTicket,
  type RawAreas,
  type Suggestion,
} from "@/lib/bash-suggest";

/**
 * The two questions a bug bash asks the model: which reports are the same bug,
 * and which parts of the product keep breaking. Both answers go through a
 * normalizer that never trusts them (lib/bash-review.ts, lib/bash-suggest.ts),
 * and both fall back to "no opinion" when the model can't be asked: every
 * report alone, or no suggestion.
 */

const client = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** The reports of a session, in groups of the same bug. Never throws. */
export async function groupReports(reports: ReviewReport[]): Promise<Group[]> {
  // One report has nothing to be a duplicate of.
  if (reports.length < 2) return singles(reports);
  try {
    const { value } = await respondJson<RawGroups>({
      client: client(),
      model: agentModel(),
      instructions: GROUPING_INSTRUCTIONS,
      content: [text(groupingInput(reports))],
      name: "report_groups",
      schema: GROUPING_SCHEMA,
    });
    return normalizeGroups(reports, value);
  } catch (e) {
    console.error("[bash] grouping failed, every report stands alone:", e instanceof Error ? e.message : e);
    return singles(reports);
  }
}

/** The areas that keep producing bugs, from recent ticket titles. Never throws. */
export async function suggestAreas(tickets: PastTicket[]): Promise<Suggestion[]> {
  try {
    const { value } = await respondJson<RawAreas>({
      client: client(),
      model: agentModel(),
      instructions: SUGGEST_INSTRUCTIONS,
      content: [text(suggestInput(tickets))],
      name: "bash_areas",
      schema: SUGGEST_SCHEMA,
    });
    return normalizeSuggestions(tickets, value);
  } catch (e) {
    console.error("[bash] suggestions failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
