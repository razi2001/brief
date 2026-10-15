import { createHmac } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { STATE_TTL_MS, readState, signState } from "@/lib/oauth-state";

beforeAll(() => {
  process.env.CONNECTIONS_KEY = "test-signing-secret";
});

const state = { userId: "user_1", provider: "clickup" as const, returnTo: "/connections" };

describe("signState / readState", () => {
  it("round-trips the state it was given", () => {
    const decoded = readState(signState(state));
    expect(decoded).toMatchObject(state);
    expect(typeof decoded?.ts).toBe("number");
  });

  // The whole point: the callback must not take the user id on trust from the
  // query string, or a crafted callback could attach an attacker's tracker
  // account to someone else's Brief account.
  it("rejects a payload that was tampered with", () => {
    const signed = signState(state);
    const [, mac] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...state, userId: "user_victim", ts: Date.now() }),
      "utf8",
    ).toString("base64url");
    expect(readState(`${forged}.${mac}`)).toBeNull();
  });

  // CONNECTIONS_KEY is also the token encryption key, so it is never used raw
  // as the HMAC key; a MAC made that way must not verify.
  it("rejects a MAC made with the raw secret instead of the derived key", () => {
    const [payload] = signState(state).split(".");
    const rawMac = createHmac("sha256", "test-signing-secret").update(payload).digest("base64url");
    expect(readState(`${payload}.${rawMac}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const [payload] = signState(state).split(".");
    expect(readState(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects malformed and missing input", () => {
    expect(readState(null)).toBeNull();
    expect(readState(undefined)).toBeNull();
    expect(readState("")).toBeNull();
    expect(readState("no-dot")).toBeNull();
    expect(readState("a.b.c")).toBeNull();
  });

  it("expires a flow that was never completed", () => {
    const signed = signState({ ...state, ts: Date.now() - STATE_TTL_MS - 1000 });
    expect(readState(signed)).toBeNull();
  });

  it("still accepts one just inside the window", () => {
    const signed = signState({ ...state, ts: Date.now() - (STATE_TTL_MS - 5000) });
    expect(readState(signed)).toMatchObject({ userId: "user_1" });
  });

  // Signed correctly, so these get past the signature check and are turned
  // away only for having nothing usable in them.
  it("rejects a validly signed state missing the user id", () => {
    expect(readState(signState({ ...state, userId: "" }))).toBeNull();
  });

  it("rejects a validly signed state missing the provider", () => {
    const partial: Partial<typeof state> = { ...state };
    delete partial.provider;
    const signed = signState(partial as typeof state);
    const decoded = JSON.parse(Buffer.from(signed.split(".")[0], "base64url").toString("utf8"));
    expect(decoded).not.toHaveProperty("provider");
    expect(readState(signed)).toBeNull();
  });
});
