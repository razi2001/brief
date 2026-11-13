import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/server";
import { lookupNames } from "@/lib/org-server";
import { BRIEF_URL } from "@/lib/tracker";
import { errorMessage } from "@/lib/errors";
import { isLive } from "@/lib/bash";
import { findBash, loadCounted, timesOf, type BashRow } from "@/lib/bash-server";
import { groupReports } from "@/lib/bash-ai";
import { labelInstruction, mergedDescription, pickPrimary, type ReviewReport } from "@/lib/bash-review";
import { FILING_CLAIM_TTL_MS, briefPhase, claimFiling, releaseFiling } from "@/lib/brief-filing";
import { draftBriefById, processBriefById } from "@/lib/agent/run-processing";
import { runDraftJob } from "@/lib/agent/draft-jobs";
import { resolveTrackerOrError } from "@/lib/trackers/registry";

/**
 * The review of a live bug bash, written with the service-role client. Only
 * whoever started the bash may do any of it; for anyone else the bash reads as
 * missing. Every entry point takes the signed-in user's id from the route's own
 * auth() call.
 */

const appOrigin = () => (process.env.APP_URL || BRIEF_URL).replace(/\/+$/, "");

/** The bug bash, when this person started it, it holds its reports, and it is over. */
async function reviewable(db: SupabaseClient, code: string, userId: string): Promise<BashRow | "missing" | "running"> {
  const bash = await findBash(code, db);
  if (!bash || bash.created_by !== userId || !bash.hold) return "missing";
  return isLive(timesOf(bash), Date.now()) ? "running" : bash;
}

export type GroupResult = "ok" | "missing" | "running" | "error";

/** How long a grouping may take before its claim counts as abandoned. */
const GROUPING_CLAIM_TTL_MS = 5 * 60 * 1000;

/** Write-ups tried again at once: enough to be quick, few enough to be gentle on the model. */
const REWRITE_AT_ONCE = 4;

/**
 * Give the reports whose write-up failed (the model didn't answer when they
 * were sent) one more try, and wait for it. Only a report nothing was ever
 * written for, with no ticket and no filing under way. Never throws: a report
 * that fails again simply stays as it was.
 */
export async function rewriteFailed(db: SupabaseClient, briefIds: string[]): Promise<number> {
  if (briefIds.length === 0) return 0;
  const found = await db
    .from("briefs")
    .select("id, user_id")
    .in("id", briefIds.slice(0, 200))
    .eq("status", "failed")
    .is("ticket_body", null)
    .is("ticket_url", null)
    .is("filing_started_at", null)
    .is("archived_at", null);
  const rows = (found.data ?? []) as { id: string; user_id: string }[];
  const queue = [...rows];
  const worker = async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const { id, user_id } = b;
      try {
        const marked = await db
          .from("briefs")
          .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("status", "failed")
          .is("ticket_body", null)
          .is("ticket_url", null)
          .is("filing_started_at", null)
          .select("id");
        if (marked.error || !marked.data?.length) continue;
        await runDraftJob(id, () => draftBriefById(user_id, id));
      } catch (e) {
        console.error("[bash] a report could not be written again:", errorMessage(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REWRITE_AT_ONCE, rows.length) }, worker));
  return rows.length;
}

/**
 * Put the session's reports in groups, once. The first call takes the claim
 * (grouped_at) and asks the model; a second call, or one racing the first,
 * finds it taken and does nothing. If the groups can't be saved the claim is
 * given back, so the next call tries again.
 */
