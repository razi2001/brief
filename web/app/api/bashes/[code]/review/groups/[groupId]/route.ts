import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isBashCode } from "@/lib/bash";
import { isUuid } from "@/lib/tags";
import { cleanGroupTitle } from "@/lib/bash-review";
import { renameGroup } from "@/lib/bash-review-server";

/** Change the title a group's ticket will carry. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string; groupId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code, groupId } = await ctx.params;
  if (!isBashCode(code) || !isUuid(groupId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = cleanGroupTitle(body.title);
  if (!title) return NextResponse.json({ error: "title" }, { status: 400 });

  const result = await renameGroup(code, userId, groupId, title);
  if (result === "ok") return NextResponse.json({ ok: true });
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "running" || result === "locked") return NextResponse.json({ error: result }, { status: 409 });
  return NextResponse.json({ error: "could not save" }, { status: 500 });
}
