import { afterEach, describe, expect, it, vi } from "vitest";
import { asanaHtml } from "@/lib/asana-html";
import { listAsanaWorkspaces, makeAsanaTracker } from "@/lib/asana";
import { asanaStateColor, evidenceMarkdown, withEvidenceSection } from "@/lib/asana-body";
import { STATUS_COLOR } from "@/lib/tracker";

// ---------------------------------------------------------------------------
// A fake Asana: routes by method + path, records every call.
// ---------------------------------------------------------------------------

const API = "https://app.asana.com/api/1.0";

type Call = {
  method: string;
  path: string;
  json?: { data?: Record<string, unknown> };
  form?: FormData;
  auth: string | null;
};

const ok = (data: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ data, ...extra }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ errors: [{ message, help: "For more information on API status codes..." }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Handler = (c: Call) => Response | undefined;

function stubAsana(...handlers: Handler[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const call: Call = {
        method: init.method ?? "GET",
        path: url.replace(API, ""),
        json: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        form: init.body instanceof FormData ? init.body : undefined,
        auth: new Headers(init.headers).get("Authorization"),
      };
      calls.push(call);
      for (const h of [...handlers, workspace]) {
        const r = h(call);
        if (r) return r;
      }
      return fail(404, `no route for ${call.method} ${call.path}`);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const WS = "1100000000000001";
const PROJECT = "1200000000000001";
const TASK = "1700000000000001";
const PERMALINK = `https://app.asana.com/1/${WS}/project/${PROJECT}/task/${TASK}`;

const SECTIONS = [
  { gid: "1300000000000001", name: "Untitled section" },
  { gid: "1300000000000002", name: "To do" },
  { gid: "1300000000000003", name: "In progress" },
];

const FIELD_SETTINGS = [
  {
    gid: "1450000000000001",
    custom_field: {
      gid: "1400000000000001",
      name: "Priority",
      resource_subtype: "enum",
      enum_options: [
        { gid: "1410000000000001", name: "Low", enabled: true },
        { gid: "1410000000000002", name: "Medium", enabled: true },
        { gid: "1410000000000003", name: "High", enabled: true },
      ],
    },
  },
  {
    gid: "1450000000000002",
    custom_field: { gid: "1400000000000002", name: "Estimate", resource_subtype: "number" },
  },
  {
    gid: "1450000000000003",
    custom_field: {
      gid: "1400000000000003",
      name: "Platform",
      resource_subtype: "enum",
      enum_options: [
        { gid: "1420000000000001", name: "Web", enabled: true },
        { gid: "1420000000000002", name: "Legacy", enabled: false },
      ],
    },
  },
  {
    gid: "1450000000000004",
    custom_field: { gid: "1400000000000004", name: "Found on", resource_subtype: "date" },
  },
  {
    gid: "1450000000000005",
    custom_field: { gid: "1400000000000005", name: "Reviewers", resource_subtype: "people" },
  },
  {
    gid: "1450000000000006",
    custom_field: {
      gid: "1400000000000006",
      name: "Browsers",
      resource_subtype: "multi_enum",
      enum_options: [
        { gid: "1430000000000001", name: "Chrome", enabled: true },
        { gid: "1430000000000002", name: "Safari", enabled: true },
        { gid: "1430000000000003", name: "Firefox", enabled: true },
      ],
    },
  },
];

const TAGS = [
  { gid: "1500000000000001", name: "bug" },
  { gid: "1500000000000002", name: "frontend" },
];

const USERS = [
  { gid: "1600000000000001", name: "Ada Lovelace", email: "ada@example.com" },
  { gid: "1600000000000002", name: "Grace Hopper", email: "grace@example.com" },
];

/** The workspace's projects and the project's metadata, which every test can lean on. */
const workspace: Handler = (c) => {
  if (c.method !== "GET") return undefined;
  if (c.path.startsWith(`/projects?workspace=${WS}&`)) return ok([{ gid: PROJECT, name: "Web app", notes: "" }]);
  if (c.path.startsWith(`/projects/${PROJECT}/sections`)) return ok(SECTIONS);
  if (c.path.startsWith(`/projects/${PROJECT}/custom_field_settings`)) return ok(FIELD_SETTINGS);
  if (c.path.startsWith(`/workspaces/${WS}/tags`)) return ok(TAGS);
  if (c.path.startsWith(`/users?workspace=${WS}`)) return ok(USERS);
  return undefined;
};

/** Creating the task, and every attachment, succeeds. */
function filing(): Handler {
  let att = 0;
  return (c) => {
    if (c.method === "POST" && c.path.startsWith("/tasks?")) {
      return ok({ gid: TASK, resource_type: "task", name: c.json?.data?.name, permalink_url: PERMALINK });
    }
    if (c.method === "POST" && c.path.startsWith("/attachments")) {
      att += 1;
      const gid = `18000000000000${String(att).padStart(2, "0")}`;
      return ok({
        gid,
        resource_type: "attachment",
        permanent_url: `https://app.asana.com/app/asana/-/get_asset?asset_id=${gid}`,
      });
    }
    if (c.method === "PUT" && c.path === `/tasks/${TASK}`) return ok({ gid: TASK, resource_type: "task" });
    if (c.method === "POST" && c.path === `/tasks/${TASK}/stories`) return ok({ gid: "1900000000000001" });
    if (c.method === "POST" && /^\/sections\/\d+\/addTask$/.test(c.path)) return ok({});
    return undefined;
  };
}

/** The token's user, in the given workspaces (for confirming a deletion). */
const me =
  (...workspaces: string[]): Handler =>
  (c) =>
    c.method === "GET" && c.path.startsWith("/users/me")
      ? ok({ gid: "1600000000000001", workspaces: workspaces.map((gid) => ({ gid, resource_type: "workspace" })) })
      : undefined;

const tracker = () => makeAsanaTracker({ token: "tok", workspaceGid: WS });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const base = {
  targetId: PROJECT,
  title: "Save fails on long names",
  descriptionMarkdown: "Saving fails.\n\n**Steps to reproduce**\n1. Open settings\n2. Save",
  evidence: [] as Array<{ filename: string; contentType: string; bytes: Buffer; caption?: string; url?: string }>,
};

const creates = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path.startsWith("/tasks?"));
const uploads = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path.startsWith("/attachments"));

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

describe("fileIssue", () => {
  it("creates the task in the project, then moves it into the resolved section", async () => {
    const calls = stubAsana(filing());
    const out = await tracker().fileIssue({ ...base, state: "progress" });

    const [create] = creates(calls);
    expect(create.path).toBe("/tasks?opt_fields=name,permalink_url");
    expect(create.auth).toBe("Bearer tok");
    expect(create.json?.data).toMatchObject({ name: "Save fails on long names", projects: [PROJECT] });
    // Never create-time memberships: the section is its own best-effort call.
    expect(create.json?.data).not.toHaveProperty("memberships");

    const move = calls.find((c) => c.path === "/sections/1300000000000003/addTask");
    expect(move?.method).toBe("POST");
    expect(move?.json).toEqual({ data: { task: TASK } });
    expect(calls.indexOf(move as Call)).toBeGreaterThan(calls.indexOf(create));
    expect(out).toEqual({ id: TASK, identifier: TASK, url: PERMALINK, title: "Save fails on long names" });
  });

  it("files into the project alone when no section matches", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({ ...base, state: "Triage" });
    expect(creates(calls)[0].json?.data?.projects).toEqual([PROJECT]);
    expect(calls.some((c) => c.path.includes("/addTask"))).toBe(false);
  });

  it("keeps every other extra when the section move fails", async () => {
    const calls = stubAsana(
      (c) => (c.path.endsWith("/addTask") ? fail(403, "Forbidden") : undefined),
      filing(),
    );
    const out = await tracker().fileIssue({
      ...base,
      state: "To do",
      assignee: "Ada",
      labels: ["bug"],
      priority: "high",
      comment: "Seen twice",
    });
    expect(out.identifier).toBe(TASK);
    expect(creates(calls)).toHaveLength(1);
    expect(creates(calls)[0].json?.data).toMatchObject({
      assignee: "1600000000000001",
      tags: ["1500000000000001"],
      custom_fields: { "1400000000000001": "1410000000000003" },
    });
    expect(calls.some((c) => c.path === `/tasks/${TASK}/stories`)).toBe(true);
  });

  it("matches a tag exactly (ignoring case) before any fuzzy match", async () => {
    const calls = stubAsana(
      (c) =>
        c.path.startsWith(`/workspaces/${WS}/tags`)
          ? ok([
              { gid: "1500000000000009", name: "bug-report" },
              { gid: "1500000000000001", name: "Bug" },
            ])
          : undefined,
      filing(),
    );
    await tracker().fileIssue({ ...base, labels: ["BUG"] });
    expect(creates(calls)[0].json?.data?.tags).toEqual(["1500000000000001"]);
  });

  it("writes the notes as Asana rich text ending with the attribution", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue(base);
    const notes = creates(calls)[0].json?.data?.html_notes as string;
    expect(notes).toBe(
      '<body>Saving fails.<h2>Steps to reproduce</h2><ol><li>Open settings</li><li>Save</li></ol><hr/>Reported with <a href="https://cloud.get-brief.app/">Brief</a></body>',
    );
  });

  it("sets priority on the project's Priority field by option gid", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({ ...base, priority: "high" });
    expect(creates(calls)[0].json?.data?.custom_fields).toEqual({ "1400000000000001": "1410000000000003" });
  });

  // Asana's stock Priority field stops at High.
  it("puts an urgent bug on the highest option when there is no urgent one", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({ ...base, priority: "urgent" });
    expect(creates(calls)[0].json?.data?.custom_fields).toEqual({ "1400000000000001": "1410000000000003" });
  });

  it("resolves assignee, existing tags and custom fields by name", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({
      ...base,
      assignee: "grace@example.com",
      labels: ["Bug", "no-such-tag"],
      extraFields: { Estimate: "3", "1400000000000003": "web" },
    });
    expect(creates(calls)[0].json?.data).toMatchObject({
      assignee: "1600000000000002",
      tags: ["1500000000000001"],
      custom_fields: { "1400000000000002": 3, "1400000000000003": "1420000000000001" },
    });
  });

  it("retries without the extras when Asana rejects them, so the filing never fails over one", async () => {
    let n = 0;
    const calls = stubAsana((c) => {
      if (c.method === "POST" && c.path.startsWith("/tasks?") && n++ === 0) {
        return fail(400, "assignee: Not a member of the workspace");
      }
      return undefined;
    }, filing());

    const out = await tracker().fileIssue({ ...base, assignee: "Ada", state: "To do" });

    const [first, second] = creates(calls);
    expect(first.json?.data).toMatchObject({ assignee: "1600000000000001" });
    expect(second.json?.data).toEqual({
      name: base.title,
      html_notes: first.json?.data?.html_notes,
      projects: [PROJECT],
    });
    expect(out.identifier).toBe(TASK);
  });

  it("goes straight to plain-text notes, extras kept, when Asana refuses the rich text", async () => {
    let n = 0;
    const calls = stubAsana((c) => {
      if (c.method === "POST" && c.path.startsWith("/tasks?") && n++ === 0) {
        return fail(400, "html_notes: XML is invalid at line 1, column 42");
      }
      return undefined;
    }, filing());

    await tracker().fileIssue({
      ...base,
      assignee: "Ada",
      evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }],
    });

    const [, plain] = creates(calls);
    expect(creates(calls)).toHaveLength(2);
    expect(plain.json?.data).toEqual({
      name: base.title,
      // No raw markdown: "**Steps to reproduce**" reads as a plain label.
      notes:
        "Saving fails.\n\nSteps to reproduce\n1. Open settings\n2. Save\n\nReported with Brief (https://cloud.get-brief.app/)",
      projects: [PROJECT],
      // The notes were the problem, not the assignee.
      assignee: "1600000000000001",
    });
    // The rich text was refused once already; no second attempt to inline images.
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("drops what each 400 points at, in turn: rich text, then extras", async () => {
    const errors = [
      "html_notes: XML is invalid",
      "assignee: Not a member of the workspace",
    ];
    let n = 0;
    const calls = stubAsana((c) => {
      if (c.method === "POST" && c.path.startsWith("/tasks?") && n < errors.length) {
        return fail(400, errors[n++]);
      }
      return undefined;
    }, filing());

    const out = await tracker().fileIssue({ ...base, assignee: "Ada", labels: ["bug"] });

    const [first, second, third] = creates(calls);
    expect(creates(calls)).toHaveLength(3);
    expect(first.json?.data).toHaveProperty("html_notes");
    expect(first.json?.data).toMatchObject({ assignee: "1600000000000001", tags: ["1500000000000001"] });
    expect(second.json?.data).toHaveProperty("notes");
    expect(second.json?.data).toMatchObject({ assignee: "1600000000000001", tags: ["1500000000000001"] });
    expect(third.json?.data).toEqual({ name: base.title, notes: second.json?.data?.notes, projects: [PROJECT] });
    expect(out.identifier).toBe(TASK);
  });

  it("uploads evidence, then rewrites the notes with the images inline under the agent's Evidence heading", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({
      ...base,
      descriptionMarkdown: "Saving fails.\n\n## Evidence\n\n## Environment\nChrome 140",
      evidence: [
        { filename: "keyframe-00012.png", contentType: "image/png", bytes: PNG, caption: "The form after Save" },
        { filename: "replay.webm", contentType: "video/webm", bytes: Buffer.from("vid"), caption: "Saving, start to end" },
      ],
    });

    // The create carries no images: the attachments don't exist yet.
    expect(creates(calls)[0].json?.data?.html_notes).not.toContain("<img");

    const [shot, rec] = uploads(calls);
    expect(shot.path).toBe("/attachments?opt_fields=permanent_url");
    expect(shot.form?.get("parent")).toBe(TASK);
    expect(shot.form?.get("resource_subtype")).toBe("asana");
    const file = shot.form?.get("file") as File;
    expect(file.name).toBe("screenshot-1.png");
    expect(file.type).toBe("image/png");
    expect((rec.form?.get("file") as File).name).toBe("screen-recording.webm");

    const put = calls.find((c) => c.method === "PUT" && c.path === `/tasks/${TASK}`);
    const notes = put?.json?.data?.html_notes as string;
    expect(notes).toBe(
      "<body>Saving fails.<h2>Evidence</h2>" +
        // An image is a block: its caption sits right above it, no newlines.
        'The form after Save<img data-asana-gid="1800000000000001"/>' +
        "Saving, start to end\n" +
        '<strong>Screen recording:</strong> <a href="https://app.asana.com/app/asana/-/get_asset?asset_id=1800000000000002">Watch the screen recording</a>' +
        "<h2>Environment</h2>Chrome 140" +
        '<hr/>Reported with <a href="https://cloud.get-brief.app/">Brief</a></body>',
    );
    // One Evidence heading, and nothing that says how the report was captured.
    expect(notes.match(/Evidence/g)).toHaveLength(1);
    expect(notes).not.toMatch(/keyframe|replay|\.webm|\.png/);
    // Upload first, rewrite second.
    expect(calls.indexOf(put as Call)).toBeGreaterThan(calls.indexOf(rec));
  });

  it("adds its own Evidence heading when the agent wrote none", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({ ...base, evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }] });
    const notes = calls.find((c) => c.method === "PUT")?.json?.data?.html_notes as string;
    expect(notes).toContain('<h2>Evidence</h2><img data-asana-gid="1800000000000001"/><hr/>Reported with');
  });

  it("keeps the task and reports success when the notes rewrite fails", async () => {
    const calls = stubAsana(
      (c) => (c.method === "PUT" ? fail(400, "html_notes: Unknown attachment") : undefined),
      filing(),
    );
    const out = await tracker().fileIssue({
      ...base,
      evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }],
      comment: "Seen in production",
    });
    expect(out).toEqual({ id: TASK, identifier: TASK, url: PERMALINK, title: base.title });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    // The rest of the filing still happens.
    expect(calls.find((c) => c.path === `/tasks/${TASK}/stories`)?.json).toEqual({
      data: { text: "Seen in production" },
    });
  });

  it("skips an image whose upload failed rather than embedding a missing attachment", async () => {
    let n = 0;
    const calls = stubAsana((c) => {
      if (c.method === "POST" && c.path.startsWith("/attachments") && n++ === 0) return fail(500, "Server Error");
      return undefined;
    }, filing());
    await tracker().fileIssue({
      ...base,
      evidence: [
        { filename: "a.png", contentType: "image/png", bytes: PNG, caption: "lost" },
        { filename: "b.png", contentType: "image/png", bytes: PNG, caption: "kept" },
      ],
    });
    const notes = calls.find((c) => c.method === "PUT")?.json?.data?.html_notes as string;
    expect(notes).not.toContain("lost");
    expect(notes).toContain('kept<img data-asana-gid="1800000000000001"/>');
  });

  it("uploads the technical logs as technical-logs.md, last, and never mentions them", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({
      ...base,
      evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }],
      details: [
        { title: "Video 1", markdown: "GET /api/save 500" },
        { title: "Video 2", markdown: "   " },
        { title: "Video 3", markdown: "console: TypeError" },
      ],
    });

    const all = uploads(calls);
    const last = all[all.length - 1];
    expect(calls[calls.length - 1]).toBe(last);
    const file = last.form?.get("file") as File;
    expect(file.name).toBe("technical-logs.md");
    expect(file.type).toBe("text/markdown");
    expect(await file.text()).toBe("## Video 1\n\nGET /api/save 500\n\n## Video 3\n\nconsole: TypeError\n");

    for (const c of calls.filter((x) => x.json?.data?.html_notes)) {
      expect(c.json?.data?.html_notes).not.toMatch(/technical|logs|Video 1/i);
    }
  });

  it("uploads no log file when every section is empty", async () => {
    const calls = stubAsana(filing());
    await tracker().fileIssue({ ...base, details: [{ title: "Video 1", markdown: "" }] });
    expect(uploads(calls)).toEqual([]);
  });

  // The picked workspace is the org identity: a project gid from another
  // workspace the same person belongs to must never get the ticket.
  it("refuses a project outside the picked workspace, naming the known ones, and creates nothing", async () => {
    const calls = stubAsana((c) => {
      if (c.path.startsWith("/projects/1298?")) return ok({ gid: "1298", name: "Elsewhere", workspace: { gid: "999" } });
      if (c.path.startsWith("/projects/1297?")) return fail(404, "project: Unknown object: 1297");
      return undefined;
    }, filing());

    await expect(tracker().fileIssue({ ...base, targetId: "1298" })).rejects.toThrow(
      `Asana: no project "1298" in this workspace. Known projects: Web app (${PROJECT})`,
    );
    await expect(tracker().fileIssue({ ...base, targetId: "1297" })).rejects.toThrow(
      /no project "1297" in this workspace/,
    );
    expect(creates(calls)).toEqual([]);
  });

  it("files into a project past the listed pages when it reads as this workspace's", async () => {
    const calls = stubAsana((c) => {
      if (c.path.startsWith("/projects/1299?")) {
        return ok({ gid: "1299", name: "Archive", notes: "", workspace: { gid: WS, resource_type: "workspace" } });
      }
      return undefined;
    }, filing());
    await tracker().fileIssue({ ...base, targetId: "1299" });
    expect(creates(calls)[0].json?.data?.projects).toEqual(["1299"]);
  });

  it("checks the project against the cached listing, without a read per filing", async () => {
    const calls = stubAsana(filing());
    const t = tracker();
    await t.listTargets();
    await t.fileIssue(base);
    await t.fileIssue(base);
    expect(calls.filter((c) => c.path.startsWith("/projects?"))).toHaveLength(1);
    expect(calls.some((c) => c.path.startsWith(`/projects/${PROJECT}?`))).toBe(false);
  });

  it("throws when the task itself cannot be created", async () => {
    stubAsana((c) => (c.method === "POST" && c.path.startsWith("/tasks?") ? fail(403, "Forbidden") : undefined));
    await expect(tracker().fileIssue(base)).rejects.toThrow(/Asana task create failed: 403 Forbidden/);
  });
});

