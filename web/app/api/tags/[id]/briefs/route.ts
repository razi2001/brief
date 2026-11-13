import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanBriefIds, isUuid } from "@/lib/tags";
import { setBriefsTag } from "@/lib/tags-server";

/** Put one of your tags on some of your briefs (`on: true`) or take it off. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const briefIds = cleanBriefIds(body.briefIds);
  if (!isUuid(id) || typeof body.on !== "boolean" || briefIds.length === 0) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await setBriefsTag(userId, id, briefIds, body.on);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ error: "could not save" }, { status: 500 });
}
