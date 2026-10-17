import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnedProvider } from "@/lib/connections";

type Account = { provider: string; imageUrl?: string };

const clerk = vi.hoisted(() => ({
  user: {} as { hasImage?: boolean; imageUrl?: string; externalAccounts?: Account[] },
  uploads: [] as File[],
  failGetUser: false,
  failUpload: false,
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      getUser: async () => {
        if (clerk.failGetUser) throw new Error("clerk down");
        return clerk.user;
      },
      updateUserProfileImage: async (_userId: string, { file }: { file: File }) => {
        if (clerk.failUpload) throw new Error("clerk refused");
        clerk.uploads.push(file);
        return clerk.user;
      },
    },
  }),
}));

vi.mock("@/lib/trackers/registry", () => ({
  CLERK_PROVIDERS: [
    { key: "linear", clerkMatch: "linear" },
    { key: "jira", clerkMatch: "atlassian" },
    { key: "github", clerkMatch: "github" },
  ],
}));

import { adoptTrackerAvatar, clerkImage, hasOwnImage, keepPhotoOf, MAX_AVATAR_BYTES, sniffImageType } from "./tracker-avatar";

/** A Clerk image URL, as img.clerk.com spells one. */
const clerkUrl = (type: string, src: string, s = "sig") =>
  `https://img.clerk.com/${Buffer.from(JSON.stringify({ type, src, s })).toString("base64url")}`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const GOOGLE_SRC = "https://lh3.googleusercontent.com/a/photo";
const GITHUB_SRC = "https://avatars.githubusercontent.com/u/1?v=4";
const MATCHES = ["linear", "atlassian", "github"];

describe("hasOwnImage", () => {
  it("is false while Clerk shows its default avatar", () => {
    expect(hasOwnImage({ hasImage: false, imageUrl: clerkUrl("default", "x") }, MATCHES)).toBe(false);
  });

  it("is true for an uploaded photo", () => {
    expect(hasOwnImage({ hasImage: true, imageUrl: clerkUrl("upload", "https://images.clerk.dev/uploaded/img_1") }, MATCHES)).toBe(true);
  });

  it("is true for a photo from a sign-in method such as Google", () => {
    const user = {
      hasImage: true,
      imageUrl: clerkUrl("proxy", GOOGLE_SRC, "a"),
      externalAccounts: [{ provider: "oauth_google", imageUrl: clerkUrl("proxy", GOOGLE_SRC, "b") }],
    };
    expect(hasOwnImage(user, MATCHES)).toBe(true);
  });

  it("is false for a photo only a Clerk tracker account holds", () => {
    const user = {
      hasImage: true,
      imageUrl: clerkUrl("proxy", GITHUB_SRC),
      externalAccounts: [
        { provider: "oauth_google", imageUrl: clerkUrl("proxy", GOOGLE_SRC) },
        { provider: "oauth_github", imageUrl: clerkUrl("proxy", GITHUB_SRC) },
      ],
    };
    expect(hasOwnImage(user, MATCHES)).toBe(false);
  });

  it("is true when a sign-in account shows the same photo as a tracker account", () => {
    const user = {
      hasImage: true,
      imageUrl: GITHUB_SRC,
      externalAccounts: [
        { provider: "oauth_github", imageUrl: GITHUB_SRC },
        { provider: "oauth_google", imageUrl: GITHUB_SRC },
      ],
    };
    expect(hasOwnImage(user, MATCHES)).toBe(true);
  });

  it("is true when the photo's origin can't be told", () => {
    expect(hasOwnImage({ hasImage: true, imageUrl: "https://example.com/me.png", externalAccounts: [] }, MATCHES)).toBe(true);
    expect(hasOwnImage({ hasImage: true }, MATCHES)).toBe(true);
  });
});

describe("clerkImage", () => {
  it("reads the type and source of an img.clerk.com URL, and nothing else", () => {
    expect(clerkImage(clerkUrl("proxy", GITHUB_SRC))).toEqual({ type: "proxy", src: GITHUB_SRC });
    expect(clerkImage("https://img.clerk.com/not-base64-json")).toBeNull();
    expect(clerkImage(GITHUB_SRC)).toBeNull();
  });
});

