import { NextRequest } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { createAdminSupabase } from "@/lib/supabase/server";

export const maxDuration = 120;

/**
 * The brief page's chat assistant: fast, streaming iteration on a DRAFT ticket.
 * The client sends the chat history plus the CURRENT document (including any
 * unsaved inline edits); the model streams back a short note and - when the
 * request is an edit - the complete revised ticket, which the client renders
 * into the editor live, token by token. The route persists the final revision
 * so the draft is never left behind what the user saw.
 *
 * Response format (raw text stream, parsed by the client):
 *   <note>one or two short sentences</note>
 *   <ticket>
 *   # Title
 *   body markdown…
 *   </ticket>          ← omitted entirely when no change is needed
 */
const FORMAT_RULES = `You are Brief's ticket assistant. You help the reporter iterate on a bug-report ticket quickly.

ALWAYS answer in exactly this format:
<note>one or two short sentences replying to the user (plain text, no markdown)</note>
<ticket>
# <the ticket title>
<the complete ticket body in clean markdown>
</ticket>

Rules:
- If the user asks for ANY change to the ticket (content, tone, structure, length, language), output the COMPLETE revised ticket inside <ticket>. Preserve everything they didn't ask to change verbatim.
- If the user only asks a question (no change wanted), omit the <ticket> block entirely.
- Body markdown: "##" section headings, "-" lists, \`inline code\`, fenced blocks for logs. No H1 in the body (the title is the H1).
- Never output anything outside the tags. Never wrap the whole answer in code fences.`;

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
  // Iteration must feel instant - a fast, cheap model is the point here.
  const model = process.env.AGENT_FAST_MODEL || "gpt-4o-mini";
  const encoder = new TextEncoder();

  let persisted = false;
  const persist = async (full: string) => {
    if (persisted) return;
    const m = /<ticket>\s*([\s\S]*?)\s*<\/ticket>/.exec(full);
    if (!m) return; // question-only turn: nothing to save
    persisted = true;
    const md = m[1].trim();
    const t = /^#\s+(.+)$/m.exec(md);
    const newTitle = t ? t[1].trim() : title;
    const newBody = t ? md.slice(t.index + t[0].length).trim() : md;
    if (!newBody) return;
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
