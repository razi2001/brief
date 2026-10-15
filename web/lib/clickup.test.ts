import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClickUpBody,
  clickupAuthHeader,
  clickupFieldDisplay,
  clickupFieldValue,
  clickupPriorityName,
  clickupStatusColor,
  isClickUpTaskMissing,
  listClickUpWorkspaces,
  makeClickUpTracker,
} from "@/lib/clickup";
import { BRIEF_ATTRIBUTION, STATUS_COLOR } from "@/lib/tracker";

const API = "https://api.clickup.com/api/v2";

type Call = { url: string; path: string; method: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub fetch with a router over the API path; every call is recorded. */
function stubFetch(route: (c: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c = {
        url,
        path: url.startsWith(API) ? url.slice(API.length) : url,
        method: (init.method ?? "GET").toUpperCase(),
        init,
      };
      calls.push(c);
      return route(c);
    }),
  );
  return calls;
}

const bodyOf = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

// Envelopes shaped after the ClickUp API v2 reference.
const STATUSES = [
  { status: "to do", orderindex: 0, color: "#d3d3d3", type: "open" },
  { status: "in progress", orderindex: 1, color: "#4194f6", type: "custom" },
  { status: "complete", orderindex: 2, color: "#6bc950", type: "closed" },
];
const SPACE = { id: "790", name: "Engineering", private: false, multiple_assignees: true };
const LIST_BUGS = {
  id: "124",
  name: "Bugs",
  orderindex: 0,
  content: "Customer-facing defects",
  status: null,
  priority: null,
  assignee: null,
  task_count: 3,
  archived: false,
  override_statuses: false,
  space: { id: "790", name: "Engineering", access: true },
  statuses: STATUSES,
  permission_level: "create",
};
const LIST_INBOX = {
  id: "125",
  name: "Inbox",
  content: "",
  folder: { id: "456", name: "hidden", hidden: true, access: true },
  space: { id: "790", name: "Engineering", access: true },
  archived: false,
};
const MEMBERS = [
  { id: 183, username: "Ada Lovelace", email: "ada@acme.test", color: "#7b68ee", initials: "AL" },
  { id: 184, username: "Grace Hopper", email: "grace@acme.test", color: "#ff0000", initials: "GH" },
];
const ENV_FIELD = {
  id: "f-env",
  name: "Environment",
  type: "drop_down",
  type_config: {
    options: [
      { id: "o1", name: "Production", color: "#ff0000", orderindex: 0 },
      { id: "o2", name: "Staging", color: "#00ff00", orderindex: 1 },
    ],
  },
  date_created: "1566400407303",
  hide_from_guests: false,
  required: false,
};

function task(over: Record<string, unknown> = {}) {
  return {
    id: "86b1x2y3z",
    custom_id: null,
    name: "Save fails on profile page",
    text_content: "",
    description: "",
    status: { status: "to do", color: "#d3d3d3", orderindex: 0, type: "open" },
    orderindex: "1.00000000000000000000000000000000",
    date_created: "1760000000000",
    date_updated: "1760000000000",
    date_closed: null,
    creator: { id: 183, username: "Ada Lovelace", color: "#7b68ee", profilePicture: null },
    assignees: [],
    tags: [],
    parent: null,
    priority: null,
    due_date: null,
    list: { id: "124", name: "Bugs", access: true },
    folder: { id: "457", name: "Sprint 1", hidden: false, access: true },
    space: { id: "790" },
    url: "https://app.clickup.com/t/86b1x2y3z",
    ...over,
  };
}

/** The workspace tree: one space, one folder with Bugs, one folderless Inbox. */
function treeRoute(c: Call): Response | undefined {
  if (c.path === "/team") {
    return json({
      teams: [
        { id: "9001", name: "Acme", color: "#000000", avatar: null, members: [] },
        { id: "9002", name: "Side project", color: "#000000", avatar: null, members: [] },
      ],
    });
  }
  if (/^\/team\/\d+\/space\?archived=false$/.test(c.path)) return json({ spaces: [SPACE] });
  if (c.path === "/space/790/folder?archived=false") {
    return json({
      folders: [
        {
          id: "457",
          name: "Sprint 1",
          orderindex: 0,
          override_statuses: false,
          hidden: false,
          space: { id: "790", name: "Engineering" },
          task_count: "3",
          lists: [LIST_BUGS],
        },
      ],
    });
  }
  if (c.path === "/space/790/list?archived=false") return json({ lists: [LIST_INBOX] });
  return undefined;
}

