"use client";

import dynamic from "next/dynamic";

/**
 * Client-only mount for <Integrations/>. Integrations is inherently a browser
 * component - it uses Clerk's useUser() and the client OAuth flow to connect
 * trackers. Server-rendering it throws "useUser can only be used within
 * <ClerkProvider>" (Clerk's client context isn't established during SSR), so we
 * load it with ssr:false. This matches its original behavior, where it only ever
 * rendered client-side behind the Connections tab.
 */
const Integrations = dynamic(() => import("./Integrations"), { ssr: false });

export default function IntegrationsClient() {
  return <Integrations />;
}
