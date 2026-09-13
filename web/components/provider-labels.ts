// Provider display names for client components.
//
// lib/trackers/registry.ts is the source of truth, but it pulls in every
// adapter (and through them clerkClient and the Supabase admin client), so a
// "use client" component cannot import from it. This is the small, static slice
// the browser actually needs: a key and the name to print.

export type ProviderKey = "linear" | "jira" | "github";

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
};
