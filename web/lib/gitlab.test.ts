import { afterEach, describe, expect, it, vi } from "vitest";
import { listGitlabGroups, makeGitlabTracker, parseGitlabRef } from "@/lib/gitlab";
import { buildGitlabBody, gitlabStateColor, liveStateName } from "@/lib/gitlab-body";
import { BRIEF_ATTRIBUTION, STATUS_COLOR } from "@/lib/tracker";

const API = "https://gitlab.com/api/v4";
const TOKEN = "glpat-test-secret";

type Call = { method: string; url: string; auth: string | null; body?: Record<string, unknown>; form?: FormData };
type Route = { method?: string; path: string; reply: (call: Call) => Response };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const notFound = (what = "Not found") => json({ message: `404 ${what}` }, 404);

/**
 * A stub GitLab: each route matches a method and an EXACT path with its query
 * string, so the request URLs are asserted just by being answered. Anything
 * unrouted is a 404, which a test then notices in its own assertions.
 */
function mockGitlab(routes: Route[], base = API): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const call: Call = { method, url: String(url), auth: new Headers(init.headers).get("Authorization") };
      if (typeof init.body === "string") call.body = JSON.parse(init.body);
      else if (init.body instanceof FormData) call.form = init.body;
      calls.push(call);
      const route = routes.find((r) => (r.method ?? "GET") === method && base + r.path === call.url);
      return route ? route.reply(call) : notFound();
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Envelopes shaped like GitLab REST v4's own responses.

function issue(over: Record<string, unknown> = {}) {
  const iid = (over.iid as number) ?? 7;
  return {
    id: 9000 + iid,
    iid,
    project_id: 42,
    title: "Save button does nothing",
    description: "body",
    state: "opened",
    created_at: "2026-10-13T09:00:00.000Z",
    updated_at: "2026-10-13T09:30:00.000Z",
    closed_at: null,
    labels: [],
    milestone: null,
    assignees: [],
    assignee: null,
    author: { id: 1, username: "razi", name: "Razi", state: "active" },
    type: "ISSUE",
    issue_type: "issue",
    confidential: false,
    due_date: null,
    weight: null,
    web_url: `https://gitlab.com/acme/web/-/issues/${iid}`,
    references: { short: `#${iid}`, relative: `#${iid}`, full: `acme/web#${iid}` },
    ...over,
  };
}

function uploaded(call: Call): Response {
  const file = call.form?.get("file") as File;
  const secret = file.name.startsWith("screenshot") ? "aaa111" : "bbb222";
  const alt = file.name.replace(/\.[^.]+$/, "");
  return json(
    {
      id: 5,
      alt,
      url: `/uploads/${secret}/${file.name}`,
      full_path: `/-/project/42/uploads/${secret}/${file.name}`,
      markdown: `![${alt}](/uploads/${secret}/${file.name})`,
    },
    201,
  );
}

const LABELS = [
  { id: 1, name: "bug", color: "#d9534f", description: null, text_color: "#FFFFFF" },
  { id: 2, name: "priority::high", color: "#ff0000", description: null, text_color: "#FFFFFF" },
  { id: 3, name: "priority::low", color: "#00ff00", description: null, text_color: "#FFFFFF" },
  { id: 4, name: "workflow::Doing", color: "#0000ff", description: null, text_color: "#FFFFFF" },
  { id: 5, name: "workflow::In review", color: "#0000ff", description: null, text_color: "#FFFFFF" },
];

const MEMBERS = [
  { id: 12, username: "ada", name: "Ada Lovelace", state: "active", avatar_url: "https://gitlab.com/ada.png", access_level: 30 },
  { id: 13, username: "project_42_bot_4f2a", name: "Deploy token", state: "active", avatar_url: null, access_level: 40 },
  { id: 14, username: "old", name: "Gone Person", state: "blocked", avatar_url: null, access_level: 30 },
];

const MILESTONES = [{ id: 501, iid: 3, project_id: 42, title: "v1.2", state: "active", due_date: null }];

const labelsRoute = (proj = "42"): Route => ({
  path: `/projects/${proj}/labels?per_page=100&include_ancestor_groups=true`,
  reply: () => json(LABELS),
});