export async function ensureGrouped(code: string, userId: string): Promise<GroupResult> {
  const db = createAdminSupabase();
  const bash = await reviewable(db, code, userId);
  if (bash === "missing" || bash === "running") return bash;
  if (bash.grouped_at) {
    // Claimed, and either done or under way. One claimed long ago with nothing
    // saved never finished (the server stopped mid-way): give the claim back.
    if (Date.now() - new Date(bash.grouped_at).getTime() < GROUPING_CLAIM_TTL_MS) return "ok";
    const [saved, waiting] = await Promise.all([
      db.from("bash_groups").select("id").eq("bash_id", bash.id).limit(1),
      db.from("bash_briefs").select("brief_id").eq("bash_id", bash.id).is("group_id", null).eq("dropped", false).limit(1),
    ]);
    if ((saved.data ?? []).length > 0 || (waiting.data ?? []).length === 0) return "ok";
    await db.from("bashes").update({ grouped_at: null }).eq("id", bash.id).eq("grouped_at", bash.grouped_at);
  }

  const claim = await db
    .from("bashes")
    .update({ grouped_at: new Date().toISOString() })
    .eq("id", bash.id)
    .is("grouped_at", null)
    .select("id");
  if (claim.error) return "error";
  if (!claim.data?.length) return "ok";

  try {
    // A report the model never wrote up gets one more try first, so it is
    // grouped on what it says and not on its working title alone.
    const first = await loadCounted(bash, db);
    const unwritten = first.briefs.filter((b) => b.status === "failed" && !b.ticket_body && !b.ticket_url).map((b) => b.id);
    const { briefs } = unwritten.length && (await rewriteFailed(db, unwritten)) ? await loadCounted(bash, db) : first;
    // Oldest first: the order people found things in.
    const reports: ReviewReport[] = [...briefs]
      .reverse()
      .map((b) => ({ id: b.id, title: b.ticket_title || b.title || "", body: b.ticket_body ?? "", userId: b.userId, createdAt: b.createdAt }));
    const groups = await groupReports(reports);

    if (groups.length > 0) {
      const made = await db
        .from("bash_groups")
        .insert(groups.map((g, i) => ({ bash_id: bash.id, title: g.title, position: i })))
        .select("id, position");
      if (made.error || !made.data) throw new Error(made.error?.message ?? "no groups saved");
      const idAt = new Map((made.data as { id: string; position: number }[]).map((g) => [g.position, g.id]));
      // The reports are already this bug bash's (marked as they were sent): give each its group.
      for (let i = 0; i < groups.length; i++) {
        const placed = await db.from("bash_briefs").update({ group_id: idAt.get(i)!, dropped: false }).eq("bash_id", bash.id).in("brief_id", groups[i].ids);
        if (placed.error) throw new Error(placed.error.message);
      }
    }
    return "ok";
  } catch (e) {
    console.error("[bash] grouping could not be saved:", errorMessage(e));
    // Deleting the groups also clears each report's group (on delete set null).
    await db.from("bash_groups").delete().eq("bash_id", bash.id);
    await db.from("bashes").update({ grouped_at: null }).eq("id", bash.id);
    return "error";
  }
}

type Place = { brief_id: string; group_id: string | null; dropped: boolean };
type GroupState = { id: string; ticket_url: string | null; filing_started_at: string | null };

const busy = (g: GroupState | null | undefined) =>
  !!g && (!!g.ticket_url || (!!g.filing_started_at && Date.now() - new Date(g.filing_started_at).getTime() < FILING_CLAIM_TTL_MS));

async function groupOf(db: SupabaseClient, bashId: string, groupId: string): Promise<GroupState | null> {
  const { data } = await db
    .from("bash_groups")
    .select("id, ticket_url, filing_started_at")
    .eq("id", groupId)
    .eq("bash_id", bashId)
    .maybeSingle();
  return (data as GroupState | null) ?? null;
}

async function placeOf(db: SupabaseClient, bashId: string, briefId: string): Promise<Place | null> {
  const { data } = await db
    .from("bash_briefs")
    .select("brief_id, group_id, dropped")
    .eq("brief_id", briefId)
    .eq("bash_id", bashId)
    .maybeSingle();
  return (data as Place | null) ?? null;
}

/** A report whose group already is (or is becoming) a ticket can't be taken out of it. */
async function locked(db: SupabaseClient, bashId: string, place: Place): Promise<boolean> {
  return !!place.group_id && !place.dropped && busy(await groupOf(db, bashId, place.group_id));
}

export type EditResult = "ok" | "missing" | "running" | "locked" | "error";

/**
 * Move a report to another group, or to a new group of its own (`to: "new"`,
 * titled after the report). Also how a dropped report comes back.
 */
export async function moveReport(code: string, userId: string, briefId: string, to: string): Promise<EditResult> {
  const db = createAdminSupabase();
  const bash = await reviewable(db, code, userId);
  if (bash === "missing" || bash === "running") return bash;
  const place = await placeOf(db, bash.id, briefId);
  if (!place) return "missing";
  if (await locked(db, bash.id, place)) return "locked";

  let target = to;
  if (to === "new") {
    const [brief, last] = await Promise.all([
      db.from("briefs").select("title, ticket_title").eq("id", briefId).maybeSingle(),
      db.from("bash_groups").select("position").eq("bash_id", bash.id).order("position", { ascending: false }).limit(1),
    ]);
    const b = brief.data as { title: string | null; ticket_title: string | null } | null;
    const made = await db
      .from("bash_groups")
      .insert({
        bash_id: bash.id,
        title: b?.ticket_title || b?.title || "Untitled",
        position: ((last.data?.[0] as { position: number } | undefined)?.position ?? -1) + 1,
      })
      .select("id")
      .single();
    if (made.error || !made.data) return "error";
    target = made.data.id;
  } else {
    const group = await groupOf(db, bash.id, to);
    if (!group) return "missing";
    if (busy(group)) return "locked";
  }

  const { error } = await db.from("bash_briefs").update({ group_id: target, dropped: false }).eq("brief_id", briefId).eq("bash_id", bash.id);
  return error ? "error" : "ok";
}

