import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-server";
import { isRequestId, isStatus } from "@/lib/requests";
import { deleteRequest, setStatus } from "@/lib/requests-server";

/**
 * Delete one of your own requests; the owner may delete any. For everyone else
 * a request that isn't theirs is a 404, never a 403.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isRequestId(id)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await deleteRequest(userId, id, await isAdmin());
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "error") return NextResponse.json({ error: "could not delete" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * The owner sets a request's status. Everyone else gets 403: the status
 * control is only drawn for the owner, but the check lives here.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  if (!isRequestId(id) || !isStatus(body.status)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await setStatus(id, body.status);
  if (result === "missing") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (result === "error") return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
