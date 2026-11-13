import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { joinBash } from "@/lib/bash-server";
import { track } from "@/lib/events";

/** Join a bug bash that is upcoming or open. Your own time starts later, with Start. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await joinBash(userId, code);
  if (result === "ok") {
    track(userId, "bash.joined");
    return NextResponse.json({ ok: true });
  }
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "ended") return NextResponse.json({ error: "ended" }, { status: 409 });
  if (result === "full") return NextResponse.json({ error: "full" }, { status: 409 });
  return NextResponse.json({ error: "could not join" }, { status: 500 });
}
