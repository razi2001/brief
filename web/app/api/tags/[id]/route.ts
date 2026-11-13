import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cleanTagName, isTagColor, isUuid, type TagColor } from "@/lib/tags";
import { deleteTag, updateTag, type WriteResult } from "@/lib/tags-server";

const answer = (result: WriteResult) => {
  if (result === "ok") return NextResponse.json({ ok: true });
  // A tag that belongs to someone else answers exactly like one that is gone.
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "exists") return NextResponse.json({ error: "exists" }, { status: 409 });
  return NextResponse.json({ error: "could not save" }, { status: 500 });
};

/** Rename or recolour one of your tags. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; color?: TagColor } = {};
  if (body.name !== undefined) {
    const name = cleanTagName(body.name);
    if (!name) return NextResponse.json({ error: "name" }, { status: 400 });
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (!isTagColor(body.color)) return NextResponse.json({ error: "color" }, { status: 400 });
    patch.color = body.color;
  }
  if (!isUuid(id) || (patch.name === undefined && patch.color === undefined)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  return answer(await updateTag(userId, id, patch));
}

/** Remove one of your tags. Its tickets stay. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return answer(await deleteTag(userId, id));
}
