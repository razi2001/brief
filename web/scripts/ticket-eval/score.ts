// The ticket eval's code checks: rules a written ticket must follow, checked
// without a model. Pure; unit-tested in score.test.ts.

export type Kind = "failure" | "ui" | "none";
export interface Ticket { title: string; body: string }
export interface Checks {
  /** Steps, Expected and Actual are all there (null: not required when nothing is wrong). */
  sections: boolean | null;
  /** The page is a Markdown link. */
  contextLink: boolean;
  noBannedWords: boolean;
  noDashes: boolean;
  /** The title and summary carry no HTTP method, API path, status code or exception name. */
  plainSummary: boolean;
  /** Technical notes when something failed, none when nothing is wrong (null: either is fine). */
  techNotes: boolean | null;
}

const LABEL_LINE = /^\s*\*\*[^*\n]{2,40}\*\*/;
const BANNED = /\b(?:briefs?|recording|recorded|captured?|transcript|narrated|keyframes?)\b|the (?:user|reporter) said/i;
const TECHNICAL = /\b(?:GET|POST|PUT|PATCH|DELETE)\b|\/api\/|\b[45]\d\d\b|\b\w*(?:Error|Exception)\b|status code|stack trace/;

/** The opening paragraph(s): everything before the first section label, minus a leading Summary label. */
export function summaryOf(body: string): string {
  const lines = (body ?? "").replace(/\r\n/g, "\n").trim().split("\n");
  const out: string[] = [];
  const lead = /^\s*\*\*summary:?\*\*:?\s*/i;
  for (const [i, line] of lines.entries()) {
    if (i === 0 && lead.test(line)) {
      out.push(line.replace(lead, ""));
      continue;
    }
    if (LABEL_LINE.test(line) || /^#{1,6}\s/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function codeChecks(t: Ticket, kind: Kind): Checks {
  const body = t.body ?? "";
  // the words the reader reads: link targets and bare URLs (a host can be anything) left out
  const prose = `${t.title ?? ""}\n${body}`.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, "");
  const has = (label: string) => new RegExp(`\\*\\*${label}[^*]*\\*\\*`, "i").test(body);
  return {
    sections: kind === "none" ? null : has("steps") && has("expected") && has("actual"),
    contextLink: /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(body),
    noBannedWords: !BANNED.test(prose),
    noDashes: !/[–—]/.test(prose),
    plainSummary: !TECHNICAL.test(`${t.title ?? ""}\n${summaryOf(body)}`),
    techNotes: kind === "failure" ? has("technical notes") : kind === "none" ? !has("technical notes") : null,
  };
}
