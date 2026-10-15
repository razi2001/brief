import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findRole,
  listNotionWorkspaces,
  makeNotionTracker,
  notionStatusColor,
  optionsOf,
  pageUrl,
  priorityOption,
  propertyValue,
  readProperty,
  retryAfterMs,
  type NotionProperty,
} from "@/lib/notion";
import { buildNotionBody } from "@/lib/notion-body";
import { blockText, type NotionBlock } from "@/lib/notion-blocks";
import { BRIEF_URL, STATUS_COLOR } from "@/lib/tracker";

const prop = (name: string, type: string, options?: string[]): NotionProperty => ({
  id: name,
  name,
  type,
  ...(options
    ? {
        [type]: { options: options.map((o) => ({ name: o })) },
      }
    : {}),
});

function schema(...props: NotionProperty[]): Record<string, NotionProperty> {
  return Object.fromEntries(props.map((p) => [p.name, p]));
}

describe("findRole", () => {
  // A Notion database has no fixed schema - whoever made it chose the property
  // names and types - so the roles have to be discovered, not assumed.
  it("finds the title property by type, whatever it is called", () => {
    const s = schema(prop("Ticket name", "title"), prop("Notes", "rich_text"));
    expect(findRole(s, "title")?.name).toBe("Ticket name");
  });

  it("prefers a real status property over a select named Status", () => {
    const s = schema(prop("Status", "select", ["Todo"]), prop("Stage", "status", ["Backlog"]));
    expect(findRole(s, "status")?.name).toBe("Stage");
  });

  it("falls back to a conventionally named select when there is no status type", () => {
    const s = schema(prop("State", "select", ["Open", "Closed"]));
    expect(findRole(s, "status")?.name).toBe("State");
  });

  it("finds tags, priority and assignee by their usual names", () => {
    const s = schema(
      prop("Tags", "multi_select", ["billing"]),
      prop("Priority", "select", ["High"]),
      prop("Owner", "people"),
    );
    expect(findRole(s, "labels")?.name).toBe("Tags");
    expect(findRole(s, "priority")?.name).toBe("Priority");
    expect(findRole(s, "assignee")?.name).toBe("Owner");
  });

  it("falls back to the only multi_select / people property when names differ", () => {
    const s = schema(prop("Systems affected", "multi_select", ["api"]), prop("Who", "people"));
    expect(findRole(s, "labels")?.name).toBe("Systems affected");
    expect(findRole(s, "assignee")?.name).toBe("Who");
  });

  it("returns undefined rather than guessing when the role has no candidate", () => {
    const s = schema(prop("Title", "title"));
    expect(findRole(s, "status")).toBeUndefined();
    expect(findRole(s, "priority")).toBeUndefined();
  });
});

describe("propertyValue", () => {
  it("resolves a select to one of its real options, fuzzily", () => {
    const p = prop("Priority", "select", ["High", "Medium", "Low"]);
    expect(propertyValue(p, "high")).toEqual({ select: { name: "High" } });
  });

  it("refuses a select value that matches no option", () => {
    // Sending an unknown option rejects the whole page create, so the field is
    // left unset instead.
    const p = prop("Priority", "select", ["High", "Low"]);
    expect(propertyValue(p, "Blocker")).toBeUndefined();
  });

  it("builds a multi_select from a list", () => {
    const p = prop("Tags", "multi_select", ["billing", "regression"]);
    expect(propertyValue(p, ["billing", "regression"])).toEqual({
      multi_select: [{ name: "billing" }, { name: "regression" }],
    });
  });

  it("keeps a multi_select to the options it has, so a typo never becomes a new tag", () => {
    const p = prop("Tags", "multi_select", ["billing", "regression"]);
    expect(propertyValue(p, ["Billing", "biling-typo"])).toEqual({
      multi_select: [{ name: "billing" }],
    });
    expect(propertyValue(p, ["nothing-like-it"])).toBeUndefined();
  });

  it("lets the first ticket seed a multi_select that has no options yet", () => {
    const p = prop("Tags", "multi_select", []);
    expect(propertyValue(p, ["checkout"])).toEqual({ multi_select: [{ name: "checkout" }] });
  });

  it("resolves people to ids, since Notion will not take a name", () => {
    const p = prop("Owner", "people");
    const people = [{ id: "u1", name: "Ons" }];
    expect(propertyValue(p, "Ons", people)).toEqual({ people: [{ id: "u1" }] });
    expect(propertyValue(p, "Nobody", people)).toBeUndefined();
  });

  it("writes the scalar types in Notion's own shapes", () => {
    expect(propertyValue(prop("Count", "number"), "3")).toEqual({ number: 3 });
    expect(propertyValue(prop("Done", "checkbox"), true)).toEqual({ checkbox: true });
    expect(propertyValue(prop("Link", "url"), "https://x.test")).toEqual({ url: "https://x.test" });
    expect(propertyValue(prop("When", "date"), "2026-07-01")).toEqual({
      date: { start: "2026-07-01" },
    });
  });

  it("leaves computed properties alone", () => {
    // Formula and rollup values are derived by Notion and cannot be written.
    expect(propertyValue(prop("Age", "formula"), "x")).toBeUndefined();
    expect(propertyValue(prop("Total", "rollup"), 1)).toBeUndefined();
  });

  it("refuses a number that isn't one", () => {
    expect(propertyValue(prop("Count", "number"), "many")).toBeUndefined();
  });
});

