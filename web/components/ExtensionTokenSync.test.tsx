// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const clerk = vi.hoisted(() => ({
  isSignedIn: false,
  user: null as null | { id: string },
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: clerk.isSignedIn }),
  useUser: () => ({ isLoaded: true, user: clerk.user }),
}));

import ExtensionTokenSync from "./ExtensionTokenSync";

const EXT = "heekinkibhgbilagcdnmcjajijaalpcc";

type Reply = (r?: { ok?: boolean }) => void;
let sendMessage: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function visit(path: string) {
  window.history.replaceState(null, "", path);
}
function signedOut() {
  clerk.isSignedIn = false;
  clerk.user = null;
}
function signedIn(id: string) {
  clerk.isSignedIn = true;
  clerk.user = { id };
}
/** Where Clerk sends a signed-out visitor of /connect?ext=… (see proxy.ts). */
function connectRedirect(ext: string, origin = window.location.origin) {
  return `/sign-in?redirect_url=${encodeURIComponent(`${origin}/connect?ext=${ext}`)}`;
}
const flush = () => act(async () => {});
/** A full page load: the root layout mounts the sync afresh. */
async function loadPage(path: string) {
  cleanup();
  visit(path);
  const view = render(<ExtensionTokenSync />);
  await flush();
  return view;
}
/** Clerk's client-side hop after signing in: same mount, new auth state. */
async function signInAndLand(view: ReturnType<typeof render>, userId: string, path: string) {
  visit(path);
  signedIn(userId);
  view.rerender(<ExtensionTokenSync />);
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  signedOut();
  sendMessage = vi.fn((_id: string, _msg: unknown, cb?: Reply) => cb?.({ ok: true }));
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok_new" }) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExtensionTokenSync, install-first sign-up", () => {
  it("pairs the extension that sent a signed-out visitor to /connect, after sign-up lands on /welcome", async () => {
    // The setup tab sends them to /connect?ext=…; signed out, Clerk bounces
    // them to /sign-in with that page as redirect_url.
    const view = await loadPage(connectRedirect(EXT));
    expect(fetchMock).not.toHaveBeenCalled();

    // They pick "Sign up". Sign-up forces /welcome, so redirect_url is gone.
    await signInAndLand(view, "user_new", "/welcome");

    expect(fetchMock).toHaveBeenCalledWith("/api/extension-token", expect.objectContaining({ method: "POST" }));
    expect(sendMessage).toHaveBeenCalledWith(EXT, { type: "brief-cloud-token", token: "tok_new" }, expect.any(Function));
    expect(localStorage.getItem("briefExtId")).toBe(EXT);
    expect(localStorage.getItem("briefExtSyncedUser")).toBe("user_new");

    // Paired once: the next page mints nothing more.
    fetchMock.mockClear();
    await loadPage("/dashboard");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells the page when it pairs, so onboarding can show it", async () => {
    const view = await loadPage(connectRedirect(EXT));
    const paired = vi.fn();
    window.addEventListener("brief-ext-paired", paired);
    await signInAndLand(view, "user_new", "/welcome");
    window.removeEventListener("brief-ext-paired", paired);
    expect(paired).toHaveBeenCalledTimes(1);
  });

  it("leaves the pairing to /connect itself, so one sign-in mints one token", async () => {
    const view = await loadPage(connectRedirect(EXT));
    // An existing account signs in: Clerk honours redirect_url, back to /connect.
    await signInAndLand(view, "user_old", `/connect?ext=${EXT}`);
    expect(fetchMock).not.toHaveBeenCalled();

    // /connect pairs it and moves on to /tickets.
    localStorage.setItem("briefExtId", EXT);
    localStorage.setItem("briefExtSyncedUser", "user_old");
    await loadPage("/tickets");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a redirect that isn't Brief's own /connect, or an id that isn't an extension id", async () => {
    for (const path of [
      connectRedirect(EXT, "https://evil.example"),
      `/sign-in?redirect_url=${encodeURIComponent(`${window.location.origin}/tickets?ext=${EXT}`)}`,
      connectRedirect("not-an-extension-id"),
    ]) {
      signedOut();
      const view = await loadPage(path);
      await signInAndLand(view, "user_new", "/welcome");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("forgets a request older than a day", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const view = await loadPage(connectRedirect(EXT));
    vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60 * 1000);
    await signInAndLand(view, "user_new", "/welcome");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops the request when the extension doesn't take the token, instead of minting one per page", async () => {
    sendMessage.mockImplementation((_id: string, _msg: unknown, cb?: Reply) => cb?.(undefined));
    const view = await loadPage(connectRedirect(EXT));
    await signInAndLand(view, "user_new", "/welcome");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("briefExtId")).toBeNull();

    await loadPage("/dashboard");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the request for later when this browser can't reach any extension", async () => {
    const view = await loadPage(connectRedirect(EXT));
    vi.stubGlobal("chrome", undefined);
    await signInAndLand(view, "user_new", "/welcome");
    expect(fetchMock).not.toHaveBeenCalled();

    // Back where the extension can hear us: it pairs.
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    await loadPage("/dashboard");
    expect(sendMessage).toHaveBeenCalledWith(EXT, { type: "brief-cloud-token", token: "tok_new" }, expect.any(Function));
  });
});
