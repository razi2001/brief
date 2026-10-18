import { NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { briefPhase } from "@/lib/brief-filing";
import { findRecordingName } from "@/lib/brief";
import { BRIEF_URL } from "@/lib/tracker";
import { providerName } from "@/lib/trackers/registry";
import { displayIdentifier, providerOf } from "@/lib/ticket-sync";
import { agentReportMarkdown, type AgentEvidence } from "@/lib/agent-report";

// Waiting for the write-up can take a while, and a stale copy is no use.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long a fetch waits for a report still being written, and how often it looks. */
const WAIT_MS = 45_000;
const POLL_MS = 2_000;

const COLUMNS =
  "status, title, created_at, ticket_url, ticket_identifier, ticket_title, ticket_body, ticket_provider, filing_started_at, storage_prefix";

type Row = {
  status: string;
  title: string | null;
  created_at: string | null;
  ticket_url: string | null;
  ticket_identifier: string | null;
  ticket_title: string | null;
  ticket_body: string | null;
  ticket_provider: string | null;
  filing_started_at: string | null;
  storage_prefix: string;
};

function markdown(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The brief at /b/<shareId> as Markdown for a coding agent (served at
 * /b/<shareId>.md, see proxy.ts). Public on the same terms as the page: the
 * unguessable share token is the permission. A report still being written is
 * waited for (the Fix prompt is copied before the write-up exists), up to
 * WAIT_MS; past that, the agent gets the reporter's own words and is told to
 * come back.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await ctx.params;
  const admin = createAdminSupabase();
  const load = async () =>
    ((await admin.from("briefs").select(COLUMNS).eq("share_id", shareId).maybeSingle()).data as Row | null) ?? null;

  let brief = await load();
  const until = Date.now() + WAIT_MS;
  const pending = (b: Row) => {
    const phase = briefPhase(b);
    return (phase === "writing" || phase === "filing") && !b.ticket_body;
  };
  while (brief && pending(brief) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    brief = await load();
  }
  if (!brief) return markdown("# Not found\n\nThere is no bug report at this link.\n", 404);

  const phase = briefPhase(brief);
  const prefix = brief.storage_prefix;
  const origin = (process.env.APP_URL || BRIEF_URL).replace(/\/+$/, "");
  const evidenceUrl = (rel: string) => `${origin}/api/evidence/${encodeURIComponent(shareId)}/${rel}`;

  // What the reporter gave (page, words, screenshot notes), and what is still
  // in storage - the same objects the public evidence route serves.
  const [json, shotList, rootList, stillList] = await Promise.all([
    admin.storage
      .from("briefs")
      .download(`${prefix}/brief.json`)
      .then(async ({ data }) => (data ? JSON.parse(await data.text()) : {}))
      .catch(() => ({})),
    admin.storage.from("briefs").list(`${prefix}/screenshots`).then(({ data }) => data ?? []),
    admin.storage.from("briefs").list(prefix).then(({ data }) => data ?? []),
    admin.storage.from("briefs").list(`${prefix}/replay-frames`).then(({ data }) => data ?? []),
  ]);
  const captions = new Map<string, string>(
    (Array.isArray(json?.screenshots) ? json.screenshots : [])
      .filter((s: { file?: unknown; description?: unknown }) => typeof s?.file === "string" && typeof s?.description === "string")
      .map((s: { file: string; description: string }) => [s.file, s.description]),
  );
  const rootNames = new Set(rootList.map((o) => o.name));
  const evidence: AgentEvidence[] = [];
  for (const name of shotList.map((o) => o.name).filter((n) => /\.png$/.test(n)).sort()) {
    const rel = `screenshots/${name}`;
    evidence.push({ kind: "screenshot", url: evidenceUrl(rel), caption: captions.get(rel) || null });
  }
  if (rootNames.has("screenshot.png")) evidence.push({ kind: "screenshot", url: evidenceUrl("screenshot.png") });
  const recording = findRecordingName(rootNames);
  if (recording) evidence.push({ kind: "recording", url: evidenceUrl(recording) });
  for (const name of stillList.map((o) => o.name).filter((n) => /^frame-\d{2}\.jpg$/.test(n)).sort()) {
    evidence.push({ kind: "still", url: evidenceUrl(`replay-frames/${name}`) });
  }

  const provider = providerOf(brief.ticket_url, brief.ticket_provider);
  const filed =
    phase === "filed"
      ? {
          tracker: providerName(provider),
          identifier: displayIdentifier(brief.ticket_identifier, provider) || null,
          url: brief.ticket_url,
        }
      : null;
  const pageUrl = typeof json?.pageUrl === "string" ? json.pageUrl : null;

  return markdown(
    agentReportMarkdown({
      title: brief.ticket_title || brief.title || "",
      state: phase === "failed" ? "failed" : brief.ticket_body || phase === "filed" ? "written" : "writing",
      body: brief.ticket_body,
      filed,
      reported: formatDate(brief.created_at),
      page: pageUrl ? { url: pageUrl, title: typeof json?.pageTitle === "string" ? json.pageTitle : null } : null,
      description: typeof json?.description === "string" ? json.description : null,
      evidence,
    }),
  );
}
