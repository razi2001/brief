import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Next.js 16 renamed the `middleware` file convention to `proxy`. Clerk's
// clerkMiddleware() runs from this file on Next 16 (it detects middleware|proxy).
// /api/briefs* and /api/me are public to Clerk: the extension authenticates
// them via a bearer token, not a Clerk session (without this, /api/me would
// 307 to /sign-in and the popup could never check tracker status).
const isPublic = createRouteMatcher(["/sign-in(.*)", "/api/briefs(.*)", "/api/me"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ico|webp|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)",
  ],
};
