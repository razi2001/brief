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
  /** The Context links the page the bug is on, not just where the capture started (null: no page expected). */
  contextPage: boolean | null;
  /** An Also noticed section for the other problem the reporter raised (null: none expected). */
  alsoNoticed: boolean | null;
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

/** The addresses the Context section links to (the whole body's when it has no Context label). */
export function contextLinks(body: string): string[] {
  const at = body.search(/\*\*context\b/i);
  let part = body;
  if (at >= 0) {
    const rest = body.slice(at + 2);
    const next = rest.search(/\n\s*\*\*[^*\n]{2,40}\*\*/);
    part = next >= 0 ? rest.slice(0, next) : rest;
  }
  return [...part.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
};

export function codeChecks(t: Ticket, kind: Kind, expect: { page?: string; also?: string } = {}): Checks {
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
    contextPage: expect.page ? contextLinks(body).some((u) => pathOf(u) === pathOf(`http://x${expect.page}`)) : null,
    alsoNoticed: expect.also ? has("also noticed") : null,
  };
}
