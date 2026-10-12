import { cache } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";

/**
 * A Clerk user, fetched once per page render however many helpers ask: the
 * tracker context, ticket rules and Replay settings all read the same user,
 * and each read was its own round trip to Clerk. Outside a render (API
 * routes) React's cache doesn't dedupe, so a write followed by a read in one
 * request still sees the new data.
 */
export const getClerkUser = cache(async (userId: string) => {
  const client = await clerkClient();
  return client.users.getUser(userId);
});

/** The signed-in user (once per render), or null. Same data as currentUser(). */
export const getSignedInUser = cache(async () => {
  const { userId } = await auth();
  return userId ? getClerkUser(userId) : null;
});