describe("readProperty", () => {
  it("reads each type back as a plain value for the agent's verify step", () => {
    expect(readProperty({ type: "title", title: [{ plain_text: "Save fails" }] })).toBe("Save fails");
    expect(readProperty({ type: "select", select: { name: "High" } })).toBe("High");
    expect(readProperty({ type: "status", status: { name: "Backlog" } })).toBe("Backlog");
    expect(
      readProperty({ type: "multi_select", multi_select: [{ name: "a" }, { name: "b" }] }),
    ).toEqual(["a", "b"]);
    expect(readProperty({ type: "people", people: [{ name: "Ons" }] })).toEqual(["Ons"]);
    expect(readProperty({ type: "checkbox", checkbox: false })).toBe(false);
  });

  it("reads an unset property as null rather than throwing", () => {
    expect(readProperty({ type: "select", select: null })).toBeNull();
    expect(readProperty(null)).toBeNull();
    expect(readProperty(undefined)).toBeNull();
  });
});

describe("optionsOf", () => {
  it("lists options whichever container type holds them", () => {
    expect(optionsOf(prop("S", "select", ["a", "b"]))).toEqual(["a", "b"]);
    expect(optionsOf(prop("M", "multi_select", ["c"]))).toEqual(["c"]);
    expect(optionsOf(prop("T", "status", ["d"]))).toEqual(["d"]);
    expect(optionsOf(prop("R", "rich_text"))).toEqual([]);
    expect(optionsOf(undefined)).toEqual([]);
  });
});

describe("notionStatusColor", () => {
  it("colors by what the option usually means", () => {
    expect(notionStatusColor("Done")).toBe(STATUS_COLOR.done);
    expect(notionStatusColor("In progress")).toBe(STATUS_COLOR.active);
    expect(notionStatusColor("Backlog")).toBe(STATUS_COLOR.neutral);
    expect(notionStatusColor(undefined)).toBe(STATUS_COLOR.neutral);
  });
});

describe("pageUrl", () => {
  it("builds a notion.so url from the dashless id", () => {
    expect(pageUrl("11111111-2222-3333-4444-555555555555")).toBe(
      "https://www.notion.so/11111111222233334444555555555555",
    );
  });

  it("slugs the title in, the way Notion's own links read", () => {
    expect(pageUrl("abc-def", "Save button does nothing")).toBe(
      "https://www.notion.so/Save-button-does-nothing-abcdef",
    );
  });
});

describe("priorityOption", () => {
  it("adopts the database's own priority names", () => {
    expect(priorityOption(prop("Priority", "select", ["P0", "P1", "P2"]), "high")).toBe("P1");
    expect(priorityOption(prop("Priority", "select", ["Low", "Medium", "High"]), "high")).toBe("High");
    expect(priorityOption(prop("Priority", "select", ["Critical", "Normal"]), "urgent")).toBe("Critical");
  });

  it("prefers an exact name, then the priority conventions, over a loose match", () => {
    // A loose substring match of "urgent" is "Not urgent", the opposite.
    expect(priorityOption(prop("Priority", "select", ["Not urgent", "Urgent"]), "urgent")).toBe("Urgent");
    expect(priorityOption(prop("Priority", "select", ["Not urgent", "P0", "P1"]), "urgent")).toBe("P0");
    expect(priorityOption(prop("Priority", "select", ["Highest", "High"]), "high")).toBe("High");
  });

  it("never picks a negated option, even when it is the only near match", () => {
    expect(priorityOption(prop("Priority", "select", ["Not urgent"]), "urgent")).toBeUndefined();
    expect(priorityOption(prop("Priority", "select", ["Non-urgent", "Later"]), "urgent")).toBeUndefined();
  });

  it("falls back to a loose match only after the stricter ones", () => {
    expect(priorityOption(prop("Priority", "select", ["Medium-ish"]), "medium")).toBe("Medium-ish");
  });

  it("is undefined when nothing means that priority, so nothing is set", () => {
    expect(priorityOption(prop("Priority", "select", ["Someday"]), "high")).toBeUndefined();
    expect(priorityOption(undefined, "high")).toBeUndefined();
  });
});

describe("titles", () => {
  it("are written as plain text, markdown and all", () => {
    expect(propertyValue(prop("Name", "title"), "Save **fails** on [checkout](/cart)")).toEqual({
      title: [{ type: "text", text: { content: "Save **fails** on [checkout](/cart)" } }],
    });
  });
});

