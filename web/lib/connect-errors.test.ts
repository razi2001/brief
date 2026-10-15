import { describe, expect, it } from "vitest";
import {
  BRIEF_REASON,
  asFailure,
  cleanDetail,
  cleanReason,
  codeCopy,
  explainFailure,
  providerFailure,
  readTokenRefusal,
  type ConnectFailure,
} from "@/lib/connect-errors";
import type { ProviderKey } from "@/lib/provider-labels";

/** The description Entra sent back to a user whose tenant had never used Azure DevOps. */
const AADSTS650052 =
  "AADSTS650052: The app is trying to access a service '499b84ac-1321-427f-aa17-267ca6975798'(Azure DevOps) " +
  "that your organization 'a1b2c3d4-0000-4000-8000-000000000000' lacks a service principal for. Contact your IT " +
  "Admin to review the configuration of your service subscriptions or consent to the application in order to " +
  "create the required service principal.\r\nTrace ID: 0f0e0d0c-1111-2222-3333-444455556666\r\nCorrelation ID: " +
  "9a8b7c6d-1111-2222-3333-444455556666\r\nTimestamp: 2026-10-14 09:12:44Z";

const failure = (provider: ProviderKey, reason?: string, detail?: string, code: ConnectFailure["code"] = "failed") =>
  ({ provider, code, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) }) as ConnectFailure;

const ADMIN = "Your Microsoft admin needs to approve Brief first.";
const WORK = "Use a work or school Microsoft account.";
const AZURE_APP = "Brief's Azure DevOps app isn't set up correctly. Contact Brief support.";
const EXPIRED = "The sign-in expired. Try again.";