const createRoute = (over: Record<string, unknown> = {}): Route => ({
  method: "POST",
  path: "/projects/42/issues",
  reply: (c) => json(issue({ title: c.body?.title, ...over }), 201),
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("parseGitlabRef", () => {
  // Projects nest under any depth of subgroups, so the path is everything
  // before the last "#".
  it("reads a nested project path and the iid", () => {
    expect(parseGitlabRef("a/b/c#12")).toEqual({ path: "a/b/c", iid: 12 });
    expect(parseGitlabRef("acme/web#7")).toEqual({ path: "acme/web", iid: 7 });
  });

  it("rejects anything that cannot address an issue", () => {
    expect(parseGitlabRef("#12")).toBeNull();
    expect(parseGitlabRef("acme/web")).toBeNull();
    expect(parseGitlabRef("acme web#3")).toBeNull();
    expect(parseGitlabRef("")).toBeNull();
  });
});

describe("live state", () => {
  // The feed shows the value, the agent's getIssue the full label.
  it("shows a status label's value, Closed for a closed issue, else Open", () => {
    expect(liveStateName(false, ["bug", "workflow::In review"])).toBe("In review");
    // A nested scope's value is what follows its last "::".
    expect(liveStateName(false, ["workflow::review::Waiting"])).toBe("Waiting");
    expect(liveStateName(false, ["status::Blocked"])).toBe("Blocked");
    expect(liveStateName(false, ["workflow::  "])).toBe("Open");
    expect(liveStateName(false, ["bug"])).toBe("Open");
    expect(liveStateName(true, ["workflow::Doing"])).toBe("Closed");
  });

  it("colors every issue from the brand palette", () => {
    expect(gitlabStateColor(true, ["workflow::Doing"])).toBe(STATUS_COLOR.done);
    expect(gitlabStateColor(false, [])).toBe(STATUS_COLOR.active);
    expect(gitlabStateColor(false, ["workflow::In review"])).toBe(STATUS_COLOR.active);
    expect(gitlabStateColor(false, ["workflow::Blocked"])).toBe(STATUS_COLOR.active);
    // An open issue whose status says otherwise is shown as what it says.
    expect(gitlabStateColor(false, ["workflow::Done"])).toBe(STATUS_COLOR.done);
    expect(gitlabStateColor(false, ["workflow::complete"])).toBe(STATUS_COLOR.done);
    expect(gitlabStateColor(false, ["workflow::Backlog"])).toBe(STATUS_COLOR.neutral);
    expect(gitlabStateColor(false, ["status::To do"])).toBe(STATUS_COLOR.neutral);
    const palette = Object.values(STATUS_COLOR) as string[];
    for (const labels of [[], ["bug"], ["workflow::"], ["workflow::Anything else"]]) {
      expect(palette, labels.join()).toContain(gitlabStateColor(false, labels));
    }
  });
});

describe("buildGitlabBody", () => {
  it("puts each caption directly above its image and labels a recording", () => {
    const md = buildGitlabBody("Broken.", [
      { kind: "image", markdown: "![screenshot-1](/uploads/a/screenshot-1.png)", caption: "The cart is empty" },
      { kind: "recording", markdown: "![screen-recording](/uploads/b/screen-recording.webm)" },
    ]);
    expect(md).toBe(
      [
        "Broken.",
        "",
        "## Evidence",
        "",
        "The cart is empty",
        "",
        "![screenshot-1](/uploads/a/screenshot-1.png)",
        "",
        "**Screen recording:**",
        "",
        "![screen-recording](/uploads/b/screen-recording.webm)",
      ].join("\n"),
    );
  });

  it("leaves the body alone when nothing uploaded", () => {
    expect(buildGitlabBody("**Steps to reproduce**\n\n1. Open", [])).toBe("### Steps to reproduce\n\n1. Open");
  });
});

describe("fileIssue", () => {
  it("uploads the evidence, then creates one issue with it inline under Evidence", async () => {
    const calls = mockGitlab([
      { method: "POST", path: "/projects/42/uploads", reply: uploaded },
      createRoute(),
    ]);

    const out = await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "Save button does nothing",
      descriptionMarkdown: "Clicking Save does nothing.\n\n**Steps to reproduce**\n\n1. Open the cart",
      evidence: [
        { filename: "frame-02.jpg", contentType: "image/png", bytes: png, caption: "The cart shows zero items" },
        { filename: "recording-1699.webm", contentType: "video/webm", bytes: Buffer.from("webm") },
      ],
      details: [{ title: "Network calls", markdown: "| GET /api/cart | 500 |" }],
    });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/projects/42/uploads`,
      `POST ${API}/projects/42/uploads`,
      `POST ${API}/projects/42/issues`,
    ]);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);

    // Neutral names, with the evidence's own content type.
    const first = calls[0].form?.get("file") as File;
    const second = calls[1].form?.get("file") as File;
    expect(first.name).toBe("screenshot-1.png");
    expect(first.type).toBe("image/png");
    expect(second.name).toBe("screen-recording.webm");

    const body = String(calls[2].body?.description);
    expect(body).toContain("### Steps to reproduce");
    expect(body).toContain(
      "## Evidence\n\nThe cart shows zero items\n\n![screenshot-1](/uploads/aaa111/screenshot-1.png)",
    );
    expect(body).toContain("**Screen recording:**\n\n![screen-recording](/uploads/bbb222/screen-recording.webm)");
    expect(body).toContain("<details>\n<summary>Network calls</summary>");
    expect(body.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
    expect(body.indexOf("## Evidence")).toBeLessThan(body.indexOf("<details>"));
    // The ticket never says how the report was captured.
    expect(body).not.toContain("frame-02");
    expect(body).not.toContain("recording-1699");
    // Nothing the agent did not ask for.
    expect(calls[2].body).toEqual({ title: "Save button does nothing", description: body });

    expect(out).toEqual({
      id: "9007",
      identifier: "acme/web#7",
      url: "https://gitlab.com/acme/web/-/issues/7",
      title: "Save button does nothing",
    });
  });

  it("reuses the agent's own Evidence heading instead of adding a second", async () => {
    const calls = mockGitlab([
      { method: "POST", path: "/projects/42/uploads", reply: uploaded },
      createRoute(),
    ]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "Broken.\n\n## Evidence\n\n- The badge is clipped.",
      evidence: [{ filename: "a.png", contentType: "image/png", bytes: png }],
    });
    const body = String(calls.at(-1)?.body?.description);
    expect(body.match(/## Evidence/g)).toHaveLength(1);
    expect(body.indexOf("## Evidence")).toBeLessThan(body.indexOf("![screenshot-1]("));
  });

  it("skips a failed upload without a gap in the names, and never logs the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempt = 0;
    const calls = mockGitlab([
      {
        method: "POST",
        path: "/projects/42/uploads",
        // An error page that echoes the request's credentials back, as a
        // misconfigured proxy in front of GitLab can.
        reply: (c) => (++attempt === 1 ? json({ message: "500", echoed: c.auth }, 500) : uploaded(c)),
      },
      createRoute(),
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "Broken.",
      evidence: [
        { filename: "a.png", contentType: "image/png", bytes: png },
        { filename: "b.png", contentType: "image/png", bytes: png },
      ],
    });
    expect(out.identifier).toBe("acme/web#7");
    expect((calls[1].form?.get("file") as File).name).toBe("screenshot-1.png");
    const body = String(calls.at(-1)?.body?.description);
    expect(body).toContain("![screenshot-1](/uploads/aaa111/screenshot-1.png)");
    expect(body).not.toContain("screenshot-2");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain(TOKEN);
  });

  it("does not fail the filing when closing it afterwards fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGitlab([
      labelsRoute(),
      createRoute(),
      { method: "PUT", path: "/projects/42/issues/7", reply: () => json({ message: "500" }, 500) },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      state: "Closed",
      evidence: [],
    });
    expect(out.identifier).toBe("acme/web#7");
  });

  it("sends one priority label, replacing the one the agent picked from that family", async () => {
    const calls = mockGitlab([labelsRoute(), createRoute()]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      labels: ["bug", "priority::low"],
      priority: "high",
      evidence: [],
    });
    expect(calls.find((c) => c.method === "POST")!.body?.labels).toBe("bug,priority::high");
  });

  it("reads GitLab's numeric priority::1-4 convention", async () => {
    const calls = mockGitlab([
      {
        path: "/projects/42/labels?per_page=100&include_ancestor_groups=true",
        reply: () => json(["priority::1", "priority::2", "priority::3", "priority::4"].map((name, id) => ({ id, name }))),
      },
      createRoute(),
    ]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      priority: "urgent",
      evidence: [],
    });
    expect(calls.find((c) => c.method === "POST")!.body?.labels).toBe("priority::1");
  });

  it("never lets an extra field replace the body or the title", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = mockGitlab([createRoute()]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "Real title",
      descriptionMarkdown: "Real body",
      extraFields: { description: "hijacked", title: "hijacked", labels: "made-up" },
      evidence: [],
    });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.body?.title).toBe("Real title");
    expect(String(create.body?.description).startsWith("Real body")).toBe(true);
    expect(create.body).not.toHaveProperty("labels");
  });

  it("explains a token without the api scope", async () => {
    mockGitlab([
      {
        method: "POST",
        path: "/projects/42/issues",
        reply: () =>
          json(
            {
              error: "insufficient_scope",
              error_description: "The request requires higher privileges than provided by the access token.",
              scope: "api",
            },
            403,
          ),
      },
    ]);
    await expect(
      makeGitlabTracker({ token: TOKEN }).fileIssue({ targetId: "42", title: "t", descriptionMarkdown: "x", evidence: [] }),
    ).rejects.toThrow("Your GitLab connection cannot create issues (it lacks the api scope) - reconnect GitLab under Settings, then retry.");
  });

  it("skips an unknown label and adopts the project's priority label", async () => {
    const calls = mockGitlab([labelsRoute(), createRoute()]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      labels: ["Bug", "no-such-label"],
      priority: "high",
      evidence: [],
    });
    const create = calls.find((c) => c.method === "POST")!;
    // Never sent, because GitLab would create it.
    expect(create.body?.labels).toBe("bug,priority::high");
  });

  it("creates then closes when the state is Closed", async () => {
    const calls = mockGitlab([
      labelsRoute(),
      createRoute(),
      { method: "PUT", path: "/projects/42/issues/7", reply: () => json(issue({ state: "closed" })) },
    ]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      state: "Closed",
      evidence: [],
    });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${API}/projects/42/issues`,
      `PUT ${API}/projects/42/issues/7`,
    ]);
    expect(writes[0].body?.labels).toBeUndefined();
    expect(writes[1].body).toEqual({ state_event: "close" });
  });

  it("sets a status label as the state, with no extra call", async () => {
    const calls = mockGitlab([labelsRoute(), createRoute()]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      labels: ["workflow::Doing"],
      state: "In review",
      evidence: [],
    });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(1);
    // One status per scope: the state wins over a status the agent also labelled.
    expect(writes[0].body?.labels).toBe("workflow::In review");
  });

  it("maps assignee, milestone and the other fields, then posts the comment", async () => {
    const calls = mockGitlab([
      { path: "/projects/42/members/all?per_page=100", reply: () => json(MEMBERS) },
      {
        path: "/projects/42/milestones?state=active&per_page=50&include_ancestors=true",
        reply: () => json(MILESTONES),
      },
      createRoute(),
      { method: "POST", path: "/projects/42/issues/7/notes", reply: () => json({ id: 1, body: "x" }, 201) },
    ]);
    await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      assignee: "@ada",
      comment: "Seen on staging too",
      extraFields: { milestone: "v1.2", due_date: "2026-11-01", weight: 3, confidential: true, issue_type: "incident" },
      evidence: [],
    });
    const create = calls.find((c) => c.url.endsWith("/projects/42/issues"))!;
    expect(create.body).toMatchObject({
      assignee_ids: [12],
      milestone_id: 501,
      due_date: "2026-11-01",
      weight: 3,
      confidential: true,
      issue_type: "incident",
    });
    expect(create.body).not.toHaveProperty("milestone");
    const note = calls.find((c) => c.url.endsWith("/notes"))!;
    expect(note.body).toEqual({ body: "Seen on staging too" });
  });

  it("retries without the extras when GitLab refuses them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempt = 0;
    const calls = mockGitlab([
      {
        method: "POST",
        path: "/projects/42/issues",
        reply: () => (++attempt === 1 ? json({ message: { weight: ["is invalid"] } }, 400) : json(issue(), 201)),
      },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).fileIssue({
      targetId: "42",
      title: "t",
      descriptionMarkdown: "x",
      extraFields: { weight: 3 },
      evidence: [],
    });
    expect(out.identifier).toBe("acme/web#7");
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toHaveProperty("weight", 3);
    expect(calls[1].body).not.toHaveProperty("weight");
  });
});