describe("retryAfterMs", () => {
  it("honours Notion's seconds, capped so one page cannot stall the feed", () => {
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("60")).toBe(3000);
    expect(retryAfterMs(null)).toBe(1000);
    expect(retryAfterMs("soon")).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

const types = (blocks: NotionBlock[]) => blocks.map((b) => b.type);
const shot = (over: Record<string, unknown> = {}) => ({
  filename: "screenshot-1699.png",
  contentType: "image/png",
  bytes: Buffer.from(""),
  url: "https://brief.test/api/evidence/s1/screenshots/a.png",
  ...over,
});
const logs = [
  {
    title: "Technical logs: Screen recording",
    markdown: "**Timeline** (1 call; in order)\n\n```text\n0:01  GET  api/a  200  12 ms\n```",
  },
];

describe("buildNotionBody", () => {
  it("adds an Evidence heading when the body has none, each caption directly above its image", () => {
    const blocks = buildNotionBody("The save button does nothing.", [
      shot({ caption: "The cart still shows zero items" }),
      shot({ url: "https://brief.test/api/evidence/s1/screenshots/b.png" }),
    ]);
    expect(types(blocks)).toEqual([
      "paragraph",
      "heading_2",
      "paragraph",
      "image",
      "image",
      "divider",
      "paragraph",
    ]);
    expect(blockText(blocks[1])).toBe("Evidence");
    expect(blockText(blocks[2])).toBe("The cart still shows zero items");
    expect(blocks[3].image).toEqual({
      type: "external",
      external: { url: "https://brief.test/api/evidence/s1/screenshots/a.png" },
    });
  });

  // The agent is told not to write its own Evidence section, but it sometimes
  // does. A second heading gave tickets "Evidence" twice.
  it("reuses the agent's own Evidence heading, filling that section rather than adding one", () => {
    const md = [
      "It hangs.",
      "",
      "## Evidence",
      "",
      "The spinner never stops.",
      "",
      "## Environment",
      "",
      "Chrome 141",
    ].join("\n");
    const blocks = buildNotionBody(md, [shot()]);
    const headings = blocks.filter((b) => b.type.startsWith("heading_")).map(blockText);
    expect(headings).toEqual(["Evidence", "Environment"]);
    // The image lands at the end of the Evidence section, before Environment.
    expect(types(blocks).slice(0, 5)).toEqual(["paragraph", "heading_2", "paragraph", "image", "heading_2"]);
  });

  it("recognises a bold section label as the Evidence heading too", () => {
    const blocks = buildNotionBody("It hangs.\n\n**Evidence**\n\nThe spinner never stops.", [shot()]);
    expect(blocks.filter((b) => blockText(b) === "Evidence")).toHaveLength(1);
    expect(types(blocks).slice(0, 4)).toEqual(["paragraph", "heading_3", "paragraph", "image"]);
  });

  it("calls a recording a screen recording and never shows its file name", () => {
    const blocks = buildNotionBody("It hangs.", [
      {
        filename: "brief-capture-1699.webm",
        contentType: "video/webm",
        bytes: Buffer.from(""),
        url: "https://brief.test/api/evidence/s1/recording.webm",
      },
    ]);
    // Notion's video block does not play WebM, and a video block it cannot
    // play is rejected with the whole page, so a WebM recording is a link.
    const link = blocks[2];
    expect(link.type).toBe("paragraph");
    expect(link.paragraph).toEqual({
      rich_text: [
        { type: "text", text: { content: "Screen recording:" }, annotations: { bold: true } },
        { type: "text", text: { content: " " } },
        {
          type: "text",
          text: {
            content: "Watch the screen recording",
            link: { url: "https://brief.test/api/evidence/s1/recording.webm" },
          },
        },
      ],
    });
    expect(JSON.stringify(blocks)).not.toContain("brief-capture-1699");
    expect(blocks.some((b) => b.type === "video")).toBe(false);
  });

  it("plays a recording inline when Notion supports its format, labelled above it", () => {
    const blocks = buildNotionBody("It hangs.", [
      {
        filename: "rec.mp4",
        contentType: "video/mp4",
        bytes: Buffer.from(""),
        url: "https://brief.test/api/evidence/s1/recording.mp4",
      },
    ]);
    expect(types(blocks).slice(1, 4)).toEqual(["heading_2", "paragraph", "video"]);
    expect(blockText(blocks[2])).toBe("Screen recording");
    expect(blocks[3].video).toEqual({
      type: "external",
      external: { url: "https://brief.test/api/evidence/s1/recording.mp4" },
    });
  });

  it("skips evidence with no url, or one Notion cannot reach, and then adds no heading", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocks = buildNotionBody("It hangs.", [
      shot({ url: undefined }),
      shot({ url: "http://localhost:3000/api/evidence/s1/screenshots/a.png" }),
      shot({ url: "/api/evidence/s1/screenshots/a.png" }),
      shot({ url: "ftp://brief.test/a.png" }),
    ]);
    expect(types(blocks)).toEqual(["paragraph", "divider", "paragraph"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("folds the technical logs into a toggle per video, after the evidence", () => {
    const blocks = buildNotionBody("It hangs.", [shot()], [
      ...logs,
      { title: "Technical logs: Replay", markdown: "   " },
    ]);
    expect(types(blocks)).toEqual(["paragraph", "heading_2", "image", "toggle", "divider", "paragraph"]);
    const toggle = blocks[3].toggle as { rich_text: unknown[]; children: NotionBlock[] };
    expect(toggle.rich_text).toEqual([
      { type: "text", text: { content: "Technical logs: Screen recording" } },
    ]);
    expect(types(toggle.children)).toEqual(["paragraph", "code"]);
    expect(blockText(toggle.children[0])).toBe("Timeline (1 call; in order)");
  });

  it("ends with the attribution under a divider, once, even if the agent copied it in", () => {
    const blocks = buildNotionBody(`It hangs.\n\n---\n\nReported with [Brief](${BRIEF_URL})`, []);
    expect(types(blocks)).toEqual(["paragraph", "divider", "paragraph"]);
    const last = blocks[2].paragraph as {
      rich_text: Array<{ text: { content: string; link?: { url: string } } }>;
    };
    expect(last.rich_text.map((t) => t.text.content).join("")).toBe("Reported with Brief");
    expect(last.rich_text[1].text.link).toEqual({ url: BRIEF_URL });
  });
});

// ---------------------------------------------------------------------------
// HTTP, against envelopes shaped like Notion's API reference
// ---------------------------------------------------------------------------

const DB_ID = "bc1211ca-e3f1-4939-ae34-5260b16f627c";
const PAGE_ID = "59833787-2cf9-4fdf-8782-e53db20768a5";
const ONS_ID = "6794760a-1f15-45cd-9c65-0dfe42f5135a";
const BOT_ID = "16d84278-ab0e-484c-9bdd-b35da3bd8905";

const rich = (content: string) => [
  {
    type: "text",
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
    },
    plain_text: content,
    href: null,
  },
];

const DATABASE = {
  object: "database",
  id: DB_ID,
  created_time: "2026-09-01T10:00:00.000Z",
  last_edited_time: "2026-10-12T08:30:00.000Z",
  title: rich("Bugs"),
  description: rich("Product bugs"),
  is_inline: false,
  parent: { type: "page_id", page_id: "98ad959b-2b6a-4774-80ee-00246fb0ea9b" },
  url: "https://www.notion.so/bc1211cae3f14939ae345260b16f627c",
  archived: false,
  in_trash: false,
  properties: {
    "Bug name": { id: "title", name: "Bug name", type: "title", title: {} },
    Status: {
      id: "s%3Ast",
      name: "Status",
      type: "status",
      status: {
        options: [
          { id: "o1", name: "Not started", color: "default" },
          { id: "o2", name: "In progress", color: "blue" },
          { id: "o3", name: "Done", color: "green" },
        ],
        groups: [{ id: "g1", name: "To-do", color: "gray", option_ids: ["o1"] }],
      },
    },
    Priority: {
      id: "p%3Apr",
      name: "Priority",
      type: "select",
      select: {
        options: [
          { id: "p0", name: "P0", color: "red" },
          { id: "p1", name: "P1", color: "orange" },
          { id: "p2", name: "P2", color: "yellow" },
        ],
      },
    },
    Tags: {
      id: "t%3Atg",
      name: "Tags",
      type: "multi_select",
      multi_select: {
        options: [
          { id: "t1", name: "checkout", color: "blue" },
          { id: "t2", name: "regression", color: "red" },
        ],
      },
    },
    Assignee: { id: "a%3Aas", name: "Assignee", type: "people", people: {} },
    "Found on": { id: "d%3Afo", name: "Found on", type: "date", date: {} },
  },
};

const USERS = {
  object: "list",
  results: [
    {
      object: "user",
      id: ONS_ID,
      type: "person",
      name: "Ons Ben",
      avatar_url: null,
      person: { email: "ons@acme.test" },
    },
    { object: "user", id: BOT_ID, type: "bot", name: "Brief", avatar_url: null, bot: {} },
  ],
  next_cursor: null,
  has_more: false,
  type: "user",
  user: {},
};

const PAGE = (over: Record<string, unknown> = {}) => ({
  object: "page",
  id: PAGE_ID,
  created_time: "2026-10-13T09:00:00.000Z",
  last_edited_time: "2026-10-13T09:00:00.000Z",
  created_by: { object: "user", id: BOT_ID },
  last_edited_by: { object: "user", id: BOT_ID },
  cover: null,
  icon: null,
  parent: { type: "database_id", database_id: DB_ID },
  archived: false,
  in_trash: false,
  properties: {
    "Bug name": { id: "title", type: "title", title: rich("Save fails on checkout") },
    Status: { id: "s%3Ast", type: "status", status: { id: "o2", name: "In progress", color: "blue" } },
    Priority: { id: "p%3Apr", type: "select", select: { id: "p1", name: "P1", color: "orange" } },
    Tags: {
      id: "t%3Atg",
      type: "multi_select",
      multi_select: [{ id: "t1", name: "checkout", color: "blue" }],
    },
    Assignee: {
      id: "a%3Aas",
      type: "people",
      people: [
        { object: "user", id: ONS_ID, name: "Ons Ben", type: "person", person: { email: "ons@acme.test" } },
      ],
    },
    "Found on": { id: "d%3Afo", type: "date", date: null },
  },
  url: "https://www.notion.so/Save-fails-on-checkout-598337872cf94fdf8782e53db20768a5",
  public_url: null,
  ...over,
});

const notFound = (id: string) => ({
  status: 404,
  json: {
    object: "error",
    status: 404,
    code: "object_not_found",
    message: `Could not find page with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`,
    request_id: "a1b2c3d4-0000-4000-8000-000000000000",
  },
});

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | undefined;
};
type Reply = { status?: number; json: unknown; headers?: Record<string, string> };
type Route = [method: string, path: string, reply: () => Reply];

const API = "https://api.notion.com/v1";

/** Stub fetch with Notion routes; anything unrouted fails loudly as a 500. */
function mockNotion(...routes: Route[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url, method, headers: new Headers(init.headers), body });
      const path = url.replace(API, "");
      const route = routes.find(([m, p]) => m === method && p === path);
      const reply: Reply = route
        ? route[2]()
        : { status: 500, json: { message: `unrouted ${method} ${path}` } };
      return new Response(JSON.stringify(reply.json), {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json", ...reply.headers },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const schemaRoutes: Route[] = [
  ["GET", `/databases/${DB_ID}`, () => ({ json: DATABASE })],
  ["GET", "/users?page_size=100", () => ({ json: USERS })],
];

describe("fileIssue", () => {
  it("creates the page in the database with its properties and the whole body", async () => {
    const calls = mockNotion(
      ...schemaRoutes,
      ["POST", "/pages", () => ({ json: PAGE() })],
      ["POST", "/comments", () => ({ json: { object: "comment", id: "c1" } })],
    );

    const out = await makeNotionTracker({ token: "secret_tok" }).fileIssue({
      targetId: DB_ID,
      title: "Save fails on checkout",
      descriptionMarkdown:
        "The save button does nothing.\n\n**Steps to reproduce**\n\n1. Open the cart\n2. Press Save",
      labels: ["checkout", "made-up"],
      priority: "high",
      state: "progress",
      assignee: "Ons",
      comment: "Looking into it",
      evidence: [shot({ caption: "The cart still shows zero items" })],
      details: logs,
    });

    const create = calls.find((c) => c.method === "POST" && c.url === `${API}/pages`)!;
    expect(create.headers.get("Notion-Version")).toBe("2022-06-28");
    expect(create.headers.get("Authorization")).toBe("Bearer secret_tok");
    expect(create.headers.get("Content-Type")).toBe("application/json");
    expect(create.body?.parent).toEqual({ database_id: DB_ID });

    const props = create.body?.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["Assignee", "Bug name", "Priority", "Status", "Tags"]);
    expect(props["Bug name"]).toEqual({
      title: [{ type: "text", text: { content: "Save fails on checkout" } }],
    });
    expect(props.Status).toEqual({ status: { name: "In progress" } });
    // "high" adopts the team's own convention rather than a name it lacks.
    expect(props.Priority).toEqual({ select: { name: "P1" } });
    // Only tags the database has; the invented one is dropped, not created.
    expect(props.Tags).toEqual({ multi_select: [{ name: "checkout" }] });
    expect(props.Assignee).toEqual({ people: [{ id: ONS_ID }] });

    const children = create.body?.children as NotionBlock[];
    expect(types(children)).toEqual([
      "paragraph",
      "heading_3",
      "numbered_list_item",
      "numbered_list_item",
      "heading_2",
      "paragraph",
      "image",
      "toggle",
      "divider",
      "paragraph",
    ]);
    expect(blockText(children[children.length - 1])).toBe("Reported with Brief");

    const comment = calls.find((c) => c.url === `${API}/comments`)!;
    expect(comment.method).toBe("POST");
    expect(comment.body).toEqual({
      parent: { page_id: PAGE_ID },
      rich_text: [{ type: "text", text: { content: "Looking into it" } }],
    });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    expect(out).toEqual({
      id: PAGE_ID,
      identifier: PAGE_ID,
      url: "https://www.notion.so/Save-fails-on-checkout-598337872cf94fdf8782e53db20768a5",
      title: "Save fails on checkout",
    });
  });

  it("appends a body past Notion's 100-block cap in order, toggles and attribution included", async () => {
    const calls = mockNotion(
      ...schemaRoutes,
      ["POST", "/pages", () => ({ json: PAGE() })],
      ["PATCH", `/blocks/${PAGE_ID}/children`, () => ({ json: { object: "list", results: [] } })],
    );
    const items = Array.from({ length: 150 }, (_, i) => `- item ${i + 1}`).join("\n");

    await makeNotionTracker({ token: "t" }).fileIssue({
      targetId: DB_ID,
      title: "Long one",
      descriptionMarkdown: `Intro.\n\n${items}`,
      evidence: [shot()],
      details: logs,
    });

    const create = calls.find((c) => c.method === "POST" && c.url === `${API}/pages`)!;
    expect((create.body?.children as NotionBlock[]).length).toBe(100);

    const appends = calls.filter((c) => c.method === "PATCH");
    expect(appends).toHaveLength(1);
    expect(appends[0].url).toBe(`${API}/blocks/${PAGE_ID}/children`);
    expect(appends[0].headers.get("Notion-Version")).toBe("2022-06-28");
    const rest = appends[0].body?.children as NotionBlock[];
    // 1 intro + 150 items = 151 body blocks, of which 100 went with the page.
    expect(types(rest)).toEqual([
      ...Array(51).fill("bulleted_list_item"),
      "heading_2",
      "image",
      "toggle",
      "divider",
      "paragraph",
    ]);
    expect(blockText(rest[50])).toBe("item 150");
    const toggle = rest[53].toggle as { children: NotionBlock[] };
    expect(types(toggle.children)).toEqual(["paragraph", "code"]);
  });

  it("files without the free-form fields when Notion rejects one, keeping the resolved ones", async () => {
    let attempt = 0;
    const calls = mockNotion(...schemaRoutes, [
      "POST",
      "/pages",
      () =>
        ++attempt === 1
          ? {
              status: 400,
              json: {
                object: "error",
                status: 400,
                code: "validation_error",
                message:
                  "body failed validation: body.properties.Found on.date.start should be a valid ISO 8601 date string, instead was \"yesterday\".",
              },
            }
          : { json: PAGE() },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await makeNotionTracker({ token: "t" }).fileIssue({
      targetId: DB_ID,
      title: "Save fails on checkout",
      descriptionMarkdown: "It hangs.",
      state: "Done",
      extraFields: { "Found on": "yesterday" },
      evidence: [],
    });
    warn.mockRestore();

    const creates = calls.filter((c) => c.method === "POST" && c.url === `${API}/pages`);
    expect(creates).toHaveLength(2);
    expect(Object.keys(creates[0].body?.properties as object).sort()).toEqual([
      "Bug name",
      "Found on",
      "Status",
    ]);
    // Status was already checked against the database's options, so it stays.
    expect(creates[1].body?.properties).toEqual({
      "Bug name": { title: [{ type: "text", text: { content: "Save fails on checkout" } }] },
      Status: { status: { name: "Done" } },
    });
    expect(creates[1].body?.children).toEqual(creates[0].body?.children);
    expect(out.identifier).toBe(PAGE_ID);
  });

  it("does not retry a rejected body, which would only fail the same way", async () => {
    const calls = mockNotion(...schemaRoutes, [
      "POST",
      "/pages",
      () => ({
        status: 400,
        json: {
          object: "error",
          status: 400,
          code: "validation_error",
          message: "body failed validation: body.children[3].image.external.url should be a valid URL.",
        },
      }),
    ]);
    await expect(
      makeNotionTracker({ token: "t" }).fileIssue({
        targetId: DB_ID,
        title: "x",
        descriptionMarkdown: "y",
        extraFields: { "Found on": "2026-10-13" },
        evidence: [],
      }),
    ).rejects.toThrow(/Notion \/pages failed: 400 .*body\.children\[3\]/);
    expect(calls.filter((c) => c.method === "POST" && c.url === `${API}/pages`)).toHaveLength(1);
  });

  it("leaves out an extra field that is not a property of the database", async () => {
    const calls = mockNotion(...schemaRoutes, ["POST", "/pages", () => ({ json: PAGE() })]);
    await makeNotionTracker({ token: "t" }).fileIssue({
      targetId: DB_ID,
      title: "x",
      descriptionMarkdown: "y",
      extraFields: { "Sprint": "42", "found ON": "2026-10-13" },
      evidence: [],
    });
    const create = calls.find((c) => c.method === "POST" && c.url === `${API}/pages`)!;
    // The unknown key has nowhere to go; a case-insensitive match still lands.
    expect(create.body?.properties).toEqual({
      "Found on": { date: { start: "2026-10-13" } },
      "Bug name": { title: [{ type: "text", text: { content: "x" } }] },
    });
  });

  it("still fails loudly when Notion refuses the page itself", async () => {
    mockNotion(...schemaRoutes, ["POST", "/pages", () => notFound(DB_ID)]);
    await expect(
      makeNotionTracker({ token: "t" }).fileIssue({
        targetId: DB_ID,
        title: "x",
        descriptionMarkdown: "y",
        evidence: [],
      }),
    ).rejects.toThrow(/Notion \/pages failed: 404/);
  });
});

describe("updateIssue", () => {
  const pageRoute: Route = ["GET", `/pages/${PAGE_ID}`, () => ({ json: PAGE() })];

  it("patches the resolved status and priority onto the page", async () => {
    const calls = mockNotion(pageRoute, ...schemaRoutes, [
      "PATCH",
      `/pages/${PAGE_ID}`,
      () => ({ json: PAGE() }),
    ]);
    const out = await makeNotionTracker({ token: "t" }).updateIssue(PAGE_ID, {
      state: "done",
      priority: "urgent",
    });
    expect(out).toEqual({ ok: true });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toBe(`${API}/pages/${PAGE_ID}`);
    expect(patch.body).toEqual({
      properties: { Status: { status: { name: "Done" } }, Priority: { select: { name: "P0" } } },
    });
  });

  it("reports an unknown status with the valid ones, and writes nothing", async () => {
    const calls = mockNotion(pageRoute, ...schemaRoutes);
    const out = await makeNotionTracker({ token: "t" }).updateIssue(PAGE_ID, { state: "Shipped" });
    expect(out).toEqual({
      ok: false,
      error: '"Shipped" is not valid for Status. Allowed values: Not started, In progress, Done',
    });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("names a tag the database does not have instead of dropping it quietly", async () => {
    mockNotion(pageRoute, ...schemaRoutes);
    const out = await makeNotionTracker({ token: "t" }).updateIssue(PAGE_ID, {
      labels: ["checkout", "nope"],
    });
    expect(out).toEqual({
      ok: false,
      error: 'Tags has no option "nope". Allowed values: checkout, regression',
    });
  });

  it("reports a priority no option means, rather than setting a near miss", async () => {
    const db = {
      ...DATABASE,
      properties: {
        ...DATABASE.properties,
        Priority: {
          id: "p%3Apr",
          name: "Priority",
          type: "select",
          select: { options: [{ id: "n", name: "Not urgent", color: "gray" }] },
        },
      },
    };
    const calls = mockNotion(
      pageRoute,
      ["GET", `/databases/${DB_ID}`, () => ({ json: db })],
      ["GET", "/users?page_size=100", () => ({ json: USERS })],
    );
    const out = await makeNotionTracker({ token: "t" }).updateIssue(PAGE_ID, { priority: "urgent" });
    expect(out).toEqual({
      ok: false,
      error: 'no option of Priority means "urgent". Allowed values: Not urgent',
    });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("reports an extra field that is not a property, with the ones that are", async () => {
    mockNotion(pageRoute, ...schemaRoutes);
    const out = await makeNotionTracker({ token: "t" }).updateIssue(PAGE_ID, {
      extraFields: { Sprint: "42" },
    });
    expect(out).toEqual({
      ok: false,
      error: 'property "Sprint" not found. Valid properties: Bug name, Status, Priority, Tags, Assignee, Found on',
    });
  });
});

describe("getTargetDetails", () => {
  const RICH_DB = {
    ...DATABASE,
    properties: {
      ...DATABASE.properties,
      Components: {
        id: "c%3Aco",
        name: "Components",
        type: "multi_select",
        multi_select: { options: [{ id: "c1", name: "API", color: "blue" }] },
      },
      Notes: { id: "n%3Ano", name: "Notes", type: "rich_text", rich_text: {} },
      Age: { id: "g%3Aag", name: "Age", type: "formula", formula: { expression: "now()" } },
      Created: { id: "c%3Acr", name: "Created", type: "created_time", created_time: {} },
    },
  };
  const searchRoute: Route = [
    "POST",
    "/search",
    () => ({ json: { object: "list", results: [RICH_DB], next_cursor: null, has_more: false } }),
  ];
  const usersPaged: Route[] = [
    [
      "GET",
      "/users?page_size=100",
      () => ({ json: { ...USERS, has_more: true, next_cursor: "cur-2" } }),
    ],
    [
      "GET",
      "/users?page_size=100&start_cursor=cur-2",
      () => ({
        json: {
          ...USERS,
          results: [{ object: "user", id: "u-2", type: "person", name: "Sami K", person: {} }],
        },
      }),
    ],
  ];

  it("offers every writable property that is not already a first-class field", async () => {
    const calls = mockNotion(searchRoute, ...usersPaged);
    const out = await makeNotionTracker({ token: "t" }).getTargetDetails(DB_ID);

    expect(calls[0].body).toEqual({ filter: { property: "object", value: "database" }, page_size: 100 });
    expect(out).toMatchObject({
      id: DB_ID,
      key: "Bugs",
      name: "Bugs",
      description: "Product bugs",
      states: ["Not started", "In progress", "Done"],
      labels: ["checkout", "regression"],
      // Members come from every page of users, bots left out.
      members: ["Ons Ben", "Sami K"],
    });
    // Status, Tags, Priority, Assignee and the title are first-class;
    // formula and created_time are computed by Notion and cannot be written.
    expect(out.customFields).toEqual([
      { id: "Found on", name: "Found on", type: "date", allowedValues: undefined },
      { id: "Components", name: "Components", type: "multi_select", allowedValues: ["API"] },
      { id: "Notes", name: "Notes", type: "rich_text", allowedValues: undefined },
    ]);
  });

  it("finds the database whether its id has dashes or not", async () => {
    mockNotion(searchRoute, ...usersPaged);
    const tracker = makeNotionTracker({ token: "t" });
    expect((await tracker.getTargetDetails(DB_ID.replace(/-/g, ""))).id).toBe(DB_ID);
    expect((await tracker.getTargetDetails(DB_ID.toUpperCase())).id).toBe(DB_ID);
  });

  it("names the databases it does know when the id is not one of them", async () => {
    mockNotion(searchRoute, ...usersPaged);
    await expect(makeNotionTracker({ token: "t" }).getTargetDetails("nope")).rejects.toThrow(
      `Notion: database nope not found. Known databases: Bugs (id: ${DB_ID})`,
    );
  });
});

describe("searchIssues", () => {
  it("returns [] when Notion fails, so a search outage never breaks filing", async () => {
    mockNotion(["POST", "/search", () => ({ status: 502, json: { message: "bad gateway" } })]);
    expect(await makeNotionTracker({ token: "t" }).searchIssues("save")).toEqual([]);
  });

  it("reads database pages back as precedent", async () => {
    const calls = mockNotion(
      [
        "POST",
        "/search",
        () => ({ json: { object: "list", results: [PAGE()], next_cursor: null, has_more: false } }),
      ],
      ...schemaRoutes,
    );
    const [hit] = await makeNotionTracker({ token: "t" }).searchIssues("save");
    expect(calls[0].body).toEqual({
      query: "save",
      filter: { property: "object", value: "page" },
      page_size: 15,
    });
    expect(hit).toMatchObject({
      identifier: PAGE_ID,
      title: "Save fails on checkout",
      target: "Bugs",
      state: "In progress",
      labels: ["checkout"],
      assignee: "Ons Ben",
      priority: "P1",
    });
  });
});

describe("getLiveIssues", () => {
  const OTHER = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const TRASHED = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const FLAKY = "e4eaaaf2-d142-11e1-b3e4-080027620cdd";

  const SECOND = "9b2c4e1a-3f5d-4a6b-8c7d-0e1f2a3b4c5d";
  const UNSHARED = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e";

  it("reads live pages, and reports gone only what Notion confirmed deleted", async () => {
    const calls = mockNotion(
      ["GET", `/pages/${PAGE_ID}`, () => ({ json: PAGE() })],
      ["GET", `/pages/${SECOND}`, () => ({ json: PAGE({ id: SECOND }) })],
      ["GET", `/pages/${OTHER}`, () => notFound(OTHER)],
      ["GET", `/pages/${UNSHARED}`, () => ({ status: 404, json: { message: "Not Found" } })],
      ["GET", `/pages/${TRASHED}`, () => ({ json: PAGE({ id: TRASHED, archived: true, in_trash: true }) })],
      ["GET", `/pages/${FLAKY}`, () => ({ status: 502, json: { message: "bad gateway" } })],
      ...schemaRoutes,
    );
    const out = await makeNotionTracker({ token: "t" }).getLiveIssues([
      PAGE_ID,
      SECOND,
      OTHER,
      UNSHARED,
      TRASHED,
      FLAKY,
    ]);

    expect(out.issues[PAGE_ID]).toEqual({
      identifier: PAGE_ID,
      title: "Save fails on checkout",
      url: "https://www.notion.so/Save-fails-on-checkout-598337872cf94fdf8782e53db20768a5",
      stateName: "In progress",
      stateColor: STATUS_COLOR.active,
      createdAt: "2026-10-13T09:00:00.000Z",
      assignee: { name: "Ons Ben" },
    });
    expect(out.issues[SECOND]?.identifier).toBe(SECOND);
    // Only the trashed page is a confirmed deletion.
    expect(out.gone).toEqual([TRASHED]);
    // object_not_found is also what an unshared page answers, so like any
    // other 404 or failure it says nothing about whether the ticket exists.
    for (const id of [OTHER, UNSHARED, FLAKY]) expect(out.issues[id]).toBeUndefined();
    // Both live pages share a database, whose schema is read once.
    expect(calls.filter((c) => c.url === `${API}/databases/${DB_ID}`)).toHaveLength(1);
  });

  it("retries a rate-limited read once, after the wait Notion asks for", async () => {
    let attempt = 0;
    const calls = mockNotion(
      [
        "GET",
        `/pages/${PAGE_ID}`,
        () =>
          ++attempt === 1
            ? { status: 429, json: { code: "rate_limited" }, headers: { "Retry-After": "0" } }
            : { json: PAGE() },
      ],
      ...schemaRoutes,
    );
    const out = await makeNotionTracker({ token: "t" }).getLiveIssues([PAGE_ID]);
    expect(out.issues[PAGE_ID]?.title).toBe("Save fails on checkout");
    expect(calls.filter((c) => c.url === `${API}/pages/${PAGE_ID}`)).toHaveLength(2);
  });

  it("leaves a page unknown when it is still rate limited after the retry", async () => {
    const calls = mockNotion([
      "GET",
      `/pages/${PAGE_ID}`,
      () => ({ status: 429, json: { code: "rate_limited" }, headers: { "Retry-After": "0" } }),
    ]);
    expect(await makeNotionTracker({ token: "t" }).getLiveIssues([PAGE_ID])).toEqual({
      issues: {},
      gone: [],
    });
    expect(calls).toHaveLength(2);
  });

  it("treats an expired token as unknown, never as deleted", async () => {
    mockNotion(["GET", `/pages/${PAGE_ID}`, () => ({ status: 401, json: { code: "unauthorized" } })]);
    expect(await makeNotionTracker({ token: "t" }).getLiveIssues([PAGE_ID])).toEqual({
      issues: {},
      gone: [],
    });
  });
});

describe("an expired connection", () => {
  // The same words as every other tracker: the page is called Settings.
  it("sends the user to Settings to reconnect", async () => {
    mockNotion(["GET", `/pages/${PAGE_ID}`, () => ({ status: 401, json: { code: "unauthorized" } })]);
    await expect(makeNotionTracker({ token: "t" }).getIssue(PAGE_ID)).rejects.toThrow(
      "Your Notion connection has expired - reconnect Notion under Settings, then retry.",
    );
  });
});

describe("listNotionWorkspaces", () => {
  const me = (bot: Record<string, unknown>) => ({
    object: "user",
    id: BOT_ID,
    name: "Brief",
    avatar_url: null,
    type: "bot",
    bot,
    request_id: "a1b2c3d4-0000-4000-8000-000000000000",
  });

  it("is the one workspace the integration was installed in", async () => {
    const calls = mockNotion([
      "GET",
      "/users/me",
      () => ({
        json: me({
          owner: { type: "workspace", workspace: true },
          workspace_id: "ws-7f3a",
          workspace_name: "Acme",
          workspace_limits: { max_file_upload_size_in_bytes: 5242880 },
        }),
      }),
    ]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([{ id: "ws-7f3a", name: "Acme" }]);
    expect(calls[0].url).toBe(`${API}/users/me`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.get("Notion-Version")).toBe("2022-06-28");
  });

  it("has no workspace when the bot carries no id, rather than keying an org by its name", async () => {
    // The id becomes an org key that shares ticket rules and a leaderboard;
    // "Acme" is many companies.
    mockNotion([
      "GET",
      "/users/me",
      () => ({ json: me({ owner: { type: "workspace", workspace: true }, workspace_name: "Acme" }) }),
    ]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([]);
  });

  it("names an id-only workspace with a plain label", async () => {
    mockNotion([
      "GET",
      "/users/me",
      () => ({ json: me({ owner: { type: "workspace", workspace: true }, workspace_id: "ws-7f3a", workspace_name: null }) }),
    ]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([{ id: "ws-7f3a", name: "Notion workspace" }]);
  });

  it("is empty when there is no workspace to name, or Notion fails", async () => {
    mockNotion(["GET", "/users/me", () => ({ json: me({}) })]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([]);

    mockNotion(["GET", "/users/me", () => ({ status: 500, json: { message: "internal" } })]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([]);

    mockNotion(["GET", "/users/me", () => ({ status: 401, json: { code: "unauthorized" } })]);
    expect(await listNotionWorkspaces({ token: "t" })).toEqual([]);
  });
});
