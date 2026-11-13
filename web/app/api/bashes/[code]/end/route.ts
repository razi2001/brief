import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { endBash } from "@/lib/bash-server";

/** End a bash now. Only whoever started it may; for anyone else it is a 404. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await endBash(userId, code);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ error: "could not end" }, { status: 500 });
}
