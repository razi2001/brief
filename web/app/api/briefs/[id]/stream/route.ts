import { NextRequest, after } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { loadBriefInput, draftBriefById } from "@/lib/agent/run-processing";
import { buildStreamMessages, parseDraftMarkdown } from "@/lib/agent/compose-draft";
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
    .select("id, status, storage_prefix, ticket_body, share_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return new Response("not found", { status: 404 });
  // Already written, or not in a writing state → nothing to stream.
  if (brief.ticket_body || (brief.status !== "processing" && brief.status !== "uploaded")) {
    return new Response(null, { status: 204 });
  }

  const { ticketGuidance, role } = await getUserSettings(userId);
  const guidance = [role ? `The reporter's role: ${role}.` : "", ticketGuidance].filter(Boolean).join("\n");

  let input;
  try {
    ({ input } = await loadBriefInput(admin, brief.storage_prefix as string, {}));
  } catch {
    after(async () => {
      await draftBriefById(userId, id).catch(() => {});
    });
    return new Response(null, { status: 204 });
  }

  const { system, user } = buildStreamMessages(input, guidance);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.AGENT_MODEL || "gpt-4o";
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
    await admin.from("briefs").update(patch).eq("id", id).eq("user_id", userId);
  };

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        const completion = await openai.chat.completions.create(
          { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: true },
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
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  after(async () => {
    const { data } = await admin.from("briefs").select("status, ticket_body").eq("id", id).maybeSingle();
    if (data && !data.ticket_body && (data.status === "processing" || data.status === "uploaded")) {
      await draftBriefById(userId, id).catch(() => {});
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
