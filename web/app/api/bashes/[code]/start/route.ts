import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { startBash } from "@/lib/bash-server";
import { track } from "@/lib/events";

/** Start your own time in an open quality competition (joining it first if you had not). */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await startBash(userId, code);
  if (result === "ok") {
    track(userId, "bash.joined");
    return NextResponse.json({ ok: true });
  }
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  // Not open yet, already closed, or full.
  if (result === "upcoming" || result === "ended" || result === "full") return NextResponse.json({ error: result }, { status: 409 });
  return NextResponse.json({ error: "could not start" }, { status: 500 });
}
