// Why a tracker connect failed, in words someone can act on.
//
// The connect callback records each failure in a cookie only the server sets
// (lib/connect-flow), and /api/me/connections turns it into a message through
// explainFailure. The URL only ever carries a code, so text from a provider
// reaches the page through that cookie alone, never through a query string
// anyone could write.
//
// No server imports: the browser reads the copy for each code from here too.

import { NOT_AVAILABLE, PROVIDER_LABELS, WORKSPACE_NOUN, type ProviderKey } from "@/lib/provider-labels";

/** Why a connect flow ended without a connection: what `?error=` carries. */
export type ConnectError = "cancelled" | "failed" | "unavailable" | "no_org" | "no_workspace";

const CONNECT_ERRORS: readonly string[] = ["cancelled", "failed", "unavailable", "no_org", "no_workspace"];

/**
 * One failed connect, as the callback records it.
 *
 *  - `reason`  a short machine code: the provider's (`invalid_scope`,
 *              `AADSTS650052`, `OAUTH_010`, a status such as `vssps 401`) or
 *              one of Brief's own (BRIEF_REASON)
 *  - `detail`  the provider's own description, cleaned by cleanDetail
 */
export type ConnectFailure = {
  provider: ProviderKey;
  code: ConnectError;
  reason?: string;
  detail?: string;
};

export type Explained = { message: string; detail?: string };

export const COULDNT_CONNECT = "Couldn't connect";

/**
 * Brief's own reasons. A provider's reason goes through cleanReason, which
 * drops the colon, so no provider can spell one of these.
 */
export const BRIEF_REASON = {
  /** The state or the flow cookie was refused: expired, or another tab's. */
  state: "brief:state",
  /** The token endpoint could not be reached, or its reply could not be read. */
  unreachable: "brief:unreachable",
  /** The new token could not list its workspaces. */
  list: "brief:list",
  /** The previous tracker could not be removed. */
  switch: "brief:switch",
  /** The connection could not be stored. */
  save: "brief:save",
} as const;

const BRIEF_REASONS: ReadonlySet<string> = new Set(Object.values(BRIEF_REASON));

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

const DETAIL_MAX = 300;
const REASON_MAX = 64;

/**
 * Anything but letters, marks, numbers, punctuation, symbols and a plain
 * space: control characters, line breaks, and format characters such as bidi
 * overrides, which can make a line read other than it is.
 */
const UNPRINTABLE = /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/gu;

/**
 * A run long enough and plain enough to be a token or a secret. A GUID (36
 * characters) is shorter, and Entra's descriptions are full of those.
 */
const TOKEN_RUN = "[A-Za-z0-9_~+=.-]{40,}";
const TOKEN_LIKE = new RegExp(TOKEN_RUN, "g");
const HAS_TOKEN_LIKE = new RegExp(TOKEN_RUN);

function redact(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let out = text;
  // Short values could match ordinary words, and nothing secret is that short.
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  return out;
}

/**
 * A provider's description, fit to show: the known secrets of this flow and
 * anything shaped like a token taken out, printable characters only, Entra's
 * trace and correlation ids (noise to the user) dropped, and capped.
 */
