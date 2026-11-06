import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanBody, cleanTitle } from "@/lib/requests";
import { createRequest } from "@/lib/requests-server";

// Clerk-session-authed, like /api/settings: proxy.ts protects it (it isn't on
// the public matcher) and the handler still reads the session itself.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = cleanTitle(body.title);
  if (!title) return NextResponse.json({ error: "title" }, { status: 400 });

  const result = await createRequest(userId, title, cleanBody(body.body));
  if (!result.ok) {
    return result.reason === "limit"
      ? NextResponse.json({ error: "limit" }, { status: 429 })
      : NextResponse.json({ error: result.message ?? "could not save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: result.id, createdAt: result.createdAt });
}
