import { videoLogsForAgent } from "./tech-details";
// Pure helper: distil the high-signal context out of brief.json into a compact,
// prominent text block for the filing agent. No SDK/IO deps, so it's unit-tested
// directly (context-block.test.ts).

/**
 * Extract the high-signal context (page URL/title, browser, console/runtime/
 * network errors, narration) out of brief.json into a compact, prominent text
 * block. The whole brief.json is still sent to the model, but key facts buried
 * in it - the URL, the errors - get surfaced here so the agent reliably uses
 * them.
 */
export function buildContextBlock(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = json as Record<string, any>;

  // Sections are assembled in priority order: the reporter's typed description
  // leads (it defines what the ticket is about), then page context, the spoken
  // narration (a rough draft of intent), the per-shot screenshot notes, and
  // finally console/network errors as SUPPORTING context only - never the headline.
  const sections: string[] = [];

  if (typeof j.description === "string" && j.description.trim()) {
    sections.push(
      "REPORTER'S DESCRIPTION (the primary signal - this is what the ticket is about; everything else corroborates it):\n" +
        j.description.trim().slice(0, 4000),
    );
  }

  const lines: string[] = [];
  if (j.pageUrl) lines.push(`- Page URL: ${j.pageUrl}`);
  if (j.pageTitle) lines.push(`- Page title: ${j.pageTitle}`);
  if (j.userAgent) lines.push(`- Browser (user agent): ${j.userAgent}`);
  if (lines.length) sections.push("PAGE CONTEXT (ground truth - put the URL in the ticket):\n" + lines.join("\n"));

  // The instant replay the reporter attached: what they actually did in the
  // browser just before reporting, read off a DOM recording (run-processing
  // summarises replay.json into `replay`). Reliable steps to reproduce.
  const replaySteps: string[] = Array.isArray(j.replay?.steps) ? j.replay.steps.filter((s: unknown) => typeof s === "string") : [];
  if (replaySteps.length) {
    const note = typeof j.replayNote === "string" && j.replayNote.trim() ? `Reporter's note on it: ${j.replayNote.trim().slice(0, 1000)}\n` : "";
    sections.push(
      "REPLAY (what the reporter did in the browser just before reporting, from a recording of the page - use it for accurate steps to reproduce; typed values were masked and are not known):\n" +
        note +
        replaySteps.map((s) => `- ${s.slice(0, 300)}`).join("\n"),
    );
  }
  // The exact capture: page trail, failed/slow network calls, console errors.
  // The ticket shows the full list itself (appended, folded); the agent's job
  // is to name what explains the bug in the write-up.
  const tech = Array.isArray(j.techLogs) ? videoLogsForAgent(j.techLogs) : "";
  if (tech) {
    sections.push(
      "TECHNICAL CAPTURE (exact, times are into the capture - name in the summary or Actual the call or error that explains the bug, if one does; the full list is appended to the ticket automatically, never write it yourself):\n" +
        tech,
    );
  }

  // Where the reporter marked the bug: the moments to look at first.
  const clockOf = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const markLines: string[] = [];
  for (const m of Array.isArray(j.recordingMarks) ? j.recordingMarks : []) {
    if (typeof m?.t === "number") markLines.push(`- ${clockOf(m.t)} into the recording${m.note?.trim() ? `: ${String(m.note).trim().slice(0, 300)}` : ""}`);
  }
  for (const m of Array.isArray(j.replay?.marks) ? j.replay.marks : []) {
    if (typeof m?.t === "number") markLines.push(`- ${clockOf(m.t)} into the replay${m.note?.trim() ? `: ${String(m.note).trim().slice(0, 300)}` : ""}`);
  }
  if (markLines.length) {
    sections.push(
      "KEY MOMENTS (the reporter marked where the bug happens - look at these first; the frames/stills at these times are labelled MARKED):\n" +
        markLines.join("\n"),
    );
  }

  if (typeof j.replay?.narration === "string" && j.replay.narration.trim()) {
    sections.push(
      "REPLAY NARRATION (the reporter's voice-over on the replay, transcribed - their account of what the replay shows; correct obvious mis-transcriptions):\n" +
        j.replay.narration.trim().slice(0, 4000),
    );
  }

  // Console errors come through as events of type "console-error" (args[]),
  // plus window "error"/"unhandledrejection", and failed requests as
  // "network-error" (method/url/status/reason). Surface them verbatim.
  const events: any[] = Array.isArray(j.events) ? j.events : [];
  const errs: string[] = [];
  for (const e of events) {
    const type = String(e?.type ?? e?.__brief ?? "");
    if (!/error|rejection/i.test(type)) continue;
    let msg: string;
    if (/network-error/i.test(type)) {
      // Network failures carry method/url/status/reason - NOT args/message - so
      // the generic extraction below would drop everything but a bare reason
      // (or dump the raw event JSON). Format them as "GET https://... -> 404 Not
      // Found" so the agent gets the failing call, not a blob. status 0 = a
      // transport failure (offline/CORS/abort), so show only the reason then.
      const method = String(e?.method || "GET");
      const url = String(e?.url || "");
      const status = e?.status ? ` → ${e.status}` : "";
      const reason = e?.reason ? ` ${e.reason}` : "";
      msg = `${method} ${url}${status}${reason}`.trim();
    } else {
      msg = Array.isArray(e?.args)
        ? e.args.join(" ")
        : e?.message || e?.reason || (typeof e?.payload === "string" ? e.payload : JSON.stringify(e));
    }
    if (msg && msg.trim()) errs.push(msg.trim().slice(0, 500));
  }

  // Narration is the reporter's spoken intent - a rough draft to corroborate
  // against the description and the visual/console ground truth, not quoted.
  if (typeof j.transcript === "string" && j.transcript.trim()) {
    sections.push(
      "SPOKEN NARRATION (transcribed audio - the reporter's rough-draft intent; corroborate against the description and the screenshots, and correct obvious mis-transcriptions):\n" +
        j.transcript.trim().slice(0, 4000),
    );
  }

  // Per-screenshot notes the reporter typed in the popup - their intent for each
  // shot. Surface them so the agent reads them as ground truth alongside the image.
  const shots: any[] = Array.isArray(j.screenshots) ? j.screenshots : [];
  const shotNotes = shots
    .map((s) => (typeof s?.description === "string" ? s.description.trim() : ""))
    .filter(Boolean);
  if (shotNotes.length) {
    sections.push(
      "SCREENSHOTS (the reporter's note on each flagged shot - treat as intent, corroborate against the image):\n" +
        [...new Set(shotNotes)].map((m) => `- ${m.slice(0, 500)}`).join("\n"),
    );
  }

  // Custom key/value fields the reporter typed in the popup - explicit structured
  // details (environment, severity, repro steps, etc.). Surface them so the agent
  // folds them into the ticket rather than leaving them buried in the JSON.
  const extra: any[] = Array.isArray(j.extra) ? j.extra : [];
  const extraPairs = extra
    .map((p) => {
      const k = typeof p?.key === "string" ? p.key.trim() : "";
      const v = typeof p?.value === "string" ? p.value.trim() : "";
      return k || v ? `- ${k ? `${k}: ` : ""}${v}`.slice(0, 500) : "";
    })
    .filter(Boolean);
  if (extraPairs.length) {
    sections.push(
      "REPORTER-PROVIDED DETAILS (structured fields the reporter added - include these in the ticket, e.g. an Environment/Details section):\n" +
        extraPairs.join("\n"),
    );
  }

  // Console/network errors are SUPPORTING context only: useful detail for the
  // ticket body, not the thing the ticket is about and not the primary router.
  // the TECHNICAL CAPTURE above covers these when the capture has it
  if (errs.length && !tech) {
    const unique = [...new Set(errs)].slice(0, 8);
    sections.push(
      "SUPPORTING TECHNICAL CONTEXT (console / network errors captured during the session - use these as extra detail to enrich the ticket, e.g. a context line or code block; do NOT let them define what the ticket is about or drive routing unless the reporter's description points at them):\n" +
        unique.map((m) => `- ${m}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}