describe("updateIssue", () => {
  const issueRoute = (labels: string[], state = "opened"): Route => ({
    path: "/projects/acme%2Fweb/issues/7",
    reply: () => json(issue({ labels, state })),
  });
  const putRoute: Route = {
    method: "PUT",
    path: "/projects/acme%2Fweb/issues/7",
    reply: () => json(issue()),
  };

  it("swaps the status label within its scope", async () => {
    const calls = mockGitlab([issueRoute(["bug", "workflow::Doing"]), labelsRoute("acme%2Fweb"), putRoute]);
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", {
      state: "workflow::In review",
    });
    expect(out).toEqual({ ok: true });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ add_labels: "workflow::In review", remove_labels: "workflow::Doing" });
  });

  it("reports an unknown state with the valid ones, and changes nothing", async () => {
    const calls = mockGitlab([issueRoute(["bug"]), labelsRoute("acme%2Fweb"), putRoute]);
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { state: "Shipped" });
    expect(out).toEqual({
      ok: false,
      error: 'Unknown state "Shipped". Valid: Open, workflow::Doing, workflow::In review, Closed',
    });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("closes and reopens through state_event", async () => {
    const calls = mockGitlab([issueRoute([]), labelsRoute("acme%2Fweb"), putRoute]);
    const tracker = makeGitlabTracker({ token: TOKEN });
    expect(await tracker.updateIssue("acme/web#7", { state: "Closed" })).toEqual({ ok: true });
    expect(await tracker.updateIssue("acme/web#7", { state: "open" })).toEqual({ ok: true });
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.body)).toEqual([{ state_event: "close" }, { state_event: "reopen" }]);
  });

  it("swaps priority labels instead of stacking them", async () => {
    const calls = mockGitlab([issueRoute(["bug", "priority::low"]), labelsRoute("acme%2Fweb"), putRoute]);
    await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { priority: "high" });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ add_labels: "priority::high", remove_labels: "priority::low" });
  });

  // Severity, blocker and minor labels sit beside a team's priority labels
  // and mean something else; a priority change must leave them on.
  it("removes only the chosen priority label's own family", async () => {
    const onIssue = ["bug", "blocker", "severity::critical", "minor", "priority::low"];
    const calls = mockGitlab([
      issueRoute(onIssue),
      {
        path: "/projects/acme%2Fweb/labels?per_page=100&include_ancestor_groups=true",
        reply: () => json([...onIssue, "priority::high"].map((name, id) => ({ id, name }))),
      },
      putRoute,
    ]);
    await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { priority: "high" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      add_labels: "priority::high",
      remove_labels: "priority::low",
    });
  });

  it("swaps an unscoped P-number only for another P-number", async () => {
    const calls = mockGitlab([
      issueRoute(["P2", "minor", "blocker"]),
      {
        path: "/projects/acme%2Fweb/labels?per_page=100&include_ancestor_groups=true",
        reply: () => json(["P0", "P1", "P2", "minor", "blocker"].map((name, id) => ({ id, name }))),
      },
      putRoute,
    ]);
    await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { priority: "high" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ add_labels: "P1", remove_labels: "P2" });
  });

  it("swaps numeric priority::N labels", async () => {
    const calls = mockGitlab([
      issueRoute(["bug", "priority::2"]),
      {
        path: "/projects/acme%2Fweb/labels?per_page=100&include_ancestor_groups=true",
        reply: () => json(["bug", "priority::1", "priority::2", "priority::3", "priority::4"].map((name, id) => ({ id, name }))),
      },
      putRoute,
    ]);
    await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { priority: "low" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      add_labels: "priority::4",
      remove_labels: "priority::2",
    });
  });

  it("reopens a closed issue that is given a status label", async () => {
    const calls = mockGitlab([issueRoute(["workflow::Doing"], "closed"), labelsRoute("acme%2Fweb"), putRoute]);
    await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { state: "In review" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      state_event: "reopen",
      add_labels: "workflow::In review",
      remove_labels: "workflow::Doing",
    });
  });

  it("rejects fields it does not offer, so nothing can overwrite the body", async () => {
    const calls = mockGitlab([putRoute]);
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", {
      extraFields: { description: "replaced" },
    });
    expect(out).toEqual({
      ok: false,
      error: 'Unknown field "description". Valid: milestone, due_date, weight, confidential, issue_type',
    });
    expect(calls).toHaveLength(0);
  });

  it("clears the milestone and the due date", async () => {
    const calls = mockGitlab([putRoute]);
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", {
      extraFields: { milestone: null, due_date: null },
    });
    expect(out).toEqual({ ok: true });
    // No milestone lookup is needed to clear one.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ milestone_id: 0, due_date: null });
  });

  it("tells the agent to reconnect when the token has expired", async () => {
    mockGitlab([{ method: "PUT", path: "/projects/acme%2Fweb/issues/7", reply: () => json({ message: "401 Unauthorized" }, 401) }]);
    expect(await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", { title: "x" })).toEqual({
      ok: false,
      error: "Your GitLab connection has expired - reconnect GitLab under Settings, then retry.",
    });
  });

  it("adds labels, assigns and sets fields in one call", async () => {
    const calls = mockGitlab([
      labelsRoute("acme%2Fweb"),
      { path: "/projects/acme%2Fweb/members/all?per_page=100", reply: () => json(MEMBERS) },
      {
        path: "/projects/acme%2Fweb/milestones?state=active&per_page=50&include_ancestors=true",
        reply: () => json(MILESTONES),
      },
      putRoute,
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/web#7", {
      title: "Cart save fails",
      labels: ["bug"],
      assignee: "Ada Lovelace (@ada)",
      extraFields: { milestone: "v1", due_date: "2026-11-01T00:00:00Z" },
    });
    expect(out).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      title: "Cart save fails",
      add_labels: "bug",
      assignee_ids: [12],
      milestone_id: 501,
      due_date: "2026-11-01",
    });
  });

  it("reports unknown labels, assignees and milestones with the valid options", async () => {
    mockGitlab([
      labelsRoute("acme%2Fweb"),
      { path: "/projects/acme%2Fweb/members/all?per_page=100", reply: () => json(MEMBERS) },
      {
        path: "/projects/acme%2Fweb/milestones?state=active&per_page=50&include_ancestors=true",
        reply: () => json(MILESTONES),
      },
    ]);
    const tracker = makeGitlabTracker({ token: TOKEN });
    expect(await tracker.updateIssue("acme/web#7", { labels: ["frontend"] })).toEqual({
      ok: false,
      error: 'Unknown label "frontend". Valid: bug, priority::high, priority::low, workflow::Doing, workflow::In review',
    });
    // The bot and the blocked member are not offered.
    expect(await tracker.updateIssue("acme/web#7", { assignee: "grace" })).toEqual({
      ok: false,
      error: 'Unknown assignee "grace". Valid: Ada Lovelace (@ada)',
    });
    expect(await tracker.updateIssue("acme/web#7", { extraFields: { milestone: "v9" } })).toEqual({
      ok: false,
      error: 'Unknown milestone "v9". Valid: v1.2',
    });
  });

  it("addresses a nested project by its encoded path", async () => {
    const calls = mockGitlab([
      { method: "PUT", path: "/projects/acme%2Fplatform%2Fweb/issues/12", reply: () => json(issue()) },
    ]);
    expect(await makeGitlabTracker({ token: TOKEN }).updateIssue("acme/platform/web#12", { title: "x" })).toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("rejects an identifier that is not a GitLab ref", async () => {
    const out = await makeGitlabTracker({ token: TOKEN }).updateIssue("PROJ-42", { title: "x" });
    expect(out.ok).toBe(false);
  });
});