describe("clickupPriorityName", () => {
  it("maps ClickUp's 1-4 back to our normalized names", () => {
    expect(clickupPriorityName(1)).toBe("urgent");
    expect(clickupPriorityName(2)).toBe("high");
    expect(clickupPriorityName(3)).toBe("medium");
    expect(clickupPriorityName(4)).toBe("low");
  });

  it("unwraps the object form the task API actually returns", () => {
    // GET /task answers with {priority: {priority: "2", color: ...}}, not a number.
    expect(clickupPriorityName({ priority: "2" })).toBe("high");
  });

  it("reads the documented task shape, where `priority` is ClickUp's name for it", () => {
    expect(clickupPriorityName({ id: "1", priority: "urgent", color: "#f50000", orderindex: "1" })).toBe("urgent");
    // ClickUp calls our "medium" normal.
    expect(clickupPriorityName({ id: "3", priority: "normal", color: "#6fddff", orderindex: "3" })).toBe("medium");
  });

  it("returns null when no priority is set", () => {
    expect(clickupPriorityName(null)).toBeNull();
    expect(clickupPriorityName(undefined)).toBeNull();
    expect(clickupPriorityName(0)).toBeNull();
  });
});

describe("clickupStatusColor", () => {
  it("colors by the status type ClickUp assigns", () => {
    expect(clickupStatusColor("done")).toBe(STATUS_COLOR.done);
    expect(clickupStatusColor("closed")).toBe(STATUS_COLOR.done);
    expect(clickupStatusColor("custom")).toBe(STATUS_COLOR.active);
    expect(clickupStatusColor("open")).toBe(STATUS_COLOR.neutral);
    expect(clickupStatusColor(undefined)).toBe(STATUS_COLOR.neutral);
  });
});

describe("clickupFieldValue", () => {
  const dropdown = {
    id: "f1",
    name: "Environment",
    type: "drop_down",
    type_config: {
      options: [
        { id: "o1", name: "Production" },
        { id: "o2", name: "Staging" },
      ],
    },
  };

  it("sends a dropdown's option ID, since ClickUp rejects the option text", () => {
    expect(clickupFieldValue(dropdown, "Production")).toBe("o1");
  });

  it("resolves the option fuzzily, the way the agent tends to write it", () => {
    expect(clickupFieldValue(dropdown, "production")).toBe("o1");
    expect(clickupFieldValue(dropdown, "stag")).toBe("o2");
  });

  it("returns undefined for an option that doesn't exist", () => {
    expect(clickupFieldValue(dropdown, "Local")).toBeUndefined();
  });

  it("maps a labels field to the list of matching option ids", () => {
    const labels = {
      id: "f2",
      name: "Teams",
      type: "labels",
      type_config: { options: [{ id: "l1", label: "Billing" }, { id: "l2", label: "Auth" }] },
    };
    expect(clickupFieldValue(labels, ["Billing", "Auth"])).toEqual(["l1", "l2"]);
    expect(clickupFieldValue(labels, ["Nope"])).toBeUndefined();
  });

  it("coerces the scalar types", () => {
    const num = { id: "f3", name: "Count", type: "number" };
    expect(clickupFieldValue(num, "4")).toBe(4);
    expect(clickupFieldValue(num, "four")).toBeUndefined();

    const check = { id: "f4", name: "Regression", type: "checkbox" };
    expect(clickupFieldValue(check, true)).toBe(true);
    expect(clickupFieldValue(check, "false")).toBe(false);
  });

  it("passes an unrecognized field type through untouched", () => {
    const text = { id: "f5", name: "Notes", type: "short_text" };
    expect(clickupFieldValue(text, "hello")).toBe("hello");
  });
});

describe("clickupFieldDisplay", () => {
  it("reads a dropdown's orderindex back as the option name the agent set", () => {
    expect(clickupFieldDisplay({ ...ENV_FIELD, value: 1 })).toBe("Staging");
  });

  it("reads a labels field's option ids back as their labels", () => {
    const labels = {
      id: "f2",
      name: "Teams",
      type: "labels",
      type_config: { options: [{ id: "l1", label: "Billing" }, { id: "l2", label: "Auth" }] },
      value: ["l2"],
    };
    expect(clickupFieldDisplay(labels)).toEqual(["Auth"]);
  });
});

describe("clickupAuthHeader", () => {
  it("sends a personal token raw and an OAuth token as Bearer, per ClickUp's docs", () => {
    expect(clickupAuthHeader("pk_123_ABC")).toBe("pk_123_ABC");
    expect(clickupAuthHeader("81234567_abcdef")).toBe("Bearer 81234567_abcdef");
  });
});

