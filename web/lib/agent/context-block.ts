import { techFromRecording, videoLogsForAgent } from "./tech-details";
import { clockOf, distinctPages, pageAt, pageName, pageTrail, recordingTimeline } from "./timeline";
import type { BriefJson, CaptureEvent } from "./overrides";
import type { SaidLine } from "./transcribe";
// Pure helper: distil the high-signal context out of brief.json into a compact,
// prominent text block for the filing agent. No SDK/IO deps, so it's unit-tested
// directly (context-block.test.ts).

const SPEECH = "Fix obvious mis-hearings and never quote it word for word";

/**
 * Extract the high-signal context (page URL/title, browser, console/runtime/
 * network errors, narration) out of brief.json into a compact, prominent text
 * block. The whole brief.json is still sent to the model, but key facts buried
 * in it - the URL, the errors - get surfaced here so the agent reliably uses
 * them.
 */
export function buildContextBlock(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const j = (json ?? {}) as BriefJson;

  // Sections are assembled in priority order: the reporter's own words lead
  // (typed, then spoken - they define what the ticket is about), then where it
  // happened, what happened when, the per-shot screenshot notes, and finally
  // console/network errors as SUPPORTING context only - never the headline.
  const sections: string[] = [];

  // One key press, nothing typed: the bug has to be found, not just written up.
  if (j.autoReport === true && !(typeof j.description === "string" && j.description.trim())) {
    sections.push(
      "ONE-CLICK REPORT (the reporter pressed one key the moment something went wrong and typed nothing): work out what went wrong from the SUSPECTS, the replay stills and the technical capture. " +
        "When something clearly failed (a failed or slow call, an error, an error message on the page, a click that did nothing, or something plainly broken on screen: overlapping or cut-off text, a broken layout, missing content), write the ticket about it, described as the user experienced it (the title, summary, Expected and Actual stay functional; the failing call or error goes in Technical notes). " +
        "A field's typed text (asterisks) or a box the reporter ticked is not proof of a failure. If nothing clearly failed, do NOT invent a bug: title it after what the reporter was doing and say nothing failed (e.g. \"Checkout: applying a coupon, no failure found\"), describe the steps and what is visible, say plainly that no error showed up, and leave out Expected, Actual and Technical notes.",
    );
  }

  if (typeof j.description === "string" && j.description.trim()) {
    sections.push(
      "REPORTER'S DESCRIPTION (the primary signal - this is what the ticket is about; everything else corroborates it):\n" +
        j.description.trim().slice(0, 4000),
    );
  }

  if (typeof j.name === "string" && j.name.trim()) {
    sections.push("REPORTER'S TITLE (their working title for the report):\n" + j.name.trim().slice(0, 200));
  }

  // What the reporter SAYS is as much the report as what they type: people
  // talk through a video instead of typing. With nothing typed, it IS the report.
  const typed = typeof j.description === "string" && !!j.description.trim();
  const transcript = typeof j.transcript === "string" ? j.transcript.trim() : "";
  const replayVoice = typeof j.replay?.narration === "string" ? j.replay.narration.trim() : "";
  const spoken = (title: string, what: string) =>
    typed
      ? `${title} (${what}, transcribed audio - said while showing it: it fleshes out the description, and whatever they point out as wrong is part of the report. ${SPEECH}):`
      : `WHAT THE REPORTER SAYS (${what}, transcribed audio - they typed nothing, so this is the report: what they point out as wrong is the bug, what they say should happen is the Expected, what they do before it are the steps. ${SPEECH}):`;
  if (transcript) sections.push(spoken("SPOKEN NARRATION", "while recording the screen") + "\n" + transcript.slice(0, 4000));
  if (replayVoice) sections.push(spoken("REPLAY NARRATION", "their voice-over on the replay") + "\n" + replayVoice.slice(0, 4000));

  // Where it happened. A video can cross pages, and the page it started on is
  // only that: the ticket's Context is the page the problem shows on.
  const browser = j.userAgent ? `- Browser (user agent): ${j.userAgent}` : "";
  const uploaded = j.recording?.source === "upload";
  const rec = techFromRecording(j);
  const start = { url: j.pageUrl, title: j.pageTitle };
  const recMarks = (Array.isArray(j.recordingMarks) ? j.recordingMarks : []).filter((m) => typeof m?.t === "number");
  const replayTd = (Array.isArray(j.techLogs) ? j.techLogs : []).find((v) => v?.label === "Replay")?.td;
  const replayMarks = (Array.isArray(j.replay?.marks) ? j.replay.marks : []).filter((m) => typeof m?.t === "number" && !m.auto);
  const trails = [
    { video: "recording", pages: uploaded ? [] : pageTrail(rec, start), marks: recMarks },
    { video: "replay", pages: pageTrail(replayTd, start), marks: replayMarks },
  ].filter((v) => v.pages.length);
  if (uploaded) {
    sections.push(
      "PAGE: not known. The reporter uploaded this video from a file, so it can come from any app or page. If the video shows an address, use it; otherwise name the screen in words. Never make up an address." +
        (browser ? `\n${browser}` : ""),
    );
  } else if (trails.some((v) => distinctPages(v.pages) > 1)) {
    const parts = trails.map((v) => {
      const shown = v.pages.slice(0, 25);
      const list = shown.map((p, i) => {
        const end = i === 0 ? ` - the ${v.video} started here` : i === v.pages.length - 1 ? ` - the ${v.video} ended here` : "";
        return `- ${clockOf(p.t)} ${pageName(p)}${end}`;
      });
      const marked = [...new Set(v.marks.map((m) => pageAt(v.pages, m.t)).filter((p) => !!p).map((p) => pageName(p!)))];
      if (marked.length) list.push(`The reporter marked the problem on: ${marked.join(", ")}`);
      return (trails.length > 1 ? `The ${v.video} (times into it):\n` : "") + list.join("\n");
    });
    sections.push(
      "PAGES (the capture went through several pages, in order, times into it. The ticket's Context is the page where the problem shows: where the reporter says or marks that something is wrong, or where it fails. That is often NOT the first page, which is only where the capture started):\n" +
        parts.join("\n") +
        (browser ? `\n${browser}` : ""),
    );
  } else {
    const lines: string[] = [];
    if (j.pageUrl) lines.push(`- Page URL: ${j.pageUrl}`);
    if (j.pageTitle) lines.push(`- Page title: ${j.pageTitle}`);
    if (browser) lines.push(browser);
    if (lines.length) sections.push("PAGE (where this happened - link it in the ticket's Context):\n" + lines.join("\n"));
  }

  // The instant replay the reporter attached: what they actually did in the
  // browser just before reporting, read off a DOM recording (run-processing
  // summarises replay.json into `replay`). Reliable steps to reproduce.
  const replaySteps: string[] = Array.isArray(j.replay?.steps) ? j.replay.steps.filter((s: unknown) => typeof s === "string") : [];
  if (replaySteps.length) {
    const note = typeof j.replayNote === "string" && j.replayNote.trim() ? `Reporter's note on it: ${j.replayNote.trim().slice(0, 1000)}\n` : "";
    sections.push(
      "REPLAY (what the reporter did in the browser just before reporting, from a recording of the page - use it for accurate steps to reproduce. Typed values are not known: in the replay stills, whatever was typed into a field shows as asterisks (*****), hidden for privacy - that is not the app's display and never a bug. A field can also still show its asterisks after the page emptied it, so never report a field as not cleared from a still alone):\n" +
        note +
        replaySteps.map((s) => `- ${s.slice(0, 300)}`).join("\n"),
    );
  }
  // A screen recording, moment by moment: its pages, clicks, failures, marks
  // and, when the narration is timed, what the reporter said at each moment.
  const said: SaidLine[] = Array.isArray(j.narrationTimed) ? j.narrationTimed : [];
  const timeline = uploaded ? [] : recordingTimeline(rec, { said, marks: recMarks, startUrl: j.pageUrl, startTitle: j.pageTitle });
  if (timeline.length) {
    sections.push(
      (said.length
        ? "RECORDING TIMELINE (the screen recording moment by moment, times into it - the same clock as the frames. A \"says\" line is the reporter's voice at that moment: the page, the frames and the calls at the time they say something is wrong show what they mean. Use it for the steps to reproduce; typed values are not known):\n"
        : "RECORDING TIMELINE (what the reporter did during the screen recording, from its event log, times into it - the same clock as the frames. Use it for the steps to reproduce; typed values are not known):\n") +
        timeline.slice(0, 160).join("\n"),
    );
  }

  // The exact capture: page trail, failed/slow network calls, console errors.
  // The ticket shows the full list itself (appended, folded); the agent's job
  // is to name what explains the bug in the write-up.
  const tech = Array.isArray(j.techLogs) ? videoLogsForAgent(j.techLogs) : "";
  if (tech) {
    sections.push(
      "TECHNICAL CAPTURE (exact, times are into the capture - if a call or error here explains the bug, name it under a separate \"Technical notes\" section at the end, never in the summary, Expected or Actual; the full list is appended to the ticket automatically, never write it yourself):\n" +
        tech,
    );
  }

  // Where the reporter marked the bug: the moments to look at first.
  const markLines: string[] = [];
  for (const m of Array.isArray(j.recordingMarks) ? j.recordingMarks : []) {
    if (typeof m?.t === "number") markLines.push(`- ${clockOf(m.t)} into the recording${m.note?.trim() ? `: ${String(m.note).trim().slice(0, 300)}` : ""}`);
  }
  const suspectLines: string[] = [];
  for (const m of Array.isArray(j.replay?.marks) ? j.replay.marks : []) {
    if (typeof m?.t !== "number") continue;
    const line = `- ${clockOf(m.t)} into the replay${m.note?.trim() ? `: ${String(m.note).trim().slice(0, 300)}` : ""}`;
    (m.auto ? suspectLines : markLines).push(line);
  }
  if (suspectLines.length) {
    sections.push(
      "SUSPECTS (found automatically in the replay - failed calls, errors, repeated or dead clicks, error text on the page; the stills labelled \"Brief noticed\" are at these times). Likely where it broke, but verify each against the stills and the capture; ignore one that doesn't fit:\n" +
        suspectLines.join("\n"),
    );
  }
  if (markLines.length) {
    sections.push(
      "KEY MOMENTS (the reporter marked where the bug happens - look at these first; the frames/stills at these times are labelled MARKED):\n" +
        markLines.join("\n"),
    );
  }

  // Console errors come through as events of type "console-error" (args[]),
  // plus window "error"/"unhandledrejection", and failed requests as
  // "network-error" (method/url/status/reason). Surface them verbatim.
  const events: CaptureEvent[] = Array.isArray(j.events) ? j.events : [];
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
        : String(e?.message || e?.reason || (typeof e?.payload === "string" ? e.payload : JSON.stringify(e)));
    }
    if (msg && msg.trim()) errs.push(msg.trim().slice(0, 500));
  }

  // Per-screenshot notes the reporter typed in the popup - their intent for each
  // shot. Surface them so the agent reads them as ground truth alongside the image.
  const shots: Array<{ description?: unknown }> = Array.isArray(j.screenshots) ? j.screenshots : [];
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
  const extra: Array<{ key?: unknown; value?: unknown }> = Array.isArray(j.extra) ? j.extra : [];
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
      "SUPPORTING TECHNICAL CONTEXT (console / network errors captured during the session - if one explains the bug, name it under Technical notes; do NOT let them define what the ticket is about or drive routing unless the reporter's description points at them):\n" +
        unique.map((m) => `- ${m}`).join("\n"),
    );
  }

  return sections.join("\n\n");
}
