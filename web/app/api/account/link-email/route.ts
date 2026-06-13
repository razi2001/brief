import { NextResponse, type NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * Adopt an OAuth provider's email address onto the signed-in user, so a
 * tracker account with a DIFFERENT email can be connected. Clerk refuses to
 * link an external account whose email doesn't match one of the user's
 * emails; after a failed attempt the pending external-account record carries
 * the provider's email - we add that email (marked verified: the provider
 * authenticated it) and the retried Connect then links cleanly.
 *
 * Security: only emails that appear on one of the user's OWN external-account
 * records are accepted - this can't be used to claim an arbitrary address.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}) as { email?: string });
  const email = (body?.email ?? "").toString().trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "missing email" }, { status: 400 });

  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  const fromProvider = user.externalAccounts.some(
    (a) => (a.emailAddress ?? "").toLowerCase() === email,
  );
  if (!fromProvider) {
    return NextResponse.json({ error: "email_not_from_provider" }, { status: 400 });
  }

  const already = user.emailAddresses.some((e) => e.emailAddress.toLowerCase() === email);
  if (!already) {
    await client.emailAddresses.createEmailAddress({
      userId,
      emailAddress: email,
      verified: true,
      primary: false,
    });
  }

  return NextResponse.json({ ok: true });
}
