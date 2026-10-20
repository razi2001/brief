import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { parseClientEvent, track } from "@/lib/events";

/**
 * Page views, onboarding steps and in-app demo clicks from a signed-in
 * browser (components/usage). sendBeacon posts text/plain; req.json() parses
 * it all the same.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });
  const event = parseClientEvent(await req.json().catch(() => null));
  if (!event) return new Response(null, { status: 400 });
  track(userId, event.name, event.props);
  return new Response(null, { status: 204 });
}
