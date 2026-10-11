import { NextRequest, after } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { loadBriefInput, draftBriefById } from "@/lib/agent/run-processing";
import { briefPhase } from "@/lib/brief-filing";
import { draftJob, holdDraftJob, runDraftJob } from "@/lib/agent/draft-jobs";
import { buildStreamMessages, parseDraftMarkdown } from "@/lib/agent/compose-draft";
import { agentModel, chatParams } from "@/lib/agent/model";
import { getUserSettings } from "@/lib/settings";

export const maxDuration = 300;

// Stream the AI writing the draft ticket, token by token, to the owner's brief
// page (the live "writing" animation). Persists the finished draft on
// completion; if the client disconnects mid-write, a background fallback does a
// guaranteed non-streaming write so the brief is never left unwritten.
//
// Clerk-session-authed and scoped to the owner's own brief (only the owner -
// who's present right after capture - triggers the model run; cost control).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, status, storage_prefix, ticket_body, ticket_url, filing_started_at, share_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return new Response("not found", { status: 404 });
  // Already written, already filed, or BEING FILED → nothing to stream.
  // Filing a capture straight from the extension also leaves it 'processing'
  // with no body; drafting over that run flipped the brief back to 'drafted'
  // and re-offered Export, which filed a second ticket. The filing claim is
  // what tells the two apart.
  if (briefPhase(brief) !== "writing") return new Response(null, { status: 204 });

  // Already being written in the background (the /draft route starts it the
  // moment the extension hands it over): wait for that run, then let the page
  // refresh onto the finished draft - never a second model run.
  const running = draftJob(id);
  if (running) {
    await Promise.race([running, new Promise((r) => setTimeout(r, 120_000))]);
    return new Response(null, { status: 204 });
  }

  const { ticketGuidance, role } = await getUserSettings(userId);
  const guidance = [role ? `The reporter's role: ${role}.` : "", ticketGuidance].filter(Boolean).join("\n");

  let input;
  try {
    ({ input } = await loadBriefInput(admin, brief.storage_prefix as string, {}));
  } catch {
    after(async () => {
      await runDraftJob(id, () => draftBriefById(userId, id));
    });
    return new Response(null, { status: 204 });
  }

  const { system, user } = buildStreamMessages(input, guidance);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = agentModel();
  const encoder = new TextEncoder();
  const shareId = (brief.share_id as string | null) || null;

  let persisted = false;
  const persist = async (md: string) => {
    if (persisted || !md.trim()) return;
    persisted = true;
    const { title, descriptionMarkdown } = parseDraftMarkdown(md);
    const patch: Record<string, unknown> = {
      status: "drafted",
      ticket_title: title || null,
      ticket_body: descriptionMarkdown || null,
      updated_at: new Date().toISOString(),
    };
    if (shareId) patch.share_id = shareId;
    // The row can move on during the ~20s write (an export or a direct filing
    // run starting). Never turn a filed/filing brief back into a draft.
    await admin
      .from("briefs")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .is("ticket_url", null)
      .is("filing_started_at", null);
  };

  // This write runs here, inline: a background one mustn't start alongside it.
  const release = holdDraftJob(id);
  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        const completion = await openai.chat.completions.create(
          { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: true, ...chatParams(model) },
          { signal: req.signal },
        );
        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
        await persist(full); // completed cleanly → persist the streamed result
      } catch {
        // Aborted (client left) or a model error - don't persist a partial; the
        // after() net below guarantees a write.
      } finally {
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  after(async () => {
    const { data } = await admin
      .from("briefs")
      .select("status, ticket_body, ticket_url, filing_started_at")
      .eq("id", id)
      .maybeSingle();
    if (data && briefPhase(data) === "writing") {
      await runDraftJob(id, () => draftBriefById(userId, id));
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