describe("explainFailure", () => {
  it.each([
    // Entra
    [
      failure("azure", "AADSTS650052"),
      "Azure DevOps isn't set up on this Microsoft organization yet. Create an organization at dev.azure.com, then connect again.",
    ],
    [failure("azure", "AADSTS65001"), ADMIN],
    [failure("azure", "consent_required"), ADMIN],
    [failure("azure", "AADSTS90094"), ADMIN],
    [failure("azure", "AADSTS90008"), ADMIN],
    [failure("azure", "AADSTS50020"), WORK],
    [failure("azure", "AADSTS50194"), WORK],
    [failure("azure", "invalid_request", "The account is a personal Microsoft account."), WORK],
    [failure("azure", "AADSTS50011"), AZURE_APP],
    [failure("azure", "AADSTS700016"), AZURE_APP],
    [failure("azure", "AADSTS7000215"), AZURE_APP],
    [failure("azure", "AADSTS7000222"), AZURE_APP],
    [failure("azure", "vssps 401"), "Couldn't read your Azure DevOps organizations."],
    [failure("azure", BRIEF_REASON.list), "Couldn't read your Azure DevOps organizations."],
    // Any provider, by the standard OAuth codes
    [failure("gitlab", "access_denied", undefined, "cancelled"), "Connection cancelled"],
    [failure("gitlab", "invalid_scope"), "Brief's GitLab app is missing a permission."],
    [failure("linear", "invalid_client"), "Brief's Linear app isn't set up correctly."],
    [failure("jira", "unauthorized_client"), "Brief's Jira app isn't set up correctly."],
    [failure("notion", "redirect_uri_mismatch"), "Brief's Notion app isn't set up correctly."],
    [failure("monday", "invalid_grant"), EXPIRED],
    [failure("asana", "temporarily_unavailable"), "Asana is having trouble. Try again in a minute."],
    [failure("clickup", "server_error"), "ClickUp is having trouble. Try again in a minute."],
    [failure("notion", "HTTP 503"), "Notion is having trouble. Try again in a minute."],
    // GitHub
    [failure("github", "application_suspended"), "Brief's GitHub app is suspended. Contact Brief support."],
    [failure("github", "bad_verification_code"), EXPIRED],
    [failure("github", "incorrect_client_credentials"), "Brief's GitHub app isn't set up correctly."],
    // ClickUp
    [failure("clickup", "OAUTH_010"), "Brief's ClickUp app isn't set up correctly."],
    [failure("clickup", "OAUTH_011", "Client secret invalid"), "Brief's ClickUp app isn't set up correctly."],
    [failure("clickup", "OAUTH_014", "Code expired"), EXPIRED],
    // Asana
    [failure("asana", "forbidden_scopes"), "Brief's Asana app is missing a permission."],
    // monday
    [
      failure("monday", "access_denied", "An admin must install this app on the account first.", "cancelled"),
      "A Monday admin needs to install Brief first.",
    ],
    // Brief's own
    [failure("asana", BRIEF_REASON.state), "The connection expired or started in another tab. Try again."],
    [failure("gitlab", BRIEF_REASON.unreachable), "GitLab is having trouble. Try again in a minute."],
    [failure("github", BRIEF_REASON.list), "Couldn't read your GitHub organizations."],
    [failure("monday", BRIEF_REASON.list), "Couldn't read your Monday account."],
    [failure("trello", BRIEF_REASON.switch), "Couldn't switch from your current tracker. Try again."],
    [failure("linear", BRIEF_REASON.save), "Couldn't save the connection. Try again."],
  ])("explains %j", (f, message) => {
    expect(explainFailure(f).message).toBe(message);
  });

  it("reads a provider's reason whatever its case", () => {
    expect(explainFailure(failure("azure", "aadsts650052")).message).toMatch(/^Azure DevOps isn't set up/);
    expect(explainFailure(failure("gitlab", "INVALID_SCOPE")).message).toBe("Brief's GitLab app is missing a permission.");
  });

  it("falls back to the code's copy for a reason it doesn't know, with the provider's words as the detail", () => {
    expect(explainFailure(failure("gitlab", "invalid_request", "The redirect URI included is not valid."))).toEqual({
      message: "Couldn't connect",
      detail: "GitLab: invalid_request The redirect URI included is not valid.",
    });
    expect(explainFailure(failure("azure", undefined, undefined, "no_org"))).toEqual({
      message: "No Azure DevOps organization on this account",
    });
    expect(explainFailure(failure("jira", "weird_thing", undefined, "no_workspace"))).toEqual({
      message: "No Jira site on this account",
      detail: "Jira: weird_thing",
    });
  });

  it("gives a provider-specific reason no meaning for another provider", () => {
    expect(explainFailure(failure("gitlab", "AADSTS650052")).message).toBe("Couldn't connect");
    expect(explainFailure(failure("notion", "forbidden_scopes")).message).toBe("Couldn't connect");
    expect(explainFailure(failure("linear", "vssps 401")).message).toBe("Couldn't connect");
  });

  it("does not repeat a reason the description starts with", () => {
    const f = providerFailure("azure", "failed", "invalid_client", AADSTS650052);
    const { message, detail } = explainFailure(f);
    expect(message).toMatch(/^Azure DevOps isn't set up on this Microsoft organization yet/);
    expect(detail).toMatch(/^Azure DevOps: AADSTS650052: The app is trying to access a service/);
    expect(detail?.match(/AADSTS650052/g)).toHaveLength(1);
  });

  it("puts the status in the detail when the Azure DevOps organizations can't be read", () => {
    expect(explainFailure(failure("azure", "vssps 401"))).toEqual({
      message: "Couldn't read your Azure DevOps organizations.",
      detail: "Azure DevOps: vssps 401",
    });
  });

  it("gives Brief's own reasons no detail", () => {
    for (const reason of Object.values(BRIEF_REASON)) {
      expect(explainFailure(failure("asana", reason)).detail).toBeUndefined();
    }
  });

  it("has no detail when the provider said nothing", () => {
    expect(explainFailure(failure("trello", undefined, undefined, "cancelled"))).toEqual({
      message: "Connection cancelled",
    });
  });

  it("writes no em or en dash in any message", () => {
    const reasons = [
      "AADSTS650052", "AADSTS65001", "AADSTS50020", "AADSTS50011", "access_denied", "invalid_scope",
      "invalid_client", "invalid_grant", "server_error", "application_suspended", "OAUTH_010",
      "forbidden_scopes", "HTTP 500", ...Object.values(BRIEF_REASON),
    ];
    const providers: ProviderKey[] = ["linear", "jira", "github", "gitlab", "azure", "clickup", "notion", "trello", "asana", "monday"];
    for (const provider of providers) {
      for (const reason of reasons) {
        expect(explainFailure(failure(provider, reason, "install")).message).not.toMatch(/[\u2013\u2014]/);
      }
      for (const code of ["cancelled", "failed", "unavailable", "no_org", "no_workspace"]) {
        expect(codeCopy(code, provider)).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});

describe("codeCopy", () => {
  it.each([
    ["cancelled", "asana", "Connection cancelled"],
    ["unavailable", "monday", "Not available yet"],
    ["no_org", "azure", "No Azure DevOps organization on this account"],
    ["no_workspace", "jira", "No Jira site on this account"],
    ["failed", "trello", "Couldn't connect"],
    ["Visit evil.example", "trello", "Couldn't connect"],
  ] as const)("reads %s for %s as %j", (code, provider, copy) => {
    expect(codeCopy(code, provider)).toBe(copy);
  });
});

describe("providerFailure", () => {
  it("takes Entra's AADSTS number as the reason, and its description without the trace ids", () => {
    const f = providerFailure("azure", "failed", "invalid_client", AADSTS650052);
    expect(f.reason).toBe("AADSTS650052");
    expect(f.detail).toMatch(/^AADSTS650052: The app is trying/);
    expect(f.detail).not.toMatch(/Trace ID|Correlation ID|Timestamp/);
    expect(f.detail!.length).toBeLessThanOrEqual(300);
  });

  it("keeps the OAuth code as the reason when there is no AADSTS number", () => {
    expect(providerFailure("gitlab", "failed", "invalid_scope", "The requested scope is invalid.")).toEqual({
      provider: "gitlab",
      code: "failed",
      reason: "invalid_scope",
      detail: "The requested scope is invalid.",
    });
  });

  it("takes this flow's code, verifier and secret out of the description, and never keeps them as the reason", () => {
    const secrets = ["the-auth-code-123", "verifier-value-abc", "client-secret-xyz"];
    const f = providerFailure(
      "notion",
      "failed",
      "the-auth-code-123",
      "Code the-auth-code-123 with verifier-value-abc and client-secret-xyz was refused.",
      secrets,
    );
    expect(f.reason).toBeUndefined();
    expect(f.detail).toBe("Code [redacted] with [redacted] and [redacted] was refused.");
  });

  it("takes out anything shaped like a token, but keeps GUIDs", () => {
    const token = "gho_" + "a".repeat(40);
    const f = providerFailure("github", "failed", "bad", `Token ${token} for app 499b84ac-1321-427f-aa17-267ca6975798.`);
    expect(f.detail).toBe("Token [redacted] for app 499b84ac-1321-427f-aa17-267ca6975798.");
  });
});

describe("cleanDetail", () => {
  it("keeps printable characters only, collapsing line breaks and dropping bidi overrides", () => {
    expect(cleanDetail("Bad\r\n\tthing \u202Eevil\u202C here\u0000")).toBe("Bad thing evil here");
  });

  it("keeps accented letters", () => {
    expect(cleanDetail("Accès refusé")).toBe("Accès refusé");
  });

  it("caps at 300 characters", () => {
    const out = cleanDetail("word ".repeat(200))!;
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.endsWith("…")).toBe(true);
  });

  it("reads anything but a non-empty string as nothing", () => {
    expect(cleanDetail(undefined)).toBeUndefined();
    expect(cleanDetail(42)).toBeUndefined();
    expect(cleanDetail("   ")).toBeUndefined();
  });

  it("is stable on its own output, so the cookie's detail reads back the same", () => {
    const once = cleanDetail(AADSTS650052)!;
    expect(cleanDetail(once)).toBe(once);
  });
});

describe("cleanReason", () => {
  it("keeps a short code, and drops anything else", () => {
    expect(cleanReason("invalid_scope")).toBe("invalid_scope");
    expect(cleanReason("vssps 401")).toBe("vssps 401");
    expect(cleanReason("<script>x</script>")).toBe("scriptxscript");
    expect(cleanReason("x".repeat(65))).toBeUndefined();
    expect(cleanReason("a".repeat(45))).toBeUndefined();
    expect(cleanReason(null)).toBeUndefined();
  });
});

describe("readTokenRefusal", () => {
  it.each([
    ["OAuth", { error: "invalid_grant", error_description: "Bad code." }, { error: "invalid_grant", description: "Bad code." }],
    [
      "GitHub's error in a 200",
      { error: "bad_verification_code", error_description: "The code passed is incorrect or expired.", error_uri: "x" },
      { error: "bad_verification_code", description: "The code passed is incorrect or expired." },
    ],
    ["ClickUp", { err: "Client not found", ECODE: "OAUTH_010" }, { error: "OAUTH_010", description: "Client not found" }],
    ["Asana", { errors: [{ message: "forbidden_scopes: not allowed", help: "x" }] }, { description: "forbidden_scopes: not allowed" }],
    ["a nested error", { error: { code: "E1", message: "Nope." } }, { error: "E1", description: "Nope." }],
    ["no error at all", { status: 400 }, {}],
  ])("reads %s", (_label, body, want) => {
    expect(readTokenRefusal(body)).toEqual(want);
  });

  it("reads nothing but the error fields: no token, whatever else the reply holds", () => {
    const out = readTokenRefusal({ access_token: "at_secret", refresh_token: "rt_secret", id_token: "it_secret" });
    expect(out).toEqual({});
  });

  it.each([null, "text", 42, ["error"]])("reads %j as nothing", (body) => {
    expect(readTokenRefusal(body)).toEqual({});
  });
});

describe("asFailure", () => {
  it("accepts a well formed failure and drops unknown fields", () => {
    expect(asFailure({ provider: "azure", code: "failed", reason: "AADSTS650052", detail: "x", at: 1, extra: true })).toEqual({
      provider: "azure",
      code: "failed",
      reason: "AADSTS650052",
      detail: "x",
    });
    expect(asFailure({ provider: "asana", code: "failed", reason: BRIEF_REASON.state })).toEqual({
      provider: "asana",
      code: "failed",
      reason: BRIEF_REASON.state,
    });
  });

  it.each([
    null,
    "azure",
    { provider: "toString", code: "failed" },
    { provider: "azure", code: "boom" },
    { provider: "azure", code: "failed", reason: 401 },
    { provider: "azure", code: "failed", reason: "brief:made-up" },
    { provider: "azure", code: "failed", detail: "x".repeat(400) },
  ])("refuses %j", (value) => {
    expect(asFailure(value)).toBeNull();
  });
});
