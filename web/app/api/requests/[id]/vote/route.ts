import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isRequestId } from "@/lib/requests";
import { setVote } from "@/lib/requests-server";

/** Body `{ voted: boolean }`: put the caller's upvote on or take it off. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { voted?: unknown };
  if (!isRequestId(id) || typeof body.voted !== "boolean") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await setVote(userId, id, body.voted);
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "error") return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
