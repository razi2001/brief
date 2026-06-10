import { createAdminSupabase } from "@/lib/supabase/server";
import { getLinearToken, makeLinearTracker } from "@/lib/linear";
import { getJiraAuth, getJiraCloud, makeJiraTracker } from "@/lib/jira";
import type { Tracker } from "@/lib/tracker";
import { processBrief, type BriefInput } from "@/lib/agent/process-brief";
import { getUserSettings } from "@/lib/settings";

export type ProcessResult =
  | { ok: true; result: { ticketUrl: string; ticketIdentifier: string; summary: string } }
  | { ok: false; status: number; error: string };

/**
 * Orchestrates filing a single brief: load the row (scoped to userId), resolve
 * the tracker (Linear preferred, Jira fallback), download media, run the agent,
 * mark the row 'filed' and delete media on success, or 'failed' on error.
 *
 * This is the shared core behind both the bearer-authed extension route
 * (POST /api/briefs/[id]/process) and the Clerk-authed dashboard retry route.
 * Behavior must remain identical to the original process route.
 */
export async function processBriefById(userId: string, briefId: string): Promise<ProcessResult> {
  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("*")
    .eq("id", briefId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return { ok: false, status: 404, error: "not found" };

  // Resolve the tracker provider. Linear is the default/preferred provider; fall
  // back to Jira only if Linear isn't connected.
  let tracker: Tracker | null = null;
  const linearTok = await getLinearToken(userId);
  if (linearTok) {
    tracker = makeLinearTracker(linearTok);
  } else {
    const jiraTok = await getJiraAuth(userId);
    if (jiraTok) {
      const cloud = await getJiraCloud(jiraTok);
      if (cloud) tracker = makeJiraTracker(jiraTok, cloud);
    }
  }
  if (!tracker) return { ok: false, status: 409, error: "no tracker connected" };

  // Account-level ticket guidance (Clerk privateMetadata), applied by the agent.
  const { ticketGuidance } = await getUserSettings(userId);

  await admin.from("briefs").update({ status: "processing" }).eq("id", briefId);
  try {
    // load brief.json + select keyframes (first/mid/last) + screenshot as data URLs
    const prefix = brief.storage_prefix as string;
    const dl = async (p: string) => {
      const { data } = await admin.storage.from("briefs").download(p);
      return data ? Buffer.from(await data.arrayBuffer()) : null;
    };
    const briefJsonBuf = await dl(`${prefix}/brief.json`);
    const json = briefJsonBuf ? JSON.parse(briefJsonBuf.toString("utf8")) : {};

    const images: BriefInput["images"] = [];
    const evidence: BriefInput["evidence"] = [];

    // Collect picked keyframes. They always go to `images` (so the model can SEE
    // them and write an accurate description), but we only EMBED them in the
    // ticket when there's no recording — otherwise the keyframe stills just
    // duplicate frames of the video that's already embedded.
    const keyframeEvidence: BriefInput["evidence"] = [];
    const { data: kf } = await admin.storage.from("briefs").list(`${prefix}/keyframes`, { limit: 200 });
    const names = (kf ?? []).map((o) => o.name).sort();
    const pick = names.length ? [names[0], names[Math.floor(names.length / 2)], names[names.length - 1]] : [];
    for (const n of [...new Set(pick)]) {
      const b = await dl(`${prefix}/keyframes/${n}`);
      if (!b) continue;
      const filename = n.split("/").pop() || n;
      images.push({ name: n, dataUrl: `data:image/png;base64,${b.toString("base64")}` });
      keyframeEvidence.push({ filename, contentType: "image/png", bytes: b });
    }

    // A user-annotated screenshot is intentional markup — always embed it.
    const shot = await dl(`${prefix}/screenshot.png`);
    if (shot) {
      images.push({ name: "screenshot.png", dataUrl: `data:image/png;base64,${shot.toString("base64")}` });
      evidence.push({ filename: "screenshot.png", contentType: "image/png", bytes: shot });
    }

    const rec = await dl(`${prefix}/recording.webm`);
    if (rec) {
      // The video covers the keyframes, so embed it INSTEAD of the stills.
      evidence.push({ filename: "recording.webm", contentType: "video/webm", bytes: rec });
    } else {
      // No video — the keyframe stills are the visual evidence.
      evidence.push(...keyframeEvidence);
    }

    console.log(
      `[process] brief ${briefId} via ${tracker.kind}: keyframes=${names.length} picked=${[...new Set(pick)].length} screenshot=${!!shot} recording=${!!rec} evidence=${evidence.length}`
    );

    const result = await processBrief({ json, images, evidence }, tracker, ticketGuidance);

    await admin
      .from("briefs")
      .update({ status: "filed", ticket_url: result.ticketUrl, ticket_identifier: result.ticketIdentifier, updated_at: new Date().toISOString() })
      .eq("id", briefId);

    // delete media on success (keep the row)
    const toDelete: string[] = [`${prefix}/brief.json`, `${prefix}/recording.webm`, `${prefix}/screenshot.png`, ...names.map((n) => `${prefix}/keyframes/${n}`)];
    await admin.storage.from("briefs").remove(toDelete);

    return { ok: true, result };
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", briefId);
    return { ok: false, status: 500, error: String(e?.message ?? e) };
  }
}