/** Leave a report out of every ticket. It stays a draft for whoever made it. */
export async function dropReport(code: string, userId: string, briefId: string): Promise<EditResult> {
  const db = createAdminSupabase();
  const bash = await reviewable(db, code, userId);
  if (bash === "missing" || bash === "running") return bash;
  const place = await placeOf(db, bash.id, briefId);
  if (!place) return "missing";
  if (await locked(db, bash.id, place)) return "locked";
  const { error } = await db.from("bash_briefs").update({ group_id: null, dropped: true }).eq("brief_id", briefId).eq("bash_id", bash.id);
  return error ? "error" : "ok";
}

/** Change the title a group's ticket will carry. */
export async function renameGroup(code: string, userId: string, groupId: string, title: string): Promise<EditResult> {
  const db = createAdminSupabase();
  const bash = await reviewable(db, code, userId);
  if (bash === "missing" || bash === "running") return bash;
  const group = await groupOf(db, bash.id, groupId);
  if (!group) return "missing";
  if (busy(group)) return "locked";
  const { error } = await db.from("bash_groups").update({ title }).eq("id", groupId).eq("bash_id", bash.id);
  return error ? "error" : "ok";
}

type DraftRow = {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  ticket_title: string | null;
  ticket_body: string | null;
  ticket_url: string | null;
  filing_started_at: string | null;
  share_id: string | null;
  created_at: string;
};

export type ExportStart =
  | { ok: true; run: () => Promise<void> }
  | { ok: false; reason: "missing" | "running" | "filed" | "filing" | "empty" | "unwritten" }
  | { ok: false; reason: "tracker"; message: string };

/**
 * Make one ticket out of a group. This takes every claim that stops it
 * becoming two (the group's own, then the leading report's filing claim) and
 * hands back `run`, the filing itself, for the route to do in the background.
 *
 * The ticket is the leading report's write-up under the group's title, plus
 * every report of the bug with a link to its Brief page. It is filed with the
 * tracker and ticket preferences of whoever started the bash, and carries the
 * bash's name as a label. Once it exists, the other reports of the group point
 * at it too, so each reporter sees it (and its status) in their own Tickets.
 */
