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
  const lines: string[] = [];
  if (j.pageUrl) lines.push(`- Page URL: ${j.pageUrl}`);
  if (j.pageTitle) lines.push(`- Page title: ${j.pageTitle}`);
  if (j.userAgent) lines.push(`- Browser (user agent): ${j.userAgent}`);

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
      // (or dump the raw event JSON). Format them as "GET https://… → 404 Not
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
  let block = "";
  if (lines.length) block += "PAGE CONTEXT (ground truth - put the URL in the ticket):\n" + lines.join("\n");
  if (errs.length) {
    const unique = [...new Set(errs)].slice(0, 8);
    block += (block ? "\n\n" : "") + "CONSOLE / RUNTIME ERRORS (verbatim - include the relevant ones in a code block):\n" + unique.map((m) => `- ${m}`).join("\n");
  }
  // Surface the narration as its own labeled block instead of leaving it
  // buried in the JSON - it's the reporter's intent, to be corrected against
  // the visual/console ground truth.
  if (typeof j.transcript === "string" && j.transcript.trim()) {
    block +=
      (block ? "\n\n" : "") +
      "SPOKEN NARRATION (rough draft - speech-to-text; trust the screenshots/console/events over it, never quote it):\n" +
      j.transcript.trim().slice(0, 4000);
  }
  return block;
}
