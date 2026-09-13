// Which Clerk strategy backs each Clerk-connected tracker.
//
// Clerk's BUILT-IN social connections (oauth_github, oauth_notion, …) have no
// configurable scopes - the field doesn't exist in the instance config schema -
// and on a development instance they use Clerk's shared OAuth apps, which
// request read-only profile data:
//
//     approved_scopes: read:user user:email
//
// That is enough to identify a user and nowhere near enough to file a ticket.
// Creating a GitHub issue needs `repo`; there is no way to ask a built-in
// connection for it.
//
// Clerk's CUSTOM OAuth connectors do expose `base_scopes`, so the fix is to
// register the provider as a custom connector (with your own OAuth app) and
// point Brief at it. That changes the strategy name from `oauth_github` to
// `oauth_custom_<slug>`, which both the browser (createExternalAccount) and the
// server (getUserOauthAccessToken) have to agree on - hence this one module,
// imported by both.
//
// Set NEXT_PUBLIC_<PROVIDER>_CLERK_STRATEGY to switch a provider over without a
// code change. Unset, everything keeps using the built-in connection.

import type { ProviderKey } from "./tracker";

/** The built-in Clerk strategy for each Clerk-connected tracker. */
const BUILT_IN: Partial<Record<ProviderKey, string>> = {
  linear: "oauth_linear",
  jira: "oauth_atlassian",
  github: "oauth_github",
};

/**
 * Env overrides must be statically analysable for Next to inline them into the
 * client bundle, so each one is spelled out rather than built from a template.
 */
const OVERRIDE: Partial<Record<ProviderKey, string | undefined>> = {
  linear: process.env.NEXT_PUBLIC_LINEAR_CLERK_STRATEGY,
  jira: process.env.NEXT_PUBLIC_JIRA_CLERK_STRATEGY,
  github: process.env.NEXT_PUBLIC_GITHUB_CLERK_STRATEGY,
};

/**
 * The strategy to use for this provider: the configured custom connector when
 * one is set, else Clerk's built-in connection.
 */
export function clerkStrategy(provider: ProviderKey): string {
  const override = (OVERRIDE[provider] ?? "").trim();
  return override || BUILT_IN[provider] || `oauth_${provider}`;
}

/**
 * Substring matched against an externalAccount's `provider` to decide whether
 * it belongs to this tracker. Derived from the strategy so a custom connector
 * ("oauth_custom_briefgh") matches its own accounts and not the built-in one.
 */
export function clerkMatch(provider: ProviderKey): string {
  return clerkStrategy(provider).replace(/^oauth_/, "");
}

/** True when this provider is going through a custom connector. */
export function isCustomConnector(provider: ProviderKey): boolean {
  return clerkStrategy(provider).startsWith("oauth_custom_");
}

/**
 * Scopes a tracker needs that its Clerk connection does not grant by default.
 *
 * Clerk's built-in connections have no scopes field in the instance config, and
 * their defaults are sized for SIGNING IN, not for doing work: a real GitHub
 * grant came back as
 *
 *     approved_scopes: read:user user:email
 *
 * which identifies a user and cannot create an issue. Clerk's client API takes
 * `additionalScopes` on createExternalAccount, which appends to the scope set
 * requested at connect time - so the extra permission can be asked for without
 * a custom connector, and therefore without the paid plan feature a custom
 * connector needs on a production instance.
 *
 * Only list what the tracker genuinely cannot work without. Every scope here is
 * shown to the user on the provider's consent screen.
 */
const EXTRA_SCOPES: Partial<Record<ProviderKey, string[]>> = {
  // Creating an issue is a write to the repository. `repo` is the narrowest
  // classic scope that covers it for private repos as well as public ones.
  github: ["repo"],
};

export function extraScopes(provider: ProviderKey): string[] | undefined {
  // A custom connector already declares base_scopes on the connection itself,
  // so asking again here would only duplicate them on the consent screen.
  if (isCustomConnector(provider)) return undefined;
  const scopes = EXTRA_SCOPES[provider];
  return scopes?.length ? scopes : undefined;
}