export async function startGroupExport(code: string, userId: string, groupId: string): Promise<ExportStart> {
  const db = createAdminSupabase();
  const bash = await reviewable(db, code, userId);
  if (bash === "missing" || bash === "running") return { ok: false, reason: bash };

  const group = await db
    .from("bash_groups")
    .select("id, title, ticket_url")
    .eq("id", groupId)
    .eq("bash_id", bash.id)
    .maybeSingle();
  const g = group.data as { id: string; title: string; ticket_url: string | null } | null;
  if (!g) return { ok: false, reason: "missing" };
  if (g.ticket_url) return { ok: false, reason: "filed" };

  // Say why before any claim: nothing connected, a workspace still to pick, an
  // expired connection.
  const { error: trackerError } = await resolveTrackerOrError(userId);
  if (trackerError) return { ok: false, reason: "tracker", message: trackerError };

  const release = (error: string | null = null) =>
    db.from("bash_groups").update({ filing_started_at: null, error }).eq("id", g.id).is("ticket_url", null);

  const now = new Date();
  const stale = new Date(now.getTime() - FILING_CLAIM_TTL_MS).toISOString();
  const claim = await db
    .from("bash_groups")
    .update({ filing_started_at: now.toISOString(), error: null })
    .eq("id", g.id)
    .is("ticket_url", null)
    .or(`filing_started_at.is.null,filing_started_at.lt.${stale}`)
    .select("id");
  if (claim.error || !claim.data?.length) return { ok: false, reason: "filing" };

  const places = await db.from("bash_briefs").select("brief_id").eq("group_id", g.id).eq("dropped", false);
  const ids = ((places.data ?? []) as { brief_id: string }[]).map((p) => p.brief_id);
  const read = async () =>
    ids.length
      ? (((
          await db
            .from("briefs")
            .select("id, user_id, status, title, ticket_title, ticket_body, ticket_url, filing_started_at, share_id, created_at")
            .in("id", ids)
            .is("archived_at", null)
        ).data ?? []) as DraftRow[])
      : [];
  // Only finished drafts can be filed: one still being written, or filed by
  // its owner in the meantime, is left out.
  const written = (all: DraftRow[]) => all.filter((b) => briefPhase(b) === "draft").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const neverWritten = (all: DraftRow[]) => all.filter((b) => b.status === "failed" && !b.ticket_body && !b.ticket_url && !b.filing_started_at);
  let rows = await read();
  let drafts = written(rows);
  // Nothing written to file from, because the model didn't answer when the
  // reports came in: try writing them now.
  if (drafts.length === 0 && neverWritten(rows).length > 0) {
    await rewriteFailed(db, neverWritten(rows).map((b) => b.id));
    rows = await read();
    drafts = written(rows);
    if (drafts.length === 0) {
      await release();
      return { ok: false, reason: "unwritten" };
    }
  }
  const primary = pickPrimary(
    drafts.map((b) => ({ id: b.id, title: b.ticket_title || b.title || "", body: b.ticket_body ?? "", userId: b.user_id, createdAt: b.created_at })),
  );
  const lead = drafts.find((b) => b.id === primary?.id);
  if (!lead) {
    await release();
    return { ok: false, reason: "empty" };
  }
  if (!(await claimFiling(db, lead.user_id, lead.id, { error: null }))) {
    await release();
    return { ok: false, reason: "filing" };
  }

  const names = await lookupNames(drafts.map((b) => b.user_id));
  const ordered = [lead, ...drafts.filter((b) => b.id !== lead.id)];
  const description = mergedDescription(
    lead.ticket_body ?? "",
    bash.name,
    ordered.map((b) => ({
      name: names.get(b.user_id)?.fullName ?? "someone",
      title: b.ticket_title || b.title || "Untitled",
      url: b.share_id ? `${appOrigin()}/b/${b.share_id}` : undefined,
    })),
  );

  const run = async () => {
    const fail = async (error: string) => {
      // The draft is never lost: it goes back to a draft, and the group says why.
      await releaseFiling(db, lead.user_id, lead.id, { status: "drafted", error });
      await release(error);
    };
    try {
      const r = await processBriefById(lead.user_id, lead.id, {
        fixed: { title: g.title, description },
        fileAs: userId,
        instruction: labelInstruction(bash.name),
      });
      if (!r.ok) return await fail(r.error);

      // The ticket exists. What follows is bookkeeping and must not undo that.
      const filed = await db
        .from("briefs")
        .select("ticket_url, ticket_identifier, ticket_provider, ticket_title, ticket_state_name, ticket_state_color")
        .eq("id", lead.id)
        .maybeSingle();
      const t = (filed.data ?? {}) as {
        ticket_url?: string | null;
        ticket_identifier?: string | null;
        ticket_provider?: string | null;
        ticket_title?: string | null;
        ticket_state_name?: string | null;
        ticket_state_color?: string | null;
      };
      const ticketUrl = t.ticket_url || r.result.ticketUrl;
      const ticketIdentifier = t.ticket_identifier || r.result.ticketIdentifier;
      await db
        .from("bash_groups")
        .update({
          ticket_url: ticketUrl,
          ticket_identifier: ticketIdentifier,
          ticket_provider: t.ticket_provider ?? null,
          filed_at: new Date().toISOString(),
          filing_started_at: null,
          error: null,
        })
        .eq("id", g.id);

      const others = ordered.slice(1).map((b) => b.id);
      if (others.length) {
        await db
          .from("briefs")
          .update({
            status: "filed",
            error: null,
            ticket_url: ticketUrl,
            ticket_identifier: ticketIdentifier,
            ticket_provider: t.ticket_provider ?? null,
            ticket_title: t.ticket_title ?? g.title,
            ticket_state_name: t.ticket_state_name ?? null,
            ticket_state_color: t.ticket_state_color ?? null,
            updated_at: new Date().toISOString(),
          })
          .in("id", others)
          // Still an untouched draft: one its owner filed or is filing is left alone.
          .eq("status", "drafted")
          .is("ticket_url", null)
          .is("filing_started_at", null);
      }
    } catch (e) {
      const still = await db.from("bash_groups").select("ticket_url").eq("id", g.id).maybeSingle();
      if (!(still.data as { ticket_url: string | null } | null)?.ticket_url) await fail(errorMessage(e));
    }
  };
  return { ok: true, run };
}
