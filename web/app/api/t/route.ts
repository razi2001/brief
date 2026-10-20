import { NextRequest } from "next/server";
import { track } from "@/lib/events";
import { parseSiteEvent } from "@/lib/site-events";

/**
 * get-brief.app's cookieless beacon (navigator.sendBeacon, text/plain, so no
 * preflight). Always 204: a refused event tells the sender nothing.
 */
export async function POST(req: NextRequest) {
  const event = parseSiteEvent(await req.text().catch(() => ""), {
    origin: req.headers.get("origin"),
    ua: req.headers.get("user-agent") ?? "",
    dev: process.env.NODE_ENV !== "production",
  });
  if (event) track(null, event.name, event.props);
  return new Response(null, { status: 204 });
}