export function cleanDetail(
  raw: unknown,
  secrets: ReadonlyArray<string | null | undefined> = [],
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = redact(raw, secrets)
    .replace(UNPRINTABLE, " ")
    .replace(/\s*Trace ID:.*$/i, "")
    .replace(TOKEN_LIKE, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1).trimEnd()}…` : text;
}

/** A provider's error code: word characters, dots, dashes and spaces, short, never token-shaped. */
export function cleanReason(
  raw: unknown,
  secrets: ReadonlyArray<string | null | undefined> = [],
): string | undefined {
  // A code that carries one of this flow's secrets is no code at all.
  if (typeof raw !== "string" || redact(raw, secrets) !== raw) return undefined;
  const text = raw
    .replace(/[^A-Za-z0-9_. -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > REASON_MAX || HAS_TOKEN_LIKE.test(text)) return undefined;
  return text;
}

/**
 * A failure from a provider's error code and description. Entra's AADSTS
 * number is the reason when its description has one: `invalid_client` alone
 * covers a missing service principal and a bad client secret alike.
 */
export function providerFailure(
  provider: ProviderKey,
  code: ConnectError,
  error: unknown,
  description: unknown,
  secrets: ReadonlyArray<string | null | undefined> = [],
): ConnectFailure {
  const detail = cleanDetail(description, secrets);
  const reason = detail?.match(/\bAADSTS\d+\b/)?.[0] ?? cleanReason(error, secrets);
  return { provider, code, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) };
}

/**
 * The error code and description in a token endpoint's refusal, by the names
 * each provider uses: `error` and `error_description` (OAuth, GitHub's
 * error-in-a-200 too), ClickUp's `ECODE` and `err`, Asana's
 * `errors[0].message`, and a nested `error: { code, message }`. Only these
 * fields are read, so nothing else in the reply can end up shown.
 */
export function readTokenRefusal(body: unknown): { error?: string; description?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const o = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  const nested = obj(o.error);
  const first = Array.isArray(o.errors) ? obj(o.errors[0]) : undefined;
  return {
    error: str(o.error) ?? str(nested?.code) ?? str(o.ECODE) ?? str(o.code),
    description: str(o.error_description) ?? str(nested?.message) ?? str(o.err) ?? str(first?.message) ?? str(o.message),
  };
}

/**
 * A failure read back from the cookie, checked field by field. Null when
 * anything is off.
 */
export function asFailure(value: unknown): ConnectFailure | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.provider !== "string" || !Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, v.provider)) {
    return null;
  }
  if (typeof v.code !== "string" || !CONNECT_ERRORS.includes(v.code)) return null;
  const failure: ConnectFailure = { provider: v.provider as ProviderKey, code: v.code as ConnectError };
  if (v.reason !== undefined) {
    const ok = typeof v.reason === "string" && (BRIEF_REASONS.has(v.reason) || cleanReason(v.reason) === v.reason);
    if (!ok) return null;
    failure.reason = v.reason as string;
  }
  if (v.detail !== undefined) {
    if (typeof v.detail !== "string" || cleanDetail(v.detail) !== v.detail) return null;
    failure.detail = v.detail;
  }
  return failure;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/**
 * The copy for each failure code, all a page shows when there is nothing
 * more to say. An unknown code reads as a plain failure: a query string is
 * never shown.
 */
export function codeCopy(code: string, provider: ProviderKey): string {
  const name = PROVIDER_LABELS[provider];
  switch (code) {
    case "cancelled":
      return "Connection cancelled";
    case "unavailable":
      return NOT_AVAILABLE;
    case "no_org":
      return `No ${name} organization on this account`;
    case "no_workspace":
      return `No ${name} ${WORKSPACE_NOUN[provider]} on this account`;
    default:
      return COULDNT_CONNECT;
  }
}

const EXPIRED = "The sign-in expired. Try again.";
const appSetup = (name: string) => `Brief's ${name} app isn't set up correctly.`;
const missingPermission = (name: string) => `Brief's ${name} app is missing a permission.`;
const trouble = (name: string) => `${name} is having trouble. Try again in a minute.`;

function cannotList(provider: ProviderKey): string {
  const noun = WORKSPACE_NOUN[provider];
  // A monday token belongs to one account.
  return `Couldn't read your ${PROVIDER_LABELS[provider]} ${provider === "monday" ? noun : `${noun}s`}.`;
}

const ADMIN_APPROVAL = "Your Microsoft admin needs to approve Brief first.";
const WORK_ACCOUNT = "Use a work or school Microsoft account.";
const AZURE_APP = "Brief's Azure DevOps app isn't set up correctly. Contact Brief support.";

/** Entra's own numbers, which say far more than its OAuth codes. */
const ENTRA: Record<string, string> = {
  // The tenant has no service principal for Azure DevOps: nobody in it has
  // ever opened Azure DevOps.
  AADSTS650052:
    "Azure DevOps isn't set up on this Microsoft organization yet. Create an organization at dev.azure.com, then connect again.",
  AADSTS65001: ADMIN_APPROVAL,
  AADSTS90094: ADMIN_APPROVAL,
  AADSTS90008: ADMIN_APPROVAL,
  AADSTS50020: WORK_ACCOUNT,
  AADSTS50194: WORK_ACCOUNT,
  // Redirect URI mismatch, app not in the directory, bad or expired secret.
  AADSTS50011: AZURE_APP,
  AADSTS700016: AZURE_APP,
  AADSTS7000215: AZURE_APP,
  AADSTS7000222: AZURE_APP,
};

