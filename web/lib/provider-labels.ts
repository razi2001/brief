// Provider display words, for the server and the browser alike.
//
// lib/trackers/registry.ts pulls in every adapter (and through them clerkClient
// and the Supabase admin client), so a "use client" component cannot import
// it. This is the small, static slice both sides need: a key and the words to
// print. It imports nothing at runtime, so it stays safe to bundle.

import type { ProviderKey } from "@/lib/tracker";

export type { ProviderKey };

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  linear: "Linear",
  jira: "Jira",
  github: "GitHub",
  gitlab: "GitLab",
  azure: "Azure DevOps",
  clickup: "ClickUp",
  notion: "Notion",
  trello: "Trello",
  asana: "Asana",
  monday: "Monday",
};

/**
 * What each tracker calls the thing a user picks ("Pick your Azure DevOps
 * organization"). The one source for these words: the registry's error copy,
 * lib/workspaces.ts and the client components all read this map.
 */
export const WORKSPACE_NOUN: Record<ProviderKey, string> = {
  linear: "workspace",
  jira: "site",
  github: "organization",
  gitlab: "group",
  azure: "organization",
  clickup: "workspace",
  notion: "workspace",
  trello: "workspace",
  asana: "workspace",
  monday: "account",
};

/** The status of a tracker this deployment can't connect yet. */
export const NOT_AVAILABLE = "Not available yet";