describe("getIssue", () => {
  it("reads back the fields the agent can set", async () => {
    mockGitlab([
      {
        path: "/projects/acme%2Fweb/issues/7",
        reply: () =>
          json(
            issue({
              labels: ["bug", "priority::high", "workflow::In review"],
              assignees: [{ id: 12, username: "ada", name: "Ada Lovelace", avatar_url: null }],
              milestone: { id: 501, title: "v1.2" },
              due_date: "2026-11-01",
            }),
          ),
      },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getIssue("acme/web#7");
    expect(out).toMatchObject({
      identifier: "acme/web#7",
      title: "Save button does nothing",
      state: "workflow::In review",
      labels: ["bug", "priority::high", "workflow::In review"],
      assignees: ["Ada Lovelace (@ada)"],
      milestone: "v1.2",
      url: "https://gitlab.com/acme/web/-/issues/7",
      priority: "high",
      due_date: "2026-11-01",
    });
  });

  it("derives priority from GitLab's numeric convention", async () => {
    mockGitlab([{ path: "/projects/acme%2Fweb/issues/7", reply: () => json(issue({ labels: ["priority::3"] })) }]);
    expect((await makeGitlabTracker({ token: TOKEN }).getIssue("acme/web#7")).priority).toBe("medium");
  });

  it("says the connection expired on a 401", async () => {
    mockGitlab([{ path: "/projects/acme%2Fweb/issues/7", reply: () => json({ message: "401 Unauthorized" }, 401) }]);
    await expect(makeGitlabTracker({ token: TOKEN }).getIssue("acme/web#7")).rejects.toThrow(
      "Your GitLab connection has expired - reconnect GitLab under Settings, then retry.",
    );
  });
});

describe("getLiveIssues", () => {
  it("reads found issues, confirms a deletion, and never calls an unreachable project's issues gone", async () => {
    const calls = mockGitlab([
      {
        path: "/projects/acme%2Fweb/issues?iids[]=1&iids[]=2&per_page=100",
        reply: () =>
          json([
            issue({
              iid: 1,
              labels: ["workflow::In review"],
              assignees: [{ id: 12, username: "ada", name: "Ada Lovelace", avatar_url: "https://gitlab.com/ada.png" }],
              // The project was renamed since filing: the identifier follows it.
              references: { short: "#1", relative: "#1", full: "acme/web-app#1" },
              web_url: "https://gitlab.com/acme/web-app/-/issues/1",
            }),
          ]),
      },
      { path: "/projects/acme%2Fweb", reply: () => json({ id: 42, path_with_namespace: "acme/web-app" }) },
      { path: "/projects/acme%2Fweb/issues/2", reply: () => notFound() },
      { path: "/projects/lost%2Fproj/issues?iids[]=5&per_page=100", reply: () => notFound("Project Not Found") },
    ]);

    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(["acme/web#1", "acme/web#2", "lost/proj#5"]);

    expect(out.gone).toEqual(["acme/web#2"]);
    expect(out.issues["acme/web#1"]).toEqual({
      identifier: "acme/web-app#1",
      title: "Save button does nothing",
      url: "https://gitlab.com/acme/web-app/-/issues/1",
      stateName: "In review",
      stateColor: STATUS_COLOR.active,
      createdAt: "2026-10-13T09:00:00.000Z",
      assignee: { name: "Ada Lovelace", avatarUrl: "https://gitlab.com/ada.png" },
    });
    expect(out.issues["lost/proj#5"]).toBeUndefined();
    // The unreachable project was asked once, and nothing about it was guessed.
    expect(calls.filter((c) => c.url.includes("lost%2Fproj"))).toHaveLength(1);
  });

  it("does not call an issue gone when its project stops answering", async () => {
    mockGitlab([
      { path: "/projects/acme%2Fweb/issues?iids[]=2&per_page=100", reply: () => json([]) },
      { path: "/projects/acme%2Fweb", reply: () => json({ message: "503" }, 503) },
      { path: "/projects/acme%2Fweb/issues/2", reply: () => notFound() },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(["acme/web#2"]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });

  it("shows a closed issue as Closed, whatever its labels", async () => {
    mockGitlab([
      {
        path: "/projects/acme%2Fweb/issues?iids[]=3&per_page=100",
        reply: () => json([issue({ iid: 3, state: "closed", labels: ["workflow::Doing"] })]),
      },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(["acme/web#3"]);
    expect(out.issues["acme/web#3"]).toMatchObject({ stateName: "Closed", stateColor: STATUS_COLOR.done });
  });

  // getIssue keeps "workflow::In review" for the agent; the feed shows the value.
  it("shows the status label's value, and a palette color for every issue", async () => {
    mockGitlab([
      {
        path: "/projects/acme%2Fweb/issues?iids[]=1&iids[]=2&iids[]=3&iids[]=4&per_page=100",
        reply: () =>
          json([
            issue({ iid: 1, labels: ["bug", "workflow::In review"] }),
            issue({ iid: 2, labels: ["workflow::Done"] }),
            issue({ iid: 3, labels: ["status::Backlog"] }),
            issue({ iid: 4, labels: ["bug"] }),
          ]),
      },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues([
      "acme/web#1",
      "acme/web#2",
      "acme/web#3",
      "acme/web#4",
    ]);
    const shown = Object.fromEntries(
      Object.entries(out.issues).map(([id, i]) => [id, [i.stateName, i.stateColor]]),
    );
    expect(shown).toEqual({
      "acme/web#1": ["In review", STATUS_COLOR.active],
      "acme/web#2": ["Done", STATUS_COLOR.done],
      "acme/web#3": ["Backlog", STATUS_COLOR.neutral],
      "acme/web#4": ["Open", STATUS_COLOR.active],
    });
  });

  it("keeps an issue the list omitted but the per-issue read still finds", async () => {
    mockGitlab([
      // The list filters some work item types out; the issue itself still exists.
      { path: "/projects/acme%2Fweb/issues?iids[]=2&per_page=100", reply: () => json([]) },
      { path: "/projects/acme%2Fweb", reply: () => json({ id: 42, path_with_namespace: "acme/web" }) },
      { path: "/projects/acme%2Fweb/issues/2", reply: () => json(issue({ iid: 2 })) },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(["acme/web#2"]);
    expect(out.gone).toEqual([]);
    expect(out.issues["acme/web#2"]).toMatchObject({ identifier: "acme/web#2", stateName: "Open" });
  });

  it("reads more than 50 issues of one project in batches of 50", async () => {
    const iids = Array.from({ length: 60 }, (_, i) => i + 1);
    const listPath = (part: number[]) =>
      `/projects/acme%2Fweb/issues?${part.map((n) => `iids[]=${n}`).join("&")}&per_page=100`;
    const calls = mockGitlab([
      { path: listPath(iids.slice(0, 50)), reply: () => json(iids.slice(0, 50).map((iid) => issue({ iid }))) },
      { path: listPath(iids.slice(50)), reply: () => json(iids.slice(50).map((iid) => issue({ iid }))) },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(iids.map((n) => `acme/web#${n}`));
    expect(calls).toHaveLength(2);
    expect(Object.keys(out.issues)).toHaveLength(60);
    expect(out.gone).toEqual([]);
  });

  it("survives an outage with nothing gone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("network down"))));
    const out = await makeGitlabTracker({ token: TOKEN }).getLiveIssues(["acme/web#1"]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });
});

const PROJECTS_PATH =
  "/projects?membership=true&min_access_level=20&archived=false&with_issues_enabled=true&order_by=last_activity_at&per_page=100";

function project(id: number, path: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: path.split("/").at(-1),
    name_with_namespace: path.split("/").join(" / "),
    path,
    path_with_namespace: path,
    description: null,
    topics: [],
    web_url: `https://gitlab.com/${path}`,
    last_activity_at: "2026-10-13T09:00:00.000Z",
    ...over,
  };
}

describe("listTargets", () => {
  it("maps projects and follows the next page, once per tracker", async () => {
    const calls = mockGitlab([
      {
        path: PROJECTS_PATH,
        reply: () =>
          json([project(42, "acme/web", { description: "The storefront", topics: ["shop", "nextjs"] })], 200, {
            "x-next-page": "2",
          }),
      },
      { path: `${PROJECTS_PATH}&page=2`, reply: () => json([project(43, "acme/api")], 200, { "x-next-page": "" }) },
    ]);
    const tracker = makeGitlabTracker({ token: TOKEN });
    // Two callers at once share one listing.
    const [targets] = await Promise.all([tracker.listTargets(), tracker.listTargets()]);
    expect(targets).toEqual([
      { id: "42", key: "acme/web", name: "acme / web", description: "The storefront. Topics: shop, nextjs" },
      { id: "43", key: "acme/api", name: "acme / api", description: undefined },
    ]);
    await tracker.listTargets();
    expect(calls).toHaveLength(2);
  });
});

describe("getTargetDetails", () => {
  it("offers status labels as states, members by name and handle, and GitLab's fields", async () => {
    mockGitlab([
      { path: PROJECTS_PATH, reply: () => json([project(42, "acme/web", { description: "The storefront" })]) },
      labelsRoute(),
      { path: "/projects/42/members/all?per_page=100", reply: () => json(MEMBERS) },
      { path: "/projects/42/milestones?state=active&per_page=50&include_ancestors=true", reply: () => json(MILESTONES) },
    ]);
    const d = await makeGitlabTracker({ token: TOKEN }).getTargetDetails("42");
    expect(d).toMatchObject({
      id: "42",
      key: "acme/web",
      name: "acme / web",
      description: "The storefront",
      states: ["Open", "workflow::Doing", "workflow::In review", "Closed"],
      members: ["Ada Lovelace (@ada)"],
    });
    expect(d.customFields?.map((f) => [f.id, f.type])).toEqual([
      ["milestone", "single-select"],
      ["due_date", "date"],
      ["weight", "number"],
      ["confidential", "boolean"],
      ["issue_type", "single-select"],
    ]);
    expect(d.customFields?.find((f) => f.id === "milestone")?.allowedValues).toEqual(["v1.2"]);
    expect(d.customFields?.find((f) => f.id === "issue_type")?.allowedValues).toEqual(["issue", "incident"]);
  });

  it("looks up a project passed by path when it is not in the listing", async () => {
    const calls = mockGitlab([
      { path: PROJECTS_PATH, reply: () => json([project(42, "acme/web")]) },
      { path: "/projects/acme%2Fother", reply: () => json(project(77, "acme/other")) },
      labelsRoute("77"),
    ]);
    const d = await makeGitlabTracker({ token: TOKEN }).getTargetDetails("acme/other");
    expect(d).toMatchObject({ id: "77", key: "acme/other" });
    expect(calls.some((c) => c.url.endsWith("/projects/77/labels?per_page=100&include_ancestor_groups=true"))).toBe(true);
  });

  it("finds a listed project by path without asking again", async () => {
    const calls = mockGitlab([{ path: PROJECTS_PATH, reply: () => json([project(42, "acme/web")]) }]);
    const d = await makeGitlabTracker({ token: TOKEN }).getTargetDetails("ACME/web");
    expect(d.id).toBe("42");
    expect(calls.some((c) => c.url === `${API}/projects/ACME%2Fweb`)).toBe(false);
  });

  it("surfaces a failed lookup as itself, not as a bad id", async () => {
    mockGitlab([
      { path: PROJECTS_PATH, reply: () => json([project(42, "acme/web")]) },
      { path: "/projects/acme%2Fother", reply: () => json({ message: "500 Internal Server Error" }, 500) },
    ]);
    await expect(makeGitlabTracker({ token: TOKEN }).getTargetDetails("acme/other")).rejects.toThrow(
      /^GitLab \/projects\/acme%2Fother failed: 500/,
    );
  });

  it("names the known projects when the id is wrong", async () => {
    mockGitlab([{ path: PROJECTS_PATH, reply: () => json([project(42, "acme/web")]) }]);
    await expect(makeGitlabTracker({ token: TOKEN }).getTargetDetails("999")).rejects.toThrow(
      /"999" is not a project id\. Known projects: acme\/web \(id: 42\)/,
    );
  });
});

describe("searchIssues", () => {
  it("searches the user's own projects, never all of gitlab.com", async () => {
    const calls = mockGitlab([
      { path: PROJECTS_PATH, reply: () => json([project(42, "acme/web"), project(43, "acme/api")]) },
      {
        path: "/projects/42/issues?search=save%20button&per_page=10&order_by=updated_at",
        reply: () =>
          json([
            issue({
              iid: 1,
              labels: ["bug", "priority::high"],
              assignees: [{ id: 12, username: "ada", name: "Ada Lovelace" }],
              updated_at: "2026-10-12T00:00:00.000Z",
            }),
          ]),
      },
      {
        path: "/projects/43/issues?search=save%20button&per_page=10&order_by=updated_at",
        reply: () =>
          json([
            issue({
              iid: 4,
              state: "closed",
              labels: ["priority::1"],
              updated_at: "2026-10-13T00:00:00.000Z",
              references: { full: "acme/api#4" },
              web_url: "https://gitlab.com/acme/api/-/issues/4",
            }),
          ]),
      },
    ]);
    const out = await makeGitlabTracker({ token: TOKEN }).searchIssues("save button");
    expect(calls.some((c) => c.url.startsWith(`${API}/issues`))).toBe(false);
    // Newest first across projects.
    expect(out).toEqual([
      {
        identifier: "acme/api#4",
        title: "Save button does nothing",
        url: "https://gitlab.com/acme/api/-/issues/4",
        target: "acme/api",
        state: "Closed",
        labels: ["priority::1"],
        assignee: undefined,
        priority: "urgent",
      },
      {
        identifier: "acme/web#1",
        title: "Save button does nothing",
        url: "https://gitlab.com/acme/web/-/issues/1",
        target: "acme/web",
        state: "Open",
        labels: ["bug", "priority::high"],
        assignee: "Ada Lovelace",
        priority: "high",
      },
    ]);
  });

  it("returns [] when GitLab fails", async () => {
    mockGitlab([{ path: PROJECTS_PATH, reply: () => json({ message: "401 Unauthorized" }, 401) }]);
    expect(await makeGitlabTracker({ token: TOKEN }).searchIssues("save")).toEqual([]);
  });
});

describe("listGitlabGroups", () => {
  it("lists the top-level groups the token belongs to, on the configured host", async () => {
    const base = "https://gitlab.acme.test/api/v4";
    const calls = mockGitlab(
      [
        {
          path: "/groups?min_access_level=10&top_level_only=true&per_page=100",
          reply: () =>
            json([
              { id: 7, name: "Acme", full_name: "Acme", path: "acme", avatar_url: "https://gitlab.acme.test/a.png" },
              { id: 8, name: "Side", full_name: "Side", path: "side", avatar_url: null },
            ]),
        },
      ],
      base,
    );
    expect(await listGitlabGroups({ token: TOKEN, baseUrl: "https://gitlab.acme.test/" })).toEqual([
      { id: "7", name: "Acme", avatarUrl: "https://gitlab.acme.test/a.png" },
      { id: "8", name: "Side", avatarUrl: undefined },
    ]);
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("returns [] on failure", async () => {
    mockGitlab([]);
    expect(await listGitlabGroups({ token: TOKEN })).toEqual([]);
  });
});