// ---------------------------------------------------------------------------
// Updating and reading back
// ---------------------------------------------------------------------------

/** The task lives in PROJECT, in "To do". */
const taskInProject: Handler = (c) =>
  c.method === "GET" && c.path.startsWith(`/tasks/${TASK}?`)
    ? ok({
        gid: TASK,
        projects: [{ gid: PROJECT, name: "Web app" }],
        memberships: [{ project: { gid: PROJECT, name: "Web app" }, section: { gid: SECTIONS[1].gid, name: "To do" } }],
      })
    : undefined;

const writes: Handler = (c) => (c.method === "PUT" || c.method === "POST" ? ok({}) : undefined);

describe("updateIssue", () => {
  it("moves the task into a section of its project, reopening it", async () => {
    const calls = stubAsana(taskInProject, writes);
    expect(await tracker().updateIssue(TASK, { state: "In progress" })).toEqual({ ok: true });
    const move = calls.find((c) => c.path === `/sections/${SECTIONS[2].gid}/addTask`);
    expect(move?.method).toBe("POST");
    expect(move?.json).toEqual({ data: { task: TASK } });
    // A completed task moved back to "In progress" is open again.
    const put = calls.find((c) => c.method === "PUT" && c.path === `/tasks/${TASK}`);
    expect(put?.json).toEqual({ data: { completed: false } });
  });

  it("leaves completion alone when moving into a done-like section", async () => {
    const calls = stubAsana(
      (c) =>
        c.path.startsWith(`/projects/${PROJECT}/sections`)
          ? ok([...SECTIONS, { gid: "1300000000000009", name: "Shipped" }])
          : undefined,
      taskInProject,
      writes,
    );
    expect(await tracker().updateIssue(TASK, { state: "Shipped" })).toEqual({ ok: true });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(calls.some((c) => c.path === "/sections/1300000000000009/addTask")).toBe(true);
  });

  it("completes the task for \"Done\" when the project has no such section", async () => {
    const calls = stubAsana(taskInProject, writes);
    expect(await tracker().updateIssue(TASK, { state: "Done" })).toEqual({ ok: true });
    const put = calls.find((c) => c.method === "PUT" && c.path === `/tasks/${TASK}`);
    expect(put?.json).toEqual({ data: { completed: true } });
    expect(calls.some((c) => c.path.includes("/addTask"))).toBe(false);
  });

  it("reports an unknown section with the valid ones, and writes nothing", async () => {
    const calls = stubAsana(taskInProject, writes);
    const r = await tracker().updateIssue(TASK, { state: "Blocked", title: "New title" });
    expect(r).toEqual({
      ok: false,
      error: 'Unknown section "Blocked". Valid: Untitled section, To do, In progress, or "Done" to complete the task.',
    });
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("updates title, assignee, priority and fields in one PUT, then adds tags", async () => {
    const calls = stubAsana(taskInProject, writes);
    const r = await tracker().updateIssue(TASK, {
      title: "Renamed",
      assignee: "Ada",
      priority: "low",
      labels: ["frontend"],
      extraFields: { Estimate: 5 },
    });
    expect(r).toEqual({ ok: true });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.json).toEqual({
      data: {
        name: "Renamed",
        assignee: "1600000000000001",
        custom_fields: { "1400000000000002": 5, "1400000000000001": "1410000000000001" },
      },
    });
    const tag = calls.find((c) => c.path === `/tasks/${TASK}/addTag`);
    expect(tag?.json).toEqual({ data: { tag: "1500000000000002" } });
  });

  it("reports unknown tags and enum options with the valid values", async () => {
    stubAsana(taskInProject, writes);
    expect(await tracker().updateIssue(TASK, { labels: ["urgent-fix"] })).toEqual({
      ok: false,
      error: "Unknown tags: urgent-fix. Valid: bug, frontend",
    });
    const r = await tracker().updateIssue(TASK, { extraFields: { Platform: "Legacy" } });
    expect(r).toEqual({ ok: false, error: '"Legacy" is not an option of "Platform". Valid: Web.' });
  });

  it("writes a date field as { date } and refuses anything that is not YYYY-MM-DD", async () => {
    const calls = stubAsana(taskInProject, writes);
    expect(await tracker().updateIssue(TASK, { extraFields: { "Found on": "2026-10-12" } })).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "PUT")?.json).toEqual({
      data: { custom_fields: { "1400000000000004": { date: "2026-10-12" } } },
    });
    for (const bad of ["next week", "2026-10-12T09:00:00Z", "2026-02-30", "12/10/2026"]) {
      const r = await tracker().updateIssue(TASK, { extraFields: { "Found on": bad } });
      expect(r, bad).toEqual({ ok: false, error: `"Found on" takes a date like 2026-07-01, not "${bad}".` });
    }
  });

  it("resolves a people field to member gids only", async () => {
    const calls = stubAsana(taskInProject, writes);
    expect(
      await tracker().updateIssue(TASK, { extraFields: { Reviewers: ["Grace", "ada@example.com"] } }),
    ).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "PUT")?.json).toEqual({
      data: { custom_fields: { "1400000000000005": ["1600000000000002", "1600000000000001"] } },
    });

    // Neither "me" nor an email nobody in the workspace has gets through.
    for (const bad of ["me", "stranger@example.com"]) {
      const r = await tracker().updateIssue(TASK, { extraFields: { Reviewers: bad } });
      expect(r.ok, bad).toBe(false);
      expect(r.ok ? "" : r.error).toContain(`no workspace member matched "${bad}" for "Reviewers"`);
    }
  });

  it("resolves a multi-select to option gids, refusing an unknown option", async () => {
    const calls = stubAsana(taskInProject, writes);
    expect(await tracker().updateIssue(TASK, { extraFields: { Browsers: "chrome, Safari" } })).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "PUT")?.json).toEqual({
      data: { custom_fields: { "1400000000000006": ["1430000000000001", "1430000000000002"] } },
    });
    expect(await tracker().updateIssue(TASK, { extraFields: { Browsers: ["Chrome", "Edge"] } })).toEqual({
      ok: false,
      error: '"Edge" is not an option of "Browsers". Valid: Chrome, Safari, Firefox.',
    });
  });

  it("passes Asana's own error back to the agent", async () => {
    stubAsana((c) => (c.method === "PUT" ? fail(400, "name: Too long") : undefined));
    expect(await tracker().updateIssue(TASK, { title: "x" })).toEqual({
      ok: false,
      error: "Asana update failed: 400 name: Too long",
    });
  });

  it("rejects an identifier that is not a task gid", async () => {
    stubAsana();
    const r = await tracker().updateIssue("PROJ-12", { title: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("getIssue", () => {
  it("reads the task back as a flat record", async () => {
    const calls = stubAsana((c) =>
      c.path.startsWith(`/tasks/${TASK}?`)
        ? ok({
            gid: TASK,
            name: "Save fails",
            completed: false,
            permalink_url: PERMALINK,
            assignee: { gid: "1600000000000001", name: "Ada Lovelace" },
            memberships: [{ project: { gid: PROJECT, name: "Web app" }, section: { gid: "1", name: "In progress" } }],
            tags: [{ gid: "1500000000000001", name: "bug" }],
            custom_fields: [
              { gid: "1400000000000001", name: "Priority", display_value: "High" },
              { gid: "1400000000000002", name: "Estimate", display_value: null },
            ],
          })
        : undefined,
    );
    const got = await tracker().getIssue(TASK);
    expect(calls[0].path).toBe(
      `/tasks/${TASK}?opt_fields=name,completed,assignee.name,memberships.section.name,memberships.project.name,tags.name,custom_fields.name,custom_fields.display_value,permalink_url`,
    );
    expect(got).toEqual({
      identifier: TASK,
      title: "Save fails",
      url: PERMALINK,
      state: "In progress",
      completed: false,
      section: "In progress",
      project: "Web app",
      assignee: "Ada Lovelace",
      tags: ["bug"],
      priority: "High",
      customFields: { Priority: "High", Estimate: null },
    });
  });
});

// ---------------------------------------------------------------------------
// Targets, search, live reads, workspaces
// ---------------------------------------------------------------------------

describe("listTargets", () => {
  it("lists the workspace's projects with their team, following pagination", async () => {
    const calls = stubAsana((c) => {
      if (!c.path.startsWith("/projects?")) return undefined;
      if (!c.path.includes("offset=")) {
        return ok([{ gid: "1", name: "Web app", notes: "x".repeat(300), team: { gid: "9", name: "Product" } }], {
          next_page: { offset: "eyJ0eXAiOiJKV1Qi", path: "/projects?offset=eyJ0eXAiOiJKV1Qi", uri: "https://..." },
        });
      }
      return ok([{ gid: "2", name: "Bugs", notes: "" }], { next_page: null });
    });

    const t = tracker();
    const targets = await t.listTargets();
    expect(calls[0].path).toBe(`/projects?workspace=${WS}&archived=false&limit=100&opt_fields=name,notes,team.name`);
    expect(calls[1].path).toContain("&offset=eyJ0eXAiOiJKV1Qi");
    expect(targets).toEqual([
      { id: "1", key: "1", name: "Product / Web app", description: "x".repeat(200) },
      { id: "2", key: "2", name: "Bugs", description: undefined },
    ]);
    // Cached for the rest of the run.
    await t.listTargets();
    expect(calls).toHaveLength(2);
  });
});

describe("getTargetDetails", () => {
  it("collects sections, tags, members and custom fields, each on its own", async () => {
    stubAsana((c) => {
      if (c.path.startsWith("/projects?")) return ok([{ gid: PROJECT, name: "Web app", notes: "The app" }]);
      // A workspace that hides its members must not cost the rest.
      if (c.path.startsWith("/users?")) return fail(403, "Forbidden");
      return undefined;
    });
    const d = await tracker().getTargetDetails(PROJECT);
    expect(d).toEqual({
      id: PROJECT,
      key: PROJECT,
      name: "Web app",
      description: "The app",
      states: ["Untitled section", "To do", "In progress"],
      labels: ["bug", "frontend"],
      members: [],
      customFields: [
        { id: "1400000000000001", name: "Priority", type: "enum", allowedValues: ["Low", "Medium", "High"] },
        { id: "1400000000000002", name: "Estimate", type: "number" },
        { id: "1400000000000003", name: "Platform", type: "enum", allowedValues: ["Web"] },
        { id: "1400000000000004", name: "Found on", type: "date" },
        { id: "1400000000000005", name: "Reviewers", type: "people" },
        {
          id: "1400000000000006",
          name: "Browsers",
          type: "multi_enum",
          allowedValues: ["Chrome", "Safari", "Firefox"],
        },
      ],
    });
  });

  it("names a project outside the first pages of the listing", async () => {
    stubAsana((c) => {
      if (c.path.startsWith("/projects?")) return ok([]);
      if (c.path.startsWith("/projects/1299?")) {
        return ok({ gid: "1299", name: "Archive", notes: "", workspace: { gid: WS, resource_type: "workspace" } });
      }
      return undefined;
    });
    expect((await tracker().getTargetDetails("1299")).name).toBe("Archive");
  });

  it("throws a clear error for a project Asana cannot find, or one in another workspace", async () => {
    stubAsana((c) => {
      if (c.path.startsWith("/projects?")) return ok([{ gid: PROJECT, name: "Web app" }]);
      if (c.path.startsWith("/projects/1298?")) return ok({ gid: "1298", name: "Elsewhere", workspace: { gid: "999" } });
      if (c.path.startsWith("/projects/")) return fail(404, "project: Unknown object: 1297");
      return undefined;
    });
    await expect(tracker().getTargetDetails("1297")).rejects.toThrow(
      `Asana: no project "1297" in this workspace. Known projects: Web app (${PROJECT})`,
    );
    await expect(tracker().getTargetDetails("1298")).rejects.toThrow(/no project "1298" in this workspace/);
  });
});

describe("searchIssues", () => {
  it("searches with typeahead, which works on every Asana tier", async () => {
    const calls = stubAsana((c) =>
      c.path.startsWith(`/workspaces/${WS}/typeahead`)
        ? ok([
            {
              gid: "1701",
              resource_type: "task",
              name: "Checkout total wrong",
              permalink_url: "https://app.asana.com/1/x/task/1701",
              completed: false,
              assignee: { gid: "1600000000000002", name: "Grace Hopper" },
              memberships: [{ project: { gid: PROJECT, name: "Web app" }, section: { gid: "2", name: "To do" } }],
              tags: [{ gid: "1500000000000001", name: "bug" }],
            },
            { gid: "1702", resource_type: "task", name: "Old one", completed: true, memberships: [], tags: [] },
          ])
        : undefined,
    );
    const out = await tracker().searchIssues("checkout total", { limit: 5 });
    expect(calls[0].path).toBe(
      `/workspaces/${WS}/typeahead?resource_type=task&query=checkout%20total&count=5&opt_fields=name,permalink_url,completed,assignee.name,memberships.project.name,memberships.section.name,tags.name`,
    );
    expect(out).toEqual([
      {
        identifier: "1701",
        title: "Checkout total wrong",
        url: "https://app.asana.com/1/x/task/1701",
        target: "Web app",
        state: "To do",
        labels: ["bug"],
        assignee: "Grace Hopper",
      },
      {
        identifier: "1702",
        title: "Old one",
        url: "https://app.asana.com/0/0/1702",
        target: "",
        state: "Completed",
        labels: [],
        assignee: undefined,
      },
    ]);
  });

  it("returns [] on any failure", async () => {
    stubAsana(() => fail(500, "Server Error"));
    expect(await tracker().searchIssues("x")).toEqual([]);
  });
});

describe("getLiveIssues", () => {
  /** 1701 open, 1702 not found, 1703 forbidden, 1704 completed. */
  const mixedBatch: Handler = (c) =>
      c.method === "POST" && c.path === "/batch"
        ? ok([
            {
              status_code: 200,
              headers: {},
              body: {
                data: {
                  gid: "1701",
                  name: "Save fails",
                  completed: false,
                  permalink_url: "https://app.asana.com/1/x/task/1701",
                  created_at: "2026-10-01T09:00:00.000Z",
                  assignee: { gid: "16", name: "Ada Lovelace", photo: { image_60x60: "https://s3/ada_60.png" } },
                  memberships: [{ project: { gid: PROJECT, name: "Web app" }, section: { gid: "3", name: "In progress" } }],
                },
              },
            },
            { status_code: 404, headers: {}, body: { errors: [{ message: "task: Unknown object: 1702" }] } },
            { status_code: 403, headers: {}, body: { errors: [{ message: "Forbidden" }] } },
            {
              status_code: 200,
              headers: {},
              body: { data: { gid: "1704", name: "Done one", completed: true, created_at: "2026-09-01T00:00:00Z", memberships: [] } },
            },
          ])
        : undefined;

  it("reads tasks through the batch API and marks a confirmed 404 as gone", async () => {
    const calls = stubAsana(mixedBatch, me("999", WS));

    const out = await tracker().getLiveIssues(["1701", "1702", "1703", "1704", "not-a-gid"]);

    // One batch, plus one check that the token still belongs to the workspace.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /batch", "GET /users/me?opt_fields=workspaces"]);
    expect(calls[0].json).toEqual({
      data: {
        actions: ["1701", "1702", "1703", "1704"].map((g) => ({
          method: "get",
          relative_path: `/tasks/${g}`,
          options: {
            fields: [
              "name",
              "completed",
              "permalink_url",
              "created_at",
              "assignee.name",
              "assignee.photo.image_60x60",
              "memberships.project.name",
              "memberships.section.name",
            ],
          },
        })),
      },
    });
    // Only the confirmed 404; a 403 is a permission change, not a deletion.
    expect(out.gone).toEqual(["1702"]);
    expect(out.issues["1701"]).toEqual({
      identifier: "1701",
      title: "Save fails",
      url: "https://app.asana.com/1/x/task/1701",
      stateName: "In progress",
      stateColor: STATUS_COLOR.active,
      createdAt: "2026-10-01T09:00:00.000Z",
      assignee: { name: "Ada Lovelace", avatarUrl: "https://s3/ada_60.png" },
    });
    expect(out.issues["1704"]).toMatchObject({ stateName: "Completed", stateColor: STATUS_COLOR.done });
    expect(Object.keys(out.issues).sort()).toEqual(["1701", "1704"]);
  });

  it("colors every task from the brand palette, with or without a section", async () => {
    const task = (gid: string, section?: string) => ({
      status_code: 200,
      body: {
        data: {
          gid,
          name: `Task ${gid}`,
          memberships: section ? [{ project: { gid: PROJECT }, section: { gid: "1", name: section } }] : [],
        },
      },
    });
    stubAsana((c) =>
      c.method === "POST" && c.path === "/batch"
        ? ok([task("1711"), task("1712", "Backlog"), task("1713", "Shipped"), task("1714", "Code review")])
        : undefined,
    );
    const out = await tracker().getLiveIssues(["1711", "1712", "1713", "1714"]);
    expect(Object.values(out.issues).map((i) => [i.stateName, i.stateColor])).toEqual([
      ["Open", STATUS_COLOR.neutral],
      ["Backlog", STATUS_COLOR.neutral],
      ["Shipped", STATUS_COLOR.done],
      ["Code review", STATUS_COLOR.active],
    ]);
  });

  // "Unknown object" is also what every task looks like after the user is
  // removed from the workspace or reconnects as someone else. Trusting it
  // would flip every row to Deleted at once.
  it("trusts no 404 when the token no longer belongs to the workspace", async () => {
    stubAsana(mixedBatch, me("999"));
    const out = await tracker().getLiveIssues(["1701", "1702", "1703", "1704"]);
    expect(out.gone).toEqual([]);
    expect(Object.keys(out.issues).sort()).toEqual(["1701", "1704"]);
  });

  it("trusts no 404 when the membership check itself fails", async () => {
    stubAsana(mixedBatch, (c) => (c.path.startsWith("/users/me") ? fail(500, "Server Error") : undefined));
    expect((await tracker().getLiveIssues(["1701", "1702"])).gone).toEqual([]);
  });

  it("skips the membership check when nothing came back missing", async () => {
    const calls = stubAsana(mixedBatch, me(WS));
    await tracker().getLiveIssues(["1701"]);
    expect(calls.some((c) => c.path.startsWith("/users/me"))).toBe(false);
  });

  it("sends at most ten actions per batch", async () => {
    const calls = stubAsana(
      (c) =>
        c.path === "/batch"
          ? ok((c.json?.data?.actions as unknown[]).map(() => ({ status_code: 404, body: {} })))
          : undefined,
      me(WS),
    );
    const ids = Array.from({ length: 23 }, (_, i) => String(1000 + i));
    const out = await tracker().getLiveIssues(ids);
    const batches = calls.filter((c) => c.path === "/batch");
    expect(batches.map((c) => (c.json?.data?.actions as unknown[]).length)).toEqual([10, 10, 3]);
    // One membership check for the whole sync, not one per batch.
    expect(calls.filter((c) => c.path.startsWith("/users/me"))).toHaveLength(1);
    expect(out.gone).toHaveLength(23);
  });

  it("leaves `gone` alone when a whole batch fails, so an outage is not a deletion", async () => {
    stubAsana(() => fail(500, "Server Error"));
    expect(await tracker().getLiveIssues(["1701"])).toEqual({ issues: {}, gone: [] });
  });

  it("never throws, even on an expired token", async () => {
    stubAsana(() => fail(401, "Not Authorized"));
    expect(await tracker().getLiveIssues(["1701"])).toEqual({ issues: {}, gone: [] });
  });
});

describe("listAsanaWorkspaces", () => {
  it("maps workspaces to { id, name }", async () => {
    const calls = stubAsana((c) =>
      c.path.startsWith("/workspaces?")
        ? ok([
            { gid: WS, resource_type: "workspace", name: "Acme" },
            { gid: "2", resource_type: "workspace", name: "Personal Projects" },
          ])
        : undefined,
    );
    expect(await listAsanaWorkspaces("tok")).toEqual([
      { id: WS, name: "Acme" },
      { id: "2", name: "Personal Projects" },
    ]);
    expect(calls[0].path).toBe("/workspaces?limit=100&opt_fields=name");
    expect(calls[0].auth).toBe("Bearer tok");
  });

  it("returns [] on failure", async () => {
    stubAsana(() => fail(401, "Not Authorized"));
    expect(await listAsanaWorkspaces("tok")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("helpers", () => {
  it("places evidence at the end of the agent's Evidence section, before the next heading", () => {
    expect(withEvidenceSection("Intro\n\n## Evidence\nSee below\n\n### Notes\nn", "IMG")).toBe(
      "Intro\n\n## Evidence\nSee below\n\nIMG\n\n### Notes\nn",
    );
    expect(withEvidenceSection("Intro", "IMG")).toBe("Intro\n\n## Evidence\n\nIMG");
    // A bold "Evidence" label counts as the agent's heading too.
    expect(withEvidenceSection("Intro\n\n**Evidence**", "IMG")).toBe("Intro\n\n### Evidence\n\nIMG");
  });

  it("keeps every caption a line of text, whatever markdown it starts with", () => {
    const captions = ["```js", "---", "* * *", "1. The toast", "# Heading", "> - nested", "**All bold**", "~~~"];
    const html = asanaHtml(
      evidenceMarkdown(captions.map((caption, i) => ({ kind: "image" as const, gid: String(100 + i), caption }))),
    );
    expect(html).not.toMatch(/<(pre|ol|ul|h1|h2|hr|blockquote|strong)\b/);
    expect(html).toBe(
      "<body>" +
        'js<img data-asana-gid="100"/>' +
        '<img data-asana-gid="101"/>' +
        '<img data-asana-gid="102"/>' +
        'The toast<img data-asana-gid="103"/>' +
        'Heading<img data-asana-gid="104"/>' +
        'nested<img data-asana-gid="105"/>' +
        'All bold<img data-asana-gid="106"/>' +
        '<img data-asana-gid="107"/>' +
        "</body>",
    );
  });

  it("colors by completion and section words", () => {
    expect(asanaStateColor(true, "To do")).toBe(STATUS_COLOR.done);
    expect(asanaStateColor(false, "Shipped")).toBe(STATUS_COLOR.done);
    expect(asanaStateColor(false, "Code review")).toBe(STATUS_COLOR.active);
    expect(asanaStateColor(false, "Backlog")).toBe(STATUS_COLOR.neutral);
  });
});
