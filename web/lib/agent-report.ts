/**
 * A brief as plain Markdown for a coding agent (/b/<shareId>.md): what the
 * popup's "Fix prompt" points at. The share page is made for people (a
 * skeleton while it's written, evidence as images in a gallery); an agent
 * fetching it gets little from that. This is the same report as text, with
 * every screenshot and recording as a URL it can download.
 */

export type AgentEvidence = {
  kind: "screenshot" | "recording" | "still";
  url: string;
  caption?: string | null;
};

export type AgentReport = {
  title: string;
  /** written: the body is the report. writing: not done yet. failed: never will be. */
  state: "written" | "writing" | "failed";
  body?: string | null;
  /** Filed: where the ticket lives. Null for a draft. */
  filed?: { tracker: string; identifier?: string | null; url?: string | null } | null;
  reported?: string | null;
  page?: { url: string; title?: string | null } | null;
  /** The reporter's own words, the fallback when there is no write-up. */
  description?: string | null;
  evidence: readonly AgentEvidence[];
};

const KIND_LABEL: Record<AgentEvidence["kind"], string> = {
  screenshot: "Screenshot",
  recording: "Screen recording",
  still: "Replay still",
};

/** One line, so a caption can never break the list it sits in. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function statusLine(filed: AgentReport["filed"]): string {
  if (!filed) return "Draft, not filed in a tracker";
  const where = filed.identifier ? `${filed.tracker} as ${filed.identifier}` : filed.tracker;
  return filed.url ? `Filed in ${where} (${filed.url})` : `Filed in ${where}`;
}

export function agentReportMarkdown(r: AgentReport): string {
  const out: string[] = [`# ${oneLine(r.title) || "Bug report"}`, ""];

  const facts = [`- Status: ${statusLine(r.filed)}`];
  if (r.page?.url) facts.push(`- Page: ${r.page.url}${r.page.title ? ` (${oneLine(r.page.title)})` : ""}`);
  if (r.reported) facts.push(`- Reported: ${r.reported}`);
  out.push(...facts, "");

  const body = (r.body ?? "").trim();
  const said = (r.description ?? "").trim();
  if (body) {
    out.push(body, "");
  } else {
    // a ticket filed before write-ups were kept has none, and says nothing here
    if (r.state === "writing") out.push("_This report is still being written. Fetch this URL again in a minute for the full write-up._", "");
    if (r.state === "failed") out.push("_The write-up of this report failed. Below is what the reporter gave._", "");
    if (said) out.push("## What the reporter said", "", said, "");
  }

  if (r.evidence.length) {
    out.push("## Evidence", "");
    const seen: Record<string, number> = {};
    for (const e of r.evidence) {
      const n = (seen[e.kind] = (seen[e.kind] ?? 0) + 1);
      const total = r.evidence.filter((x) => x.kind === e.kind).length;
      const label = total > 1 ? `${KIND_LABEL[e.kind]} ${n}` : KIND_LABEL[e.kind];
      const caption = e.caption ? oneLine(e.caption) : "";
      out.push(`- ${label}: ${e.url}${caption ? ` (${caption})` : ""}`);
    }
    out.push("");
  }

  out.push("---", "", "Captured with Brief: https://get-brief.app");
  return out.join("\n") + "\n";
}