describe("buildClickUpBody", () => {
  const shot = (url: string, caption?: string) => ({ kind: "image" as const, url, caption });
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it("adds one Evidence section, caption directly above each image", () => {
    const body = buildClickUpBody("Saving fails.", [shot("https://cu.test/a.png", "The error toast")], []);
    expect(body).toContain("## Evidence\n\nThe error toast\n\n![Screenshot 1](https://cu.test/a.png)");
    expect(body.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("reuses the agent's own Evidence heading instead of adding a second one", () => {
    const body = buildClickUpBody(
      "Saving fails.\n\n## Evidence\n\nThe toast appears after Save.\n\n## Environment\n\nChrome 141",
      [shot("https://cu.test/a.png")],
      [],
    );
    expect(count(body, /^#{1,6}\s*evidence\s*$/gim)).toBe(1);
    // Inside the Evidence section, not under whatever section came after it.
    expect(body.indexOf("![Screenshot 1]")).toBeGreaterThan(body.indexOf("The toast appears"));
    expect(body.indexOf("![Screenshot 1]")).toBeLessThan(body.indexOf("## Environment"));
  });

  it("treats a bold Evidence label as the heading it becomes", () => {
    const body = buildClickUpBody("**Summary**\n\nSaving fails.\n\n**Evidence**", [shot("https://cu.test/a.png")], []);
    expect(body).toContain("### Summary");
    expect(count(body, /^#{1,6}\s*evidence\s*$/gim)).toBe(1);
  });

  it("ignores an Evidence line inside a code block, and a heading-like comment there", () => {
    const body = buildClickUpBody(
      "Steps:\n\n```bash\n# Evidence\nnpm run dev\n```\n\n## Evidence\n\nToast after Save.\n\n```text\n# not a section\n```\n\n## Environment\n\nChrome 141",
      [shot("https://cu.test/a.png")],
      [],
    );
    // The fenced "# Evidence" is code: the image goes under the real heading,
    // after the fenced "# not a section", and before the next real section.
    expect(count(body, /^## Evidence$/gm)).toBe(1);
    expect(body.indexOf("![Screenshot 1]")).toBeGreaterThan(body.indexOf("# not a section"));
    expect(body.indexOf("![Screenshot 1]")).toBeLessThan(body.indexOf("## Environment"));
    expect(body).toContain("```bash\n# Evidence\nnpm run dev\n```");
  });

  it("calls a recording a Screen recording and appends the logs before the attribution", () => {
    const body = buildClickUpBody(
      "Saving fails.",
      [{ kind: "recording", url: "https://cu.test/r.webm" }],
      [
        { title: "Technical logs: Video 1", markdown: "```text\nPOST /api/save 500\n```" },
        { title: "Technical logs: Video 2", markdown: "   " },
      ],
    );
    expect(body).toContain("**Screen recording:** [Watch the screen recording](https://cu.test/r.webm)");
    expect(body).toContain("### Technical logs: Video 1\n\n```text\nPOST /api/save 500\n```");
    // An empty section is not rendered as a bare heading.
    expect(body).not.toContain("Video 2");
    expect(body.indexOf("## Evidence")).toBeLessThan(body.indexOf("### Technical logs"));
    expect(body.indexOf("### Technical logs")).toBeLessThan(body.indexOf(BRIEF_ATTRIBUTION));
  });
});

describe("workspace scoping", () => {
  it("walks only the picked workspace and never lists every team", async () => {
    const calls = stubFetch((c) => treeRoute(c) ?? json({}, 404));
    const targets = await makeClickUpTracker({ token: "pk_1", teamId: "9001" }).listTargets();

    expect(calls.some((c) => c.path === "/team")).toBe(false);
    expect(calls.filter((c) => c.path.startsWith("/team/")).map((c) => c.path)).toEqual([
      "/team/9001/space?archived=false",
    ]);
    expect(targets.map((t) => [t.id, t.name])).toEqual([
      ["124", "Engineering / Sprint 1 / Bugs"],
      ["125", "Engineering / Inbox"],
    ]);
    expect(targets[0].states).toEqual(["to do", "in progress", "complete"]);
  });

  it("falls back to every workspace when none was picked", async () => {
    const calls = stubFetch((c) => treeRoute(c) ?? json({}, 404));
    await makeClickUpTracker({ token: "pk_1" }).listTargets();
    expect(calls.filter((c) => c.path.startsWith("/team")).map((c) => c.path)).toEqual([
      "/team",
      "/team/9001/space?archived=false",
      "/team/9002/space?archived=false",
    ]);
  });

  it("searches precedent inside the picked workspace only", async () => {
    const calls = stubFetch((c) => {
      if (c.path.startsWith("/team/9001/task")) {
        return json({ tasks: [task(), task({ id: "x2", name: "Unrelated chore" })], last_page: true });
      }
      return json({}, 404);
    });
    const hits = await makeClickUpTracker({ token: "pk_1", teamId: "9001" }).searchIssues("profile save");
    expect(calls.map((c) => c.path)).toEqual([
      "/team/9001/task?page=0&order_by=updated&subtasks=true&include_closed=true",
    ]);
    expect(hits.map((h) => h.identifier)).toEqual(["86b1x2y3z"]);
    expect(hits[0].target).toBe("Bugs");
  });

  it("returns no precedent rather than throwing when search fails", async () => {
    stubFetch(() => json({ err: "boom" }, 500));
    await expect(makeClickUpTracker({ token: "pk_1", teamId: "9001" }).searchIssues("save")).resolves.toEqual([]);
  });

  it("does not cache a walk that lost a space, and surfaces an expired token", async () => {
    let failSpace = true;
    stubFetch((c) => {
      if (c.path === "/space/790/list?archived=false" && failSpace) return json({ err: "x" }, 500);
      return treeRoute(c) ?? json({}, 404);
    });
    const tracker = makeClickUpTracker({ token: "pk_1", teamId: "9001" });
    expect((await tracker.listTargets()).map((t) => t.id)).toEqual(["124"]);
    failSpace = false;
    expect((await tracker.listTargets()).map((t) => t.id)).toEqual(["124", "125"]);

    stubFetch(() => json({ err: "Token invalid", ECODE: "OAUTH_025" }, 401));
    await expect(makeClickUpTracker({ token: "pk_1", teamId: "9001" }).listTargets()).rejects.toThrow(
      /reconnect ClickUp/,
    );

    // A workspace the grant no longer covers is not "no lists" either, and it
    // says which fix applies.
    stubFetch(() => json({ err: "Team not authorized", ECODE: "OAUTH_027" }, 401));
    await expect(makeClickUpTracker({ token: "pk_1", teamId: "9001" }).listTargets()).rejects.toThrow(
      "Your ClickUp connection no longer covers the workspace picked on Settings - reconnect ClickUp and tick that workspace, then retry.",
    );
  });

  it("refuses to file into a list outside the picked workspace", async () => {
    const calls = stubFetch((c) => treeRoute(c) ?? json({}, 404));
    const tracker = makeClickUpTracker({ token: "pk_1", teamId: "9001" });
    await tracker.listTargets();
    await expect(
      tracker.fileIssue({ targetId: "999", title: "x", descriptionMarkdown: "y", evidence: [] }),
    ).rejects.toThrow(
      "ClickUp: list 999 not found. Known lists: Engineering / Sprint 1 / Bugs (id: 124), Engineering / Inbox (id: 125)",
    );
    // Refused before anything was created, and from the cached walk.
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(calls.filter((c) => c.path === "/team/9001/space?archived=false")).toHaveLength(1);
  });
});

describe("getTargetDetails", () => {
  it("offers the space's tags, the list's members and each field's allowed values", async () => {
    stubFetch((c) => {
      if (c.path === "/list/124") return json(LIST_BUGS);
      if (c.path === "/list/124/member") return json({ members: MEMBERS });
      if (c.path === "/list/124/field") return json({ fields: [ENV_FIELD, { id: "f9", name: "Notes", type: "short_text" }] });
      if (c.path === "/space/790/tag") {
        return json({ tags: [{ name: "bug", tag_fg: "#fff", tag_bg: "#f00" }, { name: "regression", tag_fg: "#fff", tag_bg: "#00f" }] });
      }
      return treeRoute(c) ?? json({}, 404);
    });
    const d = await makeClickUpTracker({ token: "pk_1", teamId: "9001" }).getTargetDetails("124");
    expect(d).toEqual({
      id: "124",
      key: "Bugs",
      name: "Engineering / Sprint 1 / Bugs",
      description: "Customer-facing defects",
      states: ["to do", "in progress", "complete"],
      labels: ["bug", "regression"],
      members: ["Ada Lovelace", "Grace Hopper"],
      customFields: [
        { id: "f-env", name: "Environment", type: "drop_down", allowedValues: ["Production", "Staging"] },
        { id: "f9", name: "Notes", type: "short_text", allowedValues: [] },
      ],
    });
  });
});

describe("listClickUpWorkspaces", () => {
  it("maps every workspace the token was granted", async () => {
    const calls = stubFetch(() =>
      json({
        teams: [
          { id: "9001", name: "Acme", color: "#000000", avatar: "https://cu.test/acme.png", members: [] },
          { id: "9002", name: "Side project", color: "#000000", avatar: null, members: [] },
        ],
      }),
    );
    expect(await listClickUpWorkspaces("81234567_oauth")).toEqual([
      { id: "9001", name: "Acme", avatarUrl: "https://cu.test/acme.png" },
      { id: "9002", name: "Side project", avatarUrl: undefined },
    ]);
    expect(calls[0].url).toBe(`${API}/team`);
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer 81234567_oauth");
  });

  it("returns an empty list on any failure", async () => {
    stubFetch(() => json({ err: "Token invalid", ECODE: "OAUTH_025" }, 401));
    expect(await listClickUpWorkspaces("pk_1")).toEqual([]);
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await listClickUpWorkspaces("pk_1")).toEqual([]);
  });
});

describe("fileIssue", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  function filingRoute(
    opts: { reject?: (b: Record<string, unknown>) => boolean; failUpload?: (n: number) => boolean } = {},
  ) {
    let att = 0;
    let tries = 0;
    return (c: Call): Response => {
      if (c.path === "/list/124" && c.method === "GET") return json(LIST_BUGS);
      if (c.path === "/list/124/member") return json({ members: MEMBERS });
      if (c.path === "/list/124/field") return json({ fields: [ENV_FIELD] });
      if (c.path === "/list/124/task" && c.method === "POST") {
        const b = bodyOf(c);
        if (opts.reject?.(b)) return json({ err: "Status does not exist", ECODE: "CRTSK_001" }, 400);
        return json(task({ name: b.name }));
      }
      if (c.path === "/task/86b1x2y3z/attachment") {
        tries += 1;
        if (opts.failUpload?.(tries)) return json({ err: "Upload failed" }, 500);
        att += 1;
        return json({
          id: `ac434d4e-${att}.png`,
          version: "0",
          date: 1569988578766,
          title: `file-${att}`,
          extension: "png",
          thumbnail_small: `https://t9001.p.clickup-attachments.com/t9001/${att}/small.png`,
          thumbnail_large: `https://t9001.p.clickup-attachments.com/t9001/${att}/large.png`,
          url: `https://t9001.p.clickup-attachments.com/t9001/${att}/file`,
        });
      }
      if (c.path === "/task/86b1x2y3z" && c.method === "PUT") return json(task());
      if (c.path === "/task/86b1x2y3z/comment") return json({ id: "458", hist_id: "26508", date: 1568036964079 });
      return treeRoute(c) ?? json({ err: "unexpected" }, 404);
    };
  }

  it("creates with the text body, uploads evidence, then embeds it under one Evidence heading", async () => {
    const calls = stubFetch(filingRoute());
    const res = await makeClickUpTracker({ token: "pk_1", teamId: "9001" }).fileIssue({
      targetId: "124",
      title: "Save fails on profile page",
      descriptionMarkdown:
        "**Summary**\n\nSaving the profile fails.\n\n## Evidence\n\nThe toast after Save.\n\n## Environment\n\nChrome 141",
      evidence: [
        { filename: "frame-02.jpg", contentType: "image/jpeg", bytes: PNG, caption: "The error toast" },
        { filename: "replay.webm", contentType: "video/webm", bytes: PNG },
      ],
      details: [{ title: "Technical logs: Video 1", markdown: "```text\nPOST /api/profile 500\n```" }],
    });

    expect(res).toEqual({
      id: "86b1x2y3z",
      identifier: "86b1x2y3z",
      url: "https://app.clickup.com/t/86b1x2y3z",
      title: "Save fails on profile page",
    });

    // 1. The create carries the text-only body: logs, then attribution, no evidence yet.
    const create = calls.find((c) => c.path === "/list/124/task")!;
    const created = bodyOf(create);
    expect(created.name).toBe("Save fails on profile page");
    expect(created.markdown_description).toBe(created.markdown_content);
    const first = String(created.markdown_description);
    expect(first).toContain("### Technical logs: Video 1\n\n```text\nPOST /api/profile 500\n```");
    expect(first.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
    expect(first).not.toContain("![Screenshot");

    // 2. Each file is uploaded under a plain name, never its capture name.
    const uploads = calls.filter((c) => c.path === "/task/86b1x2y3z/attachment");
    expect(uploads.map((c) => c.method)).toEqual(["POST", "POST"]);
    const names = uploads.map((c) => ((c.init.body as FormData).get("attachment") as File).name);
    expect(names).toEqual(["screenshot-1.jpg", "screen-recording.webm"]);

    // 3. The rewrite embeds them inside the agent's own Evidence section.
    const put = calls.find((c) => c.path === "/task/86b1x2y3z" && c.method === "PUT")!;
    const final = String(bodyOf(put).markdown_description);
    expect(bodyOf(put).markdown_content).toBe(final);
    expect((final.match(/^#{1,6}\s*evidence\s*$/gim) ?? []).length).toBe(1);
    expect(final).toContain(
      "The error toast\n\n![Screenshot 1](https://t9001.p.clickup-attachments.com/t9001/1/file)",
    );
    expect(final).toContain(
      "**Screen recording:** [Watch the screen recording](https://t9001.p.clickup-attachments.com/t9001/2/file)",
    );
    expect(final).not.toMatch(/frame-02|replay\.webm/);
    expect(final.indexOf("![Screenshot 1]")).toBeLessThan(final.indexOf("## Environment"));
    expect(final.indexOf("## Environment")).toBeLessThan(final.indexOf("### Technical logs: Video 1"));
    expect(final.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("resolves status, priority, assignee, tags and dropdown fields onto the create", async () => {
    const calls = stubFetch(filingRoute());
    await makeClickUpTracker({ token: "pk_1" }).fileIssue({
      targetId: "124",
      title: "Save fails",
      descriptionMarkdown: "Saving fails.",
      state: "progress",
      priority: "high",
      assignee: "grace@acme.test",
      labels: ["bug"],
      extraFields: { Environment: "prod" },
      comment: "Seen twice today",
      evidence: [],
    });
    const created = bodyOf(calls.find((c) => c.path === "/list/124/task")!);
    expect(created).toMatchObject({
      status: "in progress",
      priority: 2,
      assignees: [184],
      tags: ["bug"],
      custom_fields: [{ id: "f-env", value: "o1" }],
    });
    // No evidence means no second write.
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    const comment = calls.find((c) => c.path === "/task/86b1x2y3z/comment")!;
    expect(bodyOf(comment)).toEqual({ comment_text: "Seen twice today", notify_all: false });
  });

  const RICH = {
    targetId: "124",
    title: "Save fails",
    descriptionMarkdown: "Saving fails.",
    state: "to do",
    priority: "high" as const,
    assignee: "Grace Hopper",
    labels: ["bug"],
    extraFields: { Environment: "Production" },
    evidence: [],
  };
  const keysOf = (c: Call) => Object.keys(bodyOf(c)).sort();
  const BARE = ["markdown_content", "markdown_description", "name"];

  it("drops what a list can refuse first, keeping priority and assignee", async () => {
    const calls = stubFetch(filingRoute({ reject: (b) => !!(b.status || b.tags || b.custom_fields) }));
    const res = await makeClickUpTracker({ token: "pk_1" }).fileIssue(RICH);
    expect(res.identifier).toBe("86b1x2y3z");
    const creates = calls.filter((c) => c.path === "/list/124/task");
    expect(creates.map(keysOf)).toEqual([
      ["assignees", "custom_fields", ...BARE, "priority", "status", "tags"].sort(),
      ["assignees", ...BARE, "priority"].sort(),
    ]);
    expect(bodyOf(creates[1])).toMatchObject({ priority: 2, assignees: [184] });
  });

  it("falls back to the bare create when even priority and assignee are refused", async () => {
    const calls = stubFetch(filingRoute({ reject: (b) => Object.keys(b).length > BARE.length }));
    const res = await makeClickUpTracker({ token: "pk_1" }).fileIssue(RICH);
    expect(res.identifier).toBe("86b1x2y3z");
    const creates = calls.filter((c) => c.path === "/list/124/task");
    expect(creates).toHaveLength(3);
    expect(keysOf(creates[2])).toEqual(BARE);
  });

  it("skips a retry tier that would send the same thing again", async () => {
    const calls = stubFetch(filingRoute({ reject: (b) => !!(b.status || b.tags) }));
    await makeClickUpTracker({ token: "pk_1" }).fileIssue({ ...RICH, priority: undefined, assignee: undefined, extraFields: undefined });
    const creates = calls.filter((c) => c.path === "/list/124/task");
    expect(creates).toHaveLength(2);
    expect(keysOf(creates[1])).toEqual(BARE);
  });

  it("numbers screenshots by successful upload, so the file and the label agree", async () => {
    const calls = stubFetch(filingRoute({ failUpload: (n) => n === 1 }));
    await makeClickUpTracker({ token: "pk_1" }).fileIssue({
      targetId: "124",
      title: "Save fails",
      descriptionMarkdown: "Saving fails.",
      evidence: [
        { filename: "a.png", contentType: "image/png", bytes: PNG, caption: "Lost" },
        { filename: "b.png", contentType: "image/png", bytes: PNG, caption: "Kept" },
      ],
    });
    const names = calls
      .filter((c) => c.path === "/task/86b1x2y3z/attachment")
      .map((c) => ((c.init.body as FormData).get("attachment") as File).name);
    expect(names).toEqual(["screenshot-1.png", "screenshot-1.png"]);
    const final = String(bodyOf(calls.find((c) => c.method === "PUT")!).markdown_description);
    expect(final).toContain("Kept\n\n![Screenshot 1](https://t9001.p.clickup-attachments.com/t9001/1/file)");
    expect(final).not.toContain("Screenshot 2");
    expect(final).not.toContain("Lost");
  });

  it("keeps the text body when an upload fails, and skips the rewrite", async () => {
    const route = filingRoute();
    const calls = stubFetch((c) =>
      c.path === "/task/86b1x2y3z/attachment" ? json({ err: "too large" }, 413) : route(c),
    );
    const res = await makeClickUpTracker({ token: "pk_1" }).fileIssue({
      targetId: "124",
      title: "Save fails",
      descriptionMarkdown: "Saving fails.",
      evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }],
    });
    expect(res.identifier).toBe("86b1x2y3z");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("updateIssue", () => {
  function updateRoute(over: Partial<Record<string, Response>> = {}) {
    return (c: Call): Response => {
      const key = `${c.method} ${c.path}`;
      if (over[key]) return over[key]!;
      if (key === "GET /task/86b1x2y3z") {
        return json(task({ assignees: [{ id: 183, username: "Ada Lovelace", email: "ada@acme.test" }] }));
      }
      if (key === "GET /list/124") return json(LIST_BUGS);
      if (key === "GET /list/124/member") return json({ members: MEMBERS });
      if (key === "GET /list/124/field") return json({ fields: [ENV_FIELD] });
      if (key === "PUT /task/86b1x2y3z") return json(task());
      if (c.method === "POST" && c.path.startsWith("/task/86b1x2y3z/")) return json({});
      return json({ err: "unexpected" }, 404);
    };
  }

  it("reports an unknown status with the valid ones, before writing anything", async () => {
    const calls = stubFetch(updateRoute());
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", {
      title: "New title",
      state: "Shipped",
    });
    expect(res).toEqual({
      ok: false,
      error: 'status "Shipped" not found. Valid statuses for this list: to do, in progress, complete',
    });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("sets status, swaps the assignee, and writes tags and fields on their own endpoints", async () => {
    const calls = stubFetch(updateRoute());
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", {
      state: "complete",
      assignee: "Grace",
      priority: "urgent",
      labels: ["needs triage"],
      extraFields: { "f-env": "Staging" },
    });
    expect(res).toEqual({ ok: true });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(bodyOf(put)).toEqual({
      priority: 1,
      status: "complete",
      assignees: { add: [184], rem: [183] },
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      expect.arrayContaining([
        "POST /task/86b1x2y3z/tag/needs%20triage",
        "POST /task/86b1x2y3z/field/f-env",
      ]),
    );
    expect(bodyOf(calls.find((c) => c.path === "/task/86b1x2y3z/field/f-env")!)).toEqual({ value: "o2" });
  });

  it("says what landed when a later tag write is refused, with the valid tags", async () => {
    stubFetch(
      updateRoute({
        "POST /task/86b1x2y3z/tag/bug": json({ err: "Tag not found", ECODE: "TAGS_001" }, 400),
        "GET /space/790/tag": json({
          tags: [
            { name: "defect", tag_fg: "#fff", tag_bg: "#f00" },
            { name: "regression", tag_fg: "#fff", tag_bg: "#00f" },
          ],
        }),
      }),
    );
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", {
      state: "in progress",
      assignee: "Grace",
      labels: ["bug"],
    });
    expect(res).toEqual({
      ok: false,
      error:
        'Updated status, assignee; refused tag "bug" (400 Tag not found (TAGS_001); valid: defect, regression)',
    });
  });

  it("reports a refused custom-field write with its allowed values", async () => {
    stubFetch(
      updateRoute({
        "POST /task/86b1x2y3z/field/f-env": json({ err: "Value is not a valid option", ECODE: "FIELD_011" }, 400),
      }),
    );
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", {
      title: "Profile save fails",
      extraFields: { Environment: "Production" },
    });
    expect(res).toEqual({
      ok: false,
      error:
        'Updated title; refused field "Environment" (400 Value is not a valid option (FIELD_011); valid: Production, Staging)',
    });
  });

  it("says ClickUp refused when nothing landed", async () => {
    stubFetch(
      updateRoute({ "POST /task/86b1x2y3z/tag/bug": json({ err: "Tag not found", ECODE: "TAGS_001" }, 400) }),
    );
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", { labels: ["bug"] });
    expect(res).toEqual({ ok: false, error: 'ClickUp refused tag "bug" (400 Tag not found (TAGS_001))' });
  });

  it("lists the allowed values for a bad dropdown value", async () => {
    stubFetch(updateRoute());
    const res = await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", {
      extraFields: { Environment: "Local" },
    });
    expect(res).toEqual({
      ok: false,
      error: 'value for "Environment" is not valid. Allowed values: Production, Staging',
    });
  });

  it("says nothing to update for an empty patch", async () => {
    stubFetch(updateRoute());
    expect(await makeClickUpTracker({ token: "pk_1" }).updateIssue("86b1x2y3z", { extraFields: {} })).toEqual({
      ok: false,
      error: "nothing to update",
    });
  });
});

describe("getIssue", () => {
  it("reads back the fields the agent set, dropdowns by name", async () => {
    stubFetch(() =>
      json(
        task({
          status: { status: "in progress", type: "custom" },
          priority: { id: "2", priority: "high", color: "#ffcc00", orderindex: "2" },
          assignees: [{ id: 184, username: "Grace Hopper" }],
          tags: [{ name: "bug", tag_fg: "#fff", tag_bg: "#f00" }],
          custom_fields: [{ ...ENV_FIELD, value: 0 }, { id: "f9", name: "Notes", type: "short_text" }],
        }),
      ),
    );
    const got = await makeClickUpTracker({ token: "pk_1" }).getIssue("86b1x2y3z");
    expect(got).toMatchObject({
      identifier: "86b1x2y3z",
      list: "Bugs",
      state: "in progress",
      stateColor: STATUS_COLOR.active,
      assignee: "Grace Hopper",
      labels: ["bug"],
      priority: "high",
      customFields: { Environment: "Production" },
    });
  });

  it("does not call a missing task an expired connection", async () => {
    stubFetch(() => json({ err: "Team not authorized", ECODE: "OAUTH_027" }, 401));
    const p = makeClickUpTracker({ token: "pk_1" }).getIssue("nope");
    await expect(p).rejects.toThrow(/OAUTH_027/);
    await expect(p).rejects.not.toThrow(/expired/);
  });

  it("does call a revoked token an expired connection", async () => {
    stubFetch(() => json({ err: "Oauth token not found", ECODE: "OAUTH_019" }, 401));
    await expect(makeClickUpTracker({ token: "x" }).getIssue("86b1x2y3z")).rejects.toThrow(
      "Your ClickUp connection has expired - reconnect ClickUp under Settings, then retry.",
    );
  });
});

describe("getLiveIssues", () => {
  it("lists only what ClickUp confirmed deleted as gone", async () => {
    stubFetch((c) => {
      if (c.path === "/task/live1") {
        return json(
          task({
            id: "live1",
            name: "Live one",
            status: { status: "complete", type: "closed" },
            assignees: [{ id: 184, username: "Grace Hopper", profilePicture: "https://cu.test/g.png" }],
          }),
        );
      }
      if (c.path === "/task/dead1") return json({ err: "Task not found, deleted", ECODE: "ITEM_013" }, 404);
      // A bare 404 (a proxy, a wrong route) is not ClickUp saying the task is gone.
      if (c.path === "/task/proxy") return new Response("<html>Not Found</html>", { status: 404 });
      if (c.path === "/task/other") return json({ err: "Team not authorized", ECODE: "OAUTH_027" }, 401);
      if (c.path === "/task/flaky") return json({ err: "Internal" }, 500);
      throw new TypeError("fetch failed");
    });
    const out = await makeClickUpTracker({ token: "pk_1" }).getLiveIssues([
      "live1",
      "dead1",
      "proxy",
      "other",
      "flaky",
      "offline",
      "live1",
    ]);
    expect(out.gone).toEqual(["dead1"]);
    expect(Object.keys(out.issues)).toEqual(["live1"]);
    expect(out.issues.live1).toEqual({
      identifier: "live1",
      title: "Live one",
      url: "https://app.clickup.com/t/86b1x2y3z",
      stateName: "complete",
      stateColor: STATUS_COLOR.done,
      createdAt: new Date(1760000000000).toISOString(),
      assignee: { name: "Grace Hopper", avatarUrl: "https://cu.test/g.png" },
    });
  });

  it("maps a missing profile picture to no avatar", async () => {
    stubFetch(() => json(task({ assignees: [{ id: 183, username: "Ada Lovelace", profilePicture: null }] })));
    const out = await makeClickUpTracker({ token: "pk_1" }).getLiveIssues(["86b1x2y3z"]);
    expect(out.issues["86b1x2y3z"].assignee).toEqual({ name: "Ada Lovelace", avatarUrl: undefined });
  });

  it("stops reading for this sync once ClickUp answers 429, leaving the rest unknown", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
    const calls = stubFetch((c) =>
      c.path === "/task/t1"
        ? json({ err: "Rate limit reached" }, 429)
        : json(task({ id: c.path.slice("/task/".length) })),
    );
    const out = await makeClickUpTracker({ token: "pk_1" }).getLiveIssues(ids);
    // The reads already in flight finish; nothing new is sent after the 429.
    expect(calls.map((c) => c.path)).toEqual(ids.slice(0, 6).map((id) => `/task/${id}`));
    expect(Object.keys(out.issues).sort()).toEqual(["t2", "t3", "t4", "t5", "t6"]);
    expect(out.gone).toEqual([]);
  });
});

describe("isClickUpTaskMissing", () => {
  it("only reads ClickUp's own not-found answer as a deletion", () => {
    expect(isClickUpTaskMissing(404, { err: "Task not found, deleted", ECODE: "ITEM_013" })).toBe(true);
    expect(isClickUpTaskMissing(404, { ECODE: "ITEM_015" })).toBe(true);
    expect(isClickUpTaskMissing(404, { err: "Task not found" })).toBe(true);
    expect(isClickUpTaskMissing(404, null)).toBe(false);
    expect(isClickUpTaskMissing(404, { err: "Not Found" })).toBe(false);
    expect(isClickUpTaskMissing(404, { err: "Route not found", ECODE: "APP_001" })).toBe(false);
    expect(isClickUpTaskMissing(401, { err: "Task not found", ECODE: "ITEM_013" })).toBe(false);
  });
});