describe("sniffImageType", () => {
  it("knows the photo types by their first bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("<svg/>"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

type Route = (init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetched: Array<{ url: string; headers: Headers }>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const image = (bytes: Uint8Array = PNG, type = "image/png", extra: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": type, ...extra } });

beforeEach(() => {
  clerk.user = { hasImage: false, imageUrl: clerkUrl("default", "x"), externalAccounts: [] };
  clerk.uploads = [];
  clerk.failGetUser = false;
  clerk.failUpload = false;
  routes = {};
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetched.push({ url, headers: new Headers(init?.headers) });
      const route = routes[url];
      return route ? route(init) : json({ error: "unexpected" }, 404);
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GH_USER = "https://api.github.com/user";
const GH_AVATAR = "https://avatars.githubusercontent.com/u/1?v=4";

function githubWithAvatar(avatar: Route = () => image()) {
  routes[GH_USER] = () => json({ login: "ada", avatar_url: GH_AVATAR });
  routes[GH_AVATAR] = avatar;
}

const run = (provider: OwnedProvider = "github", ctx: Record<string, string> = {}) =>
  adoptTrackerAvatar("user_1", provider, { accessToken: "tok", ...ctx });

describe("adoptTrackerAvatar", () => {
  it("sets the tracker account's photo for a user with none", async () => {
    githubWithAvatar();
    expect(await run()).toBe("set");
    expect(clerk.uploads).toHaveLength(1);
    const file = clerk.uploads[0];
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("avatar.png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    // The profile call carries the token; the public image host doesn't get it.
    expect(fetched.find((f) => f.url === GH_USER)?.headers.get("authorization")).toBe("Bearer tok");
    expect(fetched.find((f) => f.url === GH_AVATAR)?.headers.get("authorization")).toBeNull();
  });

  it("leaves a Google photo alone, without asking the tracker", async () => {
    clerk.user = {
      hasImage: true,
      imageUrl: clerkUrl("proxy", GOOGLE_SRC),
      externalAccounts: [{ provider: "oauth_google", imageUrl: clerkUrl("proxy", GOOGLE_SRC) }],
    };
    githubWithAvatar();
    expect(await run()).toBe("kept");
    expect(clerk.uploads).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("leaves an uploaded photo alone", async () => {
    clerk.user = { hasImage: true, imageUrl: clerkUrl("upload", "https://images.clerk.dev/uploaded/img_1") };
    githubWithAvatar();
    expect(await run()).toBe("kept");
    expect(clerk.uploads).toEqual([]);
  });

  it("replaces a photo that only a Clerk tracker account holds", async () => {
    clerk.user = {
      hasImage: true,
      imageUrl: clerkUrl("proxy", "https://public.linear.app/old.png"),
      externalAccounts: [{ provider: "oauth_linear", imageUrl: clerkUrl("proxy", "https://public.linear.app/old.png") }],
    };
    githubWithAvatar();
    expect(await run()).toBe("set");
    expect(clerk.uploads).toHaveLength(1);
  });

  it.each([
    [
      "linear",
      {},
      {
        "https://api.linear.app/graphql": () => json({ data: { viewer: { avatarUrl: "https://public.linear.app/a.png" } } }),
      },
      "https://public.linear.app/a.png",
    ],
    [
      "jira",
      { siteId: "cloud-1" },
      {
        "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself": () =>
          json({
            avatarUrls: {
              "16x16": "https://avatar.example.com/16.png",
              "48x48": "https://avatar.example.com/48.png",
              "24x24": "https://avatar.example.com/24.png",
            },
          }),
      },
      "https://avatar.example.com/48.png",
    ],
    [
      "gitlab",
      {},
      { "https://gitlab.com/api/v4/user": () => json({ avatar_url: "https://gitlab.com/uploads/avatar.png" }) },
      "https://gitlab.com/uploads/avatar.png",
    ],
    [
      "clickup",
      {},
      {
        "https://api.clickup.com/api/v2/user": () =>
          json({ user: { profilePicture: "https://attachments.clickup.com/profilePictures/1.jpg" } }),
      },
      "https://attachments.clickup.com/profilePictures/1.jpg",
    ],
    ["notion", { avatarUrl: "https://s3.us-west-2.amazonaws.com/notion/ada.png" }, {}, "https://s3.us-west-2.amazonaws.com/notion/ada.png"],
    [
      "trello",
      { apiKey: "trello-key" },
      {
        "https://api.trello.com/1/members/me?fields=avatarUrl&key=trello-key&token=tok": () =>
          json({ avatarUrl: "https://trello-members.s3.amazonaws.com/m1/abc" }),
      },
      "https://trello-members.s3.amazonaws.com/m1/abc/170.png",
    ],
    [
      "asana",
      {},
      {
        "https://app.asana.com/api/1.0/users/me?opt_fields=photo": () =>
          json({
            data: {
              photo: {
                image_60x60: "https://s3.amazonaws.com/asana/60.png",
                image_128x128: "https://s3.amazonaws.com/asana/128.png",
                image_21x21: "https://s3.amazonaws.com/asana/21.png",
              },
            },
          }),
      },
      "https://s3.amazonaws.com/asana/128.png",
    ],
    [
      "monday",
      {},
      {
        "https://api.monday.com/v2": () =>
          json({ data: { me: { photo_original: "https://files.monday.com/photos/1/original.png" } } }),
      },
      "https://files.monday.com/photos/1/original.png",
    ],
  ] as Array<[OwnedProvider, Record<string, string>, Record<string, Route>, string]>)(
    "reads %s's photo",
    async (provider, ctx, api, photo) => {
      Object.assign(routes, api, { [photo]: () => image() });
      expect(await run(provider, ctx)).toBe("set");
      expect(fetched.map((f) => f.url)).toContain(photo);
      expect(clerk.uploads).toHaveLength(1);
    },
  );

  it("asks Notion nothing: the photo is in the token reply, or there is none", async () => {
    expect(await run("notion")).toBe("none");
    expect(fetched).toEqual([]);
  });

  it("asks Jira nothing without a site", async () => {
    expect(await run("jira")).toBe("none");
    expect(fetched).toEqual([]);
  });

  const AZURE = "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?details=true&coreAttributes=Avatar&api-version=7.1";

  it("takes Azure DevOps' photo from the profile itself", async () => {
    routes[AZURE] = () =>
      json({ coreAttributes: { Avatar: { value: { isAutoGenerated: false, value: Buffer.from(PNG).toString("base64") } } } });
    expect(await run("azure")).toBe("set");
    expect(clerk.uploads[0].type).toBe("image/png");
    expect(fetched.map((f) => f.url)).toEqual([AZURE]);
  });

  it("skips Azure DevOps' generated placeholder", async () => {
    routes[AZURE] = () =>
      json({ coreAttributes: { Avatar: { value: { isAutoGenerated: true, value: Buffer.from(PNG).toString("base64") } } } });
    expect(await run("azure")).toBe("none");
    expect(clerk.uploads).toEqual([]);
  });

  it("sends the Linear token to Linear's own upload host only", async () => {
    const photo = "https://uploads.linear.app/a/b.png";
    routes["https://api.linear.app/graphql"] = () => json({ data: { viewer: { avatarUrl: photo } } });
    routes[photo] = () => new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/b.png" } });
    routes["https://cdn.example.com/b.png"] = () => image();
    expect(await run("linear")).toBe("set");
    expect(fetched.find((f) => f.url === photo)?.headers.get("authorization")).toBe("Bearer tok");
    expect(fetched.find((f) => f.url === "https://cdn.example.com/b.png")?.headers.get("authorization")).toBeNull();
  });

  it.each([
    ["plain http", "http://avatars.example.com/a.png"],
    ["a bare IP", "https://169.254.169.254/latest/meta-data"],
    ["Fly's private network", "https://brief-cloud.internal/a.png"],
  ])("never fetches a photo on %s", async (_what, url) => {
    routes[GH_USER] = () => json({ avatar_url: url });
    routes[url] = () => image();
    expect(await run()).toBe("none");
    expect(fetched.map((f) => f.url)).toEqual([GH_USER]);
  });

  it("doesn't follow a redirect off to a private host", async () => {
    githubWithAvatar(() => new Response(null, { status: 302, headers: { Location: "http://10.0.0.1/a.png" } }));
    expect(await run()).toBe("none");
    expect(fetched.map((f) => f.url)).toEqual([GH_USER, GH_AVATAR]);
  });

  it.each([
    ["not an image", () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } })],
    ["an SVG", () => image(new TextEncoder().encode("<svg/>"), "image/svg+xml")],
    ["said to be over 10 MB", () => image(PNG, "image/png", { "Content-Length": String(MAX_AVATAR_BYTES + 1) })],
    ["over 10 MB once read", () => image(new Uint8Array(MAX_AVATAR_BYTES + 1), "image/png")],
    ["missing", () => new Response("gone", { status: 404 })],
  ])("skips a photo that is %s", async (_what, avatar) => {
    githubWithAvatar(avatar as Route);
    expect(await run()).toBe("none");
    expect(clerk.uploads).toEqual([]);
  });

  it("skips a tracker that won't say", async () => {
    routes[GH_USER] = () => json({ message: "Bad credentials" }, 401);
    expect(await run()).toBe("none");
  });

  it.each([
    [
      "the tracker is unreachable",
      () => {
        routes[GH_USER] = () => Promise.reject(new TypeError("fetch failed"));
      },
    ],
    ["the photo host is unreachable", () => githubWithAvatar(() => Promise.reject(new TypeError("fetch failed")))],
    [
      "Clerk can't be read",
      () => {
        clerk.failGetUser = true;
        githubWithAvatar();
      },
    ],
    [
      "Clerk refuses the upload",
      () => {
        clerk.failUpload = true;
        githubWithAvatar();
      },
    ],
  ])("never throws when %s", async (_what, arrange) => {
    arrange();
    await expect(run()).resolves.toBe("failed");
    expect(clerk.uploads).toEqual([]);
  });
});

describe("keepPhotoOf", () => {
  const LINEAR = clerkUrl("proxy", "https://public.linear.app/ada.png");
  const GOOGLE = clerkUrl("proxy", GOOGLE_SRC);
  // The user shows the photo of the Clerk Linear account about to be removed.
  const showsLinear = () => ({
    hasImage: true,
    imageUrl: LINEAR,
    externalAccounts: [{ provider: "oauth_linear", imageUrl: LINEAR }],
  });
  const uploads: File[] = [];
  const upload = async (file: File) => {
    uploads.push(file);
  };

  beforeEach(() => {
    uploads.length = 0;
  });

  it("uploads the photo of the account about to go when the user shows it", async () => {
    routes[LINEAR] = () => image();
    expect(await keepPhotoOf(showsLinear(), { imageUrl: LINEAR }, upload)).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].type).toBe("image/png");
    expect(uploads[0].name).toBe("avatar.png");
  });

  it("leaves a photo of the user's own alone", async () => {
    routes[LINEAR] = () => image();
    const user = {
      hasImage: true,
      imageUrl: GOOGLE,
      externalAccounts: [
        { provider: "oauth_google", imageUrl: GOOGLE },
        { provider: "oauth_linear", imageUrl: LINEAR },
      ],
    };
    expect(await keepPhotoOf(user, { imageUrl: LINEAR }, upload)).toBe(false);
    expect(uploads).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it.each([
    ["shows another photo", { hasImage: false, imageUrl: clerkUrl("default", "x") }, { imageUrl: LINEAR }],
    ["has no photo to keep", showsLinear(), {}],
  ])("does nothing when the account %s", async (_what, user, account) => {
    expect(await keepPhotoOf(user, account, upload)).toBe(false);
    expect(uploads).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it.each([
    ["the photo is missing", () => (routes[LINEAR] = () => new Response("gone", { status: 404 }))],
    ["the photo host is unreachable", () => (routes[LINEAR] = () => Promise.reject(new TypeError("fetch failed")))],
  ])("never throws when %s", async (_what, arrange) => {
    arrange();
    await expect(keepPhotoOf(showsLinear(), { imageUrl: LINEAR }, upload)).resolves.toBe(false);
    expect(uploads).toEqual([]);
  });

  it("never throws when Clerk refuses the upload", async () => {
    routes[LINEAR] = () => image();
    const refuse = async () => {
      throw new Error("clerk refused");
    };
    await expect(keepPhotoOf(showsLinear(), { imageUrl: LINEAR }, refuse)).resolves.toBe(false);
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(expect.stringContaining("could not keep the photo"), "Error");
  });
});
