import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanTagName, isTagColor } from "@/lib/tags";
import { createTag } from "@/lib/tags-server";

// Clerk-session-authed, like /api/requests: proxy.ts protects it and the
// handler still reads the session itself.
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanTagName(body.name);
  if (!name) return NextResponse.json({ error: "name" }, { status: 400 });

  const result = await createTag(userId, name, isTagColor(body.color) ? body.color : undefined);
  if (result.ok) return NextResponse.json({ ok: true, tag: result.tag });
  if (result.reason === "exists") return NextResponse.json({ error: "exists" }, { status: 409 });
  if (result.reason === "limit") return NextResponse.json({ error: "limit" }, { status: 429 });
  return NextResponse.json({ error: "could not save" }, { status: 500 });
}