/** The standard OAuth error codes, from the authorize redirect or the token endpoint. */
function oauthMessage(reason: string, name: string): string | undefined {
  switch (reason) {
    case "access_denied":
      return "Connection cancelled";
    case "invalid_scope":
      return missingPermission(name);
    case "invalid_client":
    case "unauthorized_client":
    case "redirect_uri_mismatch":
      return appSetup(name);
    case "invalid_grant":
      return EXPIRED;
    case "temporarily_unavailable":
    case "server_error":
      return trouble(name);
    default:
      return undefined;
  }
}

/** What a provider's own codes and wording mean, where it has some. */
function providerMessage(f: ConnectFailure, reason: string, name: string): string | undefined {
  const detail = f.detail ?? "";
  switch (f.provider) {
    case "azure": {
      const entra = ENTRA[reason.toUpperCase()];
      if (entra) return entra;
      if (reason === "consent_required") return ADMIN_APPROVAL;
      if (/live\.com|personal (microsoft )?account/i.test(detail)) return WORK_ACCOUNT;
      if (/^vssps\b/.test(reason)) return cannotList("azure");
      return undefined;
    }
    case "github":
      if (reason === "application_suspended") return "Brief's GitHub app is suspended. Contact Brief support.";
      if (reason === "bad_verification_code") return EXPIRED;
      if (reason === "incorrect_client_credentials") return appSetup(name);
      return undefined;
    case "clickup":
      if (!/^oauth_\d+$/.test(reason)) return undefined;
      // OAUTH_010 and its siblings that name the client are about Brief's app;
      // one about the code is an expired sign-in.
      if (reason === "oauth_010" || /client|secret|redirect/i.test(detail)) return appSetup(name);
      if (/code/i.test(detail)) return EXPIRED;
      return undefined;
    case "asana":
      return reason === "forbidden_scopes" ? missingPermission(name) : undefined;
    case "monday":
      return /\binstall/i.test(detail) ? "A Monday admin needs to install Brief first." : undefined;
    default:
      return undefined;
  }
}

function briefMessage(reason: string, provider: ProviderKey): string | undefined {
  switch (reason) {
    case BRIEF_REASON.state:
      return "The connection expired or started in another tab. Try again.";
    case BRIEF_REASON.unreachable:
      return trouble(PROVIDER_LABELS[provider]);
    case BRIEF_REASON.list:
      return cannotList(provider);
    case BRIEF_REASON.switch:
      return "Couldn't switch from your current tracker. Try again.";
    case BRIEF_REASON.save:
      return "Couldn't save the connection. Try again.";
    default:
      return undefined;
  }
}

/** `<Provider>: <reason> <description>`, the reason left out when the description starts with it. */
function detailFor(f: ConnectFailure, name: string): string | undefined {
  const reason = f.reason && !BRIEF_REASONS.has(f.reason) ? f.reason : "";
  const description = f.detail ?? "";
  if (!reason && !description) return undefined;
  const repeats = reason && description.toLowerCase().startsWith(reason.toLowerCase());
  const body = repeats ? description : `${reason} ${description}`;
  return `${name}: ${body.trim()}`;
}

/**
 * A short, plain message for a failed connect, and the provider's own words
 * beneath it. A reason Brief knows gets a message that says what to do; any
 * other falls back to the copy for its code, with the provider's text as the
 * detail.
 */
export function explainFailure(f: ConnectFailure): Explained {
  const name = PROVIDER_LABELS[f.provider];
  const raw = f.reason ?? "";
  const reason = BRIEF_REASONS.has(raw) ? raw : raw.toLowerCase();
  const message =
    briefMessage(reason, f.provider) ??
    providerMessage(f, reason, name) ??
    oauthMessage(reason, name) ??
    (/^http 5\d\d$/.test(reason) ? trouble(name) : undefined) ??
    codeCopy(f.code, f.provider);
  const detail = detailFor(f, name);
  return detail ? { message, detail } : { message };
}
