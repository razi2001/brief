import { NextRequest } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { processBriefById } from "@/lib/agent/run-processing";
import { corsPreflight, jsonCors } from "@/lib/cors";

export const maxDuration = 300;

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return jsonCors({ error: "unauthorized" }, { status: 401 });

  const r = await processBriefById(userId, id);
  return r.ok ? jsonCors(r.result) : jsonCors({ error: r.error }, { status: r.status });
}
