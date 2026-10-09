import { NextRequest } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { applyEdits, parseAssistantStream } from "@/lib/chat-stream";
import { chatParams, fastModel } from "@/lib/agent/model";

export const maxDuration = 120;

/**
 * The brief page's chat assistant: fast, streaming iteration on a DRAFT ticket.
 * The client sends the chat history plus the CURRENT document (including any
 * unsaved inline edits); the model streams back a short note and - when the
 * turn changes the ticket - TARGETED edits that the client applies to the doc
 * in place, block by block, as they arrive. A full <ticket> rewrite exists but
 * only for restructures. The route re-applies the same ops to the same base
 * doc (shared lib/chat-stream) and persists the result, so what the user saw
 * is exactly what's saved.
 */
const FORMAT_RULES = `You are Brief's ticket assistant. You help the reporter iterate on a bug-report ticket quickly.

ALWAYS answer in exactly this format - a note, then zero or more change operations:
<note>one or two short sentences replying to the user (plain text, no markdown)</note>

For changes, prefer TARGETED edits (one per change):
<edit><find>exact text copied VERBATIM from the current body</find><replace>the replacement text</replace></edit>

To change only the title:
<title>the new title</title>

ONLY for a full restructure where targeted edits can't express the change, output the complete ticket instead:
<ticket>
# <title>
<complete body markdown>
</ticket>

Rules:
- Prefer the SMALLEST targeted edits. Never rewrite the whole ticket when <edit> blocks can express the change.
- <find> must match the current body exactly (copy it verbatim, include enough surrounding lines to be unique). Keep it as short as uniqueness allows.
- To add content, <find> the neighboring text and repeat it in <replace> together with the addition.
- To delete content, use an empty <replace></replace>.
- If the user only asks a question, reply with the <note> alone - no operations.
- Body markdown: "##" section headings, "-" lists, \`inline code\`, fenced blocks for logs. No H1 in the body (the title is the H1).
- Never output anything outside the tags. Never wrap the answer in code fences.`;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!brief) return new Response("not found", { status: 404 });
  if (brief.status !== "drafted") return new Response("not a draft", { status: 409 });

  const payload = (await req.json().catch(() => ({}))) as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
    title?: string;
    body?: string;
  };
  const history = (payload.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") {
    return new Response("no message", { status: 400 });
  }
  const title = (payload.title ?? "").toString().slice(0, 300);
  const docBody = (payload.body ?? "").toString().slice(0, 24000);

  const system = `${FORMAT_RULES}\n\nThe current ticket:\n<ticket>\n# ${title}\n${docBody}\n</ticket>`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Iteration must feel instant - a fast model is the point here.
  const model = fastModel();
  const encoder = new TextEncoder();

  let persisted = false;
  const persist = async (full: string) => {
    if (persisted) return;
    // Recompute the final document with the SAME pure lib the client uses, so
    // the saved draft matches what streamed into the editor.
    const p = parseAssistantStream(full);
    let newTitle = title;
    let newBody = docBody;
    let changed = false;
    if (p.ticket && p.ticketComplete && p.ticket.body) {
      newTitle = p.ticket.title ?? title;
      newBody = p.ticket.body;
      changed = true;
    } else {
      if (p.edits.length) {
        const r = applyEdits(docBody, p.edits);
        if (r.applied > 0) {
          newBody = r.md;
          changed = true;
        }
      }
      if (p.title) {
        newTitle = p.title;
        changed = true;
      }
    }
    if (!changed || !newBody.trim()) return; // question-only turn: nothing to save
    persisted = true;
    await admin
      .from("briefs")
      .update({ ticket_title: newTitle || null, ticket_body: newBody, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);
  };

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      try {
        const completion = await openai.chat.completions.create(
          {
            model,
            temperature: 0.4,
            messages: [{ role: "system" as const, content: system }, ...history],
            stream: true,
            ...chatParams(model),
          },
          { signal: req.signal },
        );
        for await (const part of completion) {
          const delta = part.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            controller.enqueue(encoder.encode(delta));
          }
        }
        await persist(full);
      } catch {
        // Client left or the model errored - nothing is persisted for a partial
        // rewrite, so the draft stays exactly as the user last saw it.
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
