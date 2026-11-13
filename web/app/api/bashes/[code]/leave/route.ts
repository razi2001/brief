import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { leaveBash } from "@/lib/bash-server";

/** Leave a bug bash you joined. Once your own time has started you stay on its board. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await ctx.params;
  if (!isBashCode(code)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await leaveBash(userId, code);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "started") return NextResponse.json({ error: "started" }, { status: 409 });
  return NextResponse.json({ error: "could not leave" }, { status: 500 });
}
