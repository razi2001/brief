/**
 * Why a ticket didn't file, in words the person who filed can act on.
 * Pure, unit-tested in filing-errors.test.ts.
 *
 * Errors reach people raw ("Jira issue create failed: 401 {...}",
 * "agent did not create an issue"). This turns each kind into a sentence
 * that says what happened and what to do next. A message that is already a
 * plain sentence (Brief's own explicit ones) passes through unchanged.
 */

const TRACKERS = ["Azure DevOps", "Jira", "Linear", "GitHub", "GitLab", "ClickUp", "Notion", "Trello", "Asana", "Monday"];

/** The tracker a raw error names first, if any. */
function trackerIn(raw: string): string | undefined {
  return TRACKERS.find((t) => raw.toLowerCase().includes(t.toLowerCase()));
}

/** The HTTP status a raw tracker error carries ("... failed: 401 ..."). */
function statusIn(raw: string): number | undefined {
  const m = /\bfailed:?\s+(\d{3})\b/i.exec(raw) ?? /\b(?:status|HTTP)\s*(\d{3})\b/i.exec(raw);
  return m ? Number(m[1]) : undefined;
}

/** The readable part of a JSON error body inside a raw message. */
function reasonIn(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start < 0) return undefined;
  try {
    const j = JSON.parse(raw.slice(start)) as Record<string, unknown>;
    const pieces: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === "string" && v.trim()) pieces.push(v.trim());
      else if (Array.isArray(v)) v.forEach(add);
      else if (v && typeof v === "object") Object.entries(v as Record<string, unknown>).forEach(([k, x]) => (typeof x === "string" ? pieces.push(`${k}: ${x}`) : add(x)));
    };
    add(j.errorMessages);
    add(j.errors);
    add(j.message);
    add(j.error_description);
    if (!pieces.length) add(j.error);
    return pieces.length ? pieces.join("; ").slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

/** True when the text looks like a machine error rather than a sentence for people. */
function looksTechnical(raw: string): boolean {
  return (
    /[{}[\]]/.test(raw) ||
    /\b(failed|error|exception|undefined|null|ECONN|ETIMEDOUT|ENOTFOUND|fetch)\b/i.test(raw) ||
    /\b[45]\d\d\b/.test(raw) ||
    /^[a-z_]+$/i.test(raw.trim())
  );
}

export function explainFilingError(
  raw: string | null | undefined,
  trackerName?: string,
  opts: { stage?: "file" | "draft" } = {},
): string {
  const text = (raw ?? "").trim();
  const name = trackerName || trackerIn(text) || "your tracker";
  if (opts.stage === "draft") {
    if (/\b(openai|responses api|insufficient_quota|model_not_found|context_length|429|5\d\d|timed? ?out|fetch failed|ECONNRESET)\b/i.test(text)) {
      return `Brief's AI service didn't answer while writing the draft. Press Retry in a minute; your evidence is saved.`;
    }
    if (!text || looksTechnical(text)) {
      return `Brief couldn't write the draft${text ? ` (${text.slice(0, 160)})` : ""}. Press Retry; your evidence is saved.`;
    }
    return text;
  }
  if (!text) return `The ticket didn't file. Press Retry; if it fails again, open the draft and file it yourself.`;

  // Brief's own explicit messages: already say what to do.
  if (/^The ticket wasn't created\b/.test(text) || /^Jira project \S+ requires\b/.test(text) || /^Jira rejected the ticket\b/.test(text)) {
    return text;
  }

  if (/agent did not create an issue/i.test(text)) {
    return `The ticket wasn't created: Brief's AI stopped before filing it in ${name}. Press Retry, or open the draft and file it yourself.`;
  }

  if (/\b(fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|timed? ?out|aborted)\b/i.test(text)) {
    return `Brief couldn't reach ${name} (no answer). Press Retry in a minute.`;
  }

  // The AI service (not the tracker) refused: quota, overload.
  if (/\b(openai|responses api|insufficient_quota|model_not_found|context_length)\b/i.test(text)) {
    return `Brief's AI service didn't answer. Press Retry in a minute; your evidence is saved.`;
  }

  const status = statusIn(text);
  const reason = reasonIn(text);
  switch (status) {
    case 401:
      return `Your ${name} connection expired. Reconnect ${name} in Connections, then press Retry.`;
    case 403:
      return `Your ${name} account isn't allowed to create tickets there${reason ? ` (${reason})` : ""}. Ask an admin for access, or choose another place in your ticket guidance.`;
    case 404:
      return `${name} couldn't find where to file the ticket: it may have been deleted, or you lost access. Choose another place in your ticket guidance, then press Retry.`;
    case 429:
      return `${name} is limiting requests right now. Wait a minute, then press Retry.`;
    case 400:
    case 409:
    case 422:
      return `${name} refused the ticket${reason ? `: ${reason}` : ""}. Fix that in your ticket guidance (or in ${name}), then press Retry.`;
  }
  if (status && status >= 500) return `${name} had a problem on its side (error ${status}). Wait a minute, then press Retry.`;

  if (/\bnot found\b/i.test(text) && /\b(project|team|board|database|repository|list)\b/i.test(text)) {
    return `${name} couldn't find where to file the ticket (${text.slice(0, 160)}). Choose another place in your ticket guidance, then press Retry.`;
  }
  if (/\b(not connected|no token|reconnect|invalid_grant|unauthori[sz]ed)\b/i.test(text)) {
    return `Your ${name} connection needs to be set up again. Reconnect it in Connections, then press Retry.`;
  }

  // Already a plain sentence: keep it.
  if (!looksTechnical(text) && text.length <= 300) return text;
  return `The ticket didn't file in ${name}: ${(reason ?? text).slice(0, 200)}. Press Retry; if it keeps failing, open the draft and file it yourself.`;
}
