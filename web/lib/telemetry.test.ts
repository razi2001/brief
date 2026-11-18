import { describe, expect, it } from "vitest";
import { PING_FIELDS, buildPing, instanceId, parsePing, telemetryEnabled } from "./telemetry";

const ping = buildPing({
  supabaseUrl: "https://abc.supabase.co",
  version: "0.1.0",
  allUserIds: ["u1", "u2", "u1"],
  recent: [
    { user_id: "u1", status: "filed", created_at: "2026-11-17", ticket_provider: "linear" },
    { user_id: "u1", status: "filed", created_at: "2026-11-17", ticket_provider: "jira" },
    { user_id: "u2", status: "failed", created_at: "2026-11-17", ticket_provider: null },
    { user_id: "u2", status: "drafted", created_at: "2026-11-17", ticket_provider: null },
  ],
});

describe("telemetry ping", () => {
  // TELEMETRY.md lists these fields. Adding one is a privacy change.
  it("carries counts only, and exactly the documented fields", () => {
    expect(Object.keys(ping).sort()).toEqual([...PING_FIELDS].sort());
    expect(ping).toEqual({
      instance: instanceId("https://abc.supabase.co"),
      version: "0.1.0",
      users: 2,
      created7d: 4,
      filed7d: 2,
      failed7d: 1,
      trackers: ["jira", "linear"],
    });
  });

  it("does not reveal the instance's address", () => {
    expect(JSON.stringify(ping)).not.toContain("abc");
    expect(ping.instance).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is on unless BRIEF_TELEMETRY says off", () => {
    expect(telemetryEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    for (const v of ["off", "OFF", "0", "false", "no"]) {
      expect(telemetryEnabled({ BRIEF_TELEMETRY: v } as unknown as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it("the receiver keeps only known fields and rejects junk", () => {
    expect(parsePing({ ...ping, email: "x@y.z", title: "secret" })).toEqual(ping);
    expect(parsePing({ ...ping, users: -1 })).toBeNull();
    expect(parsePing({ ...ping, instance: "not-a-hash" })).toBeNull();
    expect(parsePing({ ...ping, trackers: ["linear", "<script>", 3] })?.trackers).toEqual(["linear"]);
    expect(parsePing(null)).toBeNull();
  });
});
