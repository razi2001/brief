import { afterEach, describe, expect, it, vi } from "vitest";
import { listMondayAccount, makeMondayTracker } from "@/lib/monday";
import {
  buildMondayBody,
  columnLabels,
  peopleColumn,
  pickPriorityLabel,
  priorityColumn,
  statusColumn,
  stripHtml,
} from "@/lib/monday-body";
import { STATUS_COLOR } from "@/lib/tracker";

// ---------------------------------------------------------------------------
// Fixtures, shaped like monday.com's API (version 2026-07) answers them
// ---------------------------------------------------------------------------

const TOKEN = "tok-123";
const BOARD_ID = "1234567890";
const ITEM_ID = "5551";

// A status column's settings: labels keyed by index, with an empty "Default"
// slot that is not a real choice.
const STATUS_SETTINGS = JSON.stringify({
  done_colors: [1],
  labels: { "0": "Working on it", "1": "Done", "2": "Stuck", "5": "" },
  labels_positions_v2: { "0": 0, "1": 2, "2": 1, "5": 3 },
  labels_colors: {
    "0": { color: "#fdab3d", border: "#e99729", var_name: "orange" },
    "1": { color: "#00c875", border: "#00b461", var_name: "green-shadow" },
    "2": { color: "#df2f4a", border: "#ce3048", var_name: "red-shadow" },
    "5": { color: "#c4c4c4", border: "#b0b0b0", var_name: "grey" },
  },
});

// monday's stock Priority column, emoji included.
const CRITICAL = "Critical ⚠️";
const PRIORITY_SETTINGS = JSON.stringify({
  labels: { "7": "Low", "10": CRITICAL, "11": "Medium", "110": "High", "5": "" },
  labels_colors: {},
});

const DROPDOWN_SETTINGS = JSON.stringify({
  hide_footer: false,
  labels: [
    { id: 1, name: "Chrome" },
    { id: 2, name: "Firefox" },
    { id: 3, name: "Safari" },
  ],
});

const COLUMNS = [
  { id: "name", title: "Name", type: "name", settings_str: "{}" },
  { id: "subitems_mkp1", title: "Subitems", type: "subtasks", settings_str: "{}" },
  { id: "person", title: "Owner", type: "people", settings_str: "{}" },
  { id: "status", title: "Status", type: "status", settings_str: STATUS_SETTINGS },
  { id: "priority_1", title: "Priority", type: "status", settings_str: PRIORITY_SETTINGS },
  { id: "dropdown_mkp2", title: "Browser", type: "dropdown", settings_str: DROPDOWN_SETTINGS },
  { id: "date4", title: "Due date", type: "date", settings_str: "{}" },
  { id: "text_mkp3", title: "Environment", type: "text", settings_str: "{}" },
  { id: "long_text_mkp4", title: "Notes", type: "long_text", settings_str: "{}" },
  { id: "formula_mkp5", title: "Age", type: "formula", settings_str: "{}" },
  { id: "pulse_log_mkp6", title: "Creation log", type: "creation_log", settings_str: "{}" },
  { id: "link_mkp8", title: "Ticket link", type: "link", settings_str: "{}" },
  { id: "files", title: "Files", type: "file", settings_str: "{}" },
  { id: "item_id_mkp9", title: "Item ID", type: "item_id", settings_str: "{}" },
  { id: "progress_mkpa", title: "Progress", type: "progress", settings_str: "{}" },
  { id: "button_mkpb", title: "Notify", type: "button", settings_str: "{}" },
  { id: "vote_mkpc", title: "Votes", type: "vote", settings_str: "{}" },
  { id: "integration_mkpd", title: "GitHub", type: "integration", settings_str: "{}" },
];

const BOARD = {
  data: {
    boards: [
      {
        id: BOARD_ID,
        name: "Bugs",
        description: "Customer-reported bugs",
        columns: COLUMNS,
        groups: [
          { id: "topics", title: "New" },
          { id: "group_mkp7", title: "Triaged bugs" },
        ],
        subscribers: [
          { id: "111", name: "Ann Lee" },
          { id: "222", name: "Bob Stone" },
        ],
      },
    ],
  },
  account_id: 9876,
};

const ACCOUNT_USERS = [
  { id: "111", name: "Ann Lee", email: "ann@acme.com" },
  { id: "222", name: "Bob Stone", email: "bob@acme.com" },
];

/** monday filters users on its side: exactly by email, fuzzily by name. */
function usersAnswer(c: Call) {
  const emails = (c.variables.emails as string[] | undefined)?.map((e) => e.toLowerCase());
  const name = (c.variables.name as string | undefined)?.toLowerCase();
  const users = ACCOUNT_USERS.filter((u) =>
    emails ? emails.includes(u.email) : name ? u.name.toLowerCase().includes(name) : true,
  );
  return { data: { users }, account_id: 9876 };
}

/** An item's column_values, as `column_values { id type text column { title } }` returns them. */
function cv(status: string, people = "", priority = "") {
  return [
    { id: "person", type: "people", text: people, column: { title: "Owner" } },
    { id: "status", type: "status", text: status, column: { title: "Status" } },
    { id: "priority_1", type: "status", text: priority, column: { title: "Priority" } },
    { id: "text_mkp3", type: "text", text: "Production", column: { title: "Environment" } },
  ];
}

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

type Call = {
  url: string;
  method: string;
  headers: Headers;
  query: string;
  variables: Record<string, unknown>;
  form?: FormData;
};

/**
 * Stub fetch with a router over the GraphQL query text. Returns every call
 * made. A route that throws makes fetch reject, like a dropped connection.
 */
function mockMonday(route: (c: Call) => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const base = { url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers) };
      let call: Call;
      if (init.body instanceof FormData) {
        call = { ...base, query: String(init.body.get("query")), variables: {}, form: init.body };
      } else {
        const b = JSON.parse(String(init.body)) as { query: string; variables?: Record<string, unknown> };
        call = { ...base, query: b.query, variables: b.variables ?? {} };
      }
      calls.push(call);
      const out = route(call);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const isBoard = (c: Call) => c.query.includes("columns {");
const isUsers = (c: Call) => c.query.includes("users(");
const isCreate = (c: Call) => c.query.includes("create_item(");
/** Every create_update: the description, its retries, the comment. */
const isUpdate = (c: Call) => c.query.includes("create_update(");
/** A create_update that posts the description (not a reply). */
const isBody = (c: Call) => isUpdate(c) && !c.query.includes("parent_id");
const isReply = (c: Call) => isUpdate(c) && c.query.includes("parent_id");
const isDelete = (c: Call) => c.query.includes("delete_item(");
const isUpload = (c: Call) => c.url === "https://api.monday.com/v2/file";

/** An application error, answered the 2025-01+ way: HTTP 200 with `errors[]`. */
const rejected = (message: string, code: string) => ({
  errors: [{ message, extensions: { code } }],
  account_id: 9876,
});

/** The default router for a filing: board, users, create, updates, uploads. */
function filingRoute(over: (c: Call) => unknown = () => undefined) {
  let updates = 0;
  return (c: Call) => {
    const o = over(c);
    if (o !== undefined) return o;
    if (isUpload(c)) return { data: { add_file_to_update: { id: "77" } }, account_id: 9876 };
    if (isBoard(c)) return BOARD;
    if (isUsers(c)) return usersAnswer(c);
    if (isDelete(c)) return { data: { delete_item: { id: ITEM_ID } }, account_id: 9876 };
    if (isCreate(c)) {
      return {
        data: {
          create_item: {
            id: ITEM_ID,
            url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/${ITEM_ID}`,
          },
        },
        account_id: 9876,
      };
    }
    if (isUpdate(c)) {
      updates += 1;
      return { data: { create_update: { id: String(899 + updates) } }, account_id: 9876 };
    }
    throw new Error(`unexpected query: ${c.query}`);
  };
}

const PNG = Buffer.from("png-bytes");
const WEBM = Buffer.from("webm-bytes");

// ---------------------------------------------------------------------------
// Column picking
// ---------------------------------------------------------------------------

describe("column picking", () => {
  it("finds the Status, Priority and People columns on a real board", () => {
    expect(statusColumn(COLUMNS)?.id).toBe("status");
    expect(priorityColumn(COLUMNS)?.id).toBe("priority_1");
    expect(peopleColumn(COLUMNS)?.id).toBe("person");
  });

  // Teams rename the status column, and keep a Priority column of the same
  // type beside it. The status is the first one that is not the priority.
  it("falls back to the first status column that is not the priority one", () => {
    const cols = [
      { id: "p", title: "Priority", type: "status" },
      { id: "s", title: "Stage", type: "status" },
    ];
    expect(statusColumn(cols)?.id).toBe("s");
    expect(priorityColumn(cols)?.id).toBe("p");
  });

  it("never mistakes the priority column for the status one", () => {
    const cols = [{ id: "p", title: "Priority", type: "status" }];
    expect(statusColumn(cols)).toBeUndefined();
  });

  // A board with an Owner and a Reviewer column assigns the ticket to the
  // owner, whichever comes first.
  it("prefers a people column titled like an assignee, else the first one", () => {
    expect(
      peopleColumn([
        { id: "r", title: "Reviewer", type: "people" },
        { id: "a", title: "Assignee", type: "people" },
      ])?.id,
    ).toBe("a");
    expect(
      peopleColumn([
        { id: "r", title: "Reviewer", type: "people" },
        { id: "o", title: "Owner", type: "people" },
      ])?.id,
    ).toBe("o");
    expect(peopleColumn([{ id: "w", title: "Watchers", type: "people" }])?.id).toBe("w");
  });

  it("prefers a column titled Status over an earlier status column", () => {
    const cols = [
      { id: "a", title: "Severity", type: "status" },
      { id: "b", title: "Bug status", type: "status" },
    ];
    expect(statusColumn(cols)?.id).toBe("b");
  });
});

describe("columnLabels", () => {
  it("reads a status column's labels and drops the blank default slot", () => {
    expect(columnLabels(COLUMNS[3])).toEqual(["Working on it", "Done", "Stuck"]);
  });

  it("reads a dropdown column's label names", () => {
    expect(columnLabels(COLUMNS[5])).toEqual(["Chrome", "Firefox", "Safari"]);
  });

  it("returns nothing for other columns or unreadable settings", () => {
    expect(columnLabels(COLUMNS[7])).toEqual([]);
    expect(columnLabels({ type: "status", settings_str: "{not json" })).toEqual([]);
    expect(columnLabels({ type: "status", settings_str: null })).toEqual([]);
  });
});

describe("pickPriorityLabel", () => {
  // matchPriorityLabel compares whole words, and the stock label's emoji would
  // hide "Critical" from it.
  it("matches monday's stock Critical label despite its emoji, keeping the original spelling", () => {
    const labels = columnLabels(COLUMNS[4]);
    expect(pickPriorityLabel("urgent", labels)).toBe(CRITICAL);
    expect(pickPriorityLabel("high", labels)).toBe("High");
    expect(pickPriorityLabel("low", labels)).toBe("Low");
  });

  it("returns undefined when the board has no such label", () => {
    expect(pickPriorityLabel("low", ["High", "Medium"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

describe("buildMondayBody", () => {
  it("lists each caption next to the file it describes, under a new Evidence heading", () => {
    const md = buildMondayBody("The cart is empty.", [
      { contentType: "image/png", caption: "The cart shows zero items" },
      { contentType: "image/png" },
      { contentType: "video/webm", caption: "Adding an item" },
    ]);
    expect(md).toBe(
      [
        "The cart is empty.",
        "",
        "## Evidence",
        "",
        "- **Screenshot 1:** The cart shows zero items",
        "- **Screenshot 2**",
        "- **Screen recording:** Adding an item",
      ].join("\n"),
    );
  });

  // The agent sometimes writes its own Evidence section; a second heading
  // produced tickets with the section twice on GitHub.
  it("puts the captions inside the agent's own Evidence section, before the next one", () => {
    const written = [
      "Something broke.",
      "",
      "### Evidence",
      "",
      "The badge is clipped.",
      "",
      "### Environment",
      "",
      "Chrome 141",
    ].join("\n");
    const md = buildMondayBody(written, [{ contentType: "image/png", caption: "The clipped badge" }]);
    expect(md.match(/evidence/gi)).toHaveLength(1);
    expect(md).toContain("The badge is clipped.\n\n- **Screenshot 1:** The clipped badge\n\n### Environment");
  });

  // monday renders the markdown without promoting labels, so a bold label is
  // the agent's section as it will be seen, colon or not.
  it("treats a bold Evidence label as the agent's own section, ending at the next label", () => {
    const md = buildMondayBody("Broken.\n\n**Evidence:**\n\nThe badge.\n\n**Environment**\n\nChrome 141", [
      { contentType: "image/png", caption: "The clipped badge" },
    ]);
    expect(md.match(/evidence/gi)).toHaveLength(1);
    expect(md).toContain("The badge.\n\n- **Screenshot 1:** The clipped badge\n\n**Environment**");
  });

  it("adds nothing when no file has a caption", () => {
    expect(buildMondayBody("Body.", [{ contentType: "image/png" }])).toBe("Body.");
  });

  it("strips a body to plain text, one block per line, entities kept", () => {
    expect(
      stripHtml(
        '<h3>Steps</h3>\n<ol><li>Open <code>&lt;Cart&gt;</code></li><li>Log in</li></ol>\n<hr>\n<p>Reported with <a href="https://x.test/">Brief</a></p>',
      ),
    ).toBe("Steps\n\nOpen &lt;Cart&gt;\nLog in\n\n---\n\nReported with Brief");
  });

  // The caption list and the attachment names must agree, or a caption
  // describes the wrong file.
  it("numbers a second recording the way its file is named", () => {
    const md = buildMondayBody("Body.", [
      { contentType: "video/webm", caption: "First" },
      { contentType: "image/png", caption: "Shot" },
      { contentType: "video/mp4", caption: "Second" },
    ]);
    expect(md).toContain("- **Screen recording:** First\n- **Screenshot 1:** Shot\n- **Screen recording 2:** Second");
  });
});

// ---------------------------------------------------------------------------
// Account and targets
// ---------------------------------------------------------------------------

describe("listMondayAccount", () => {
  it("returns the token's one account", async () => {
    const calls = mockMonday(() => ({
      data: { me: { account: { id: 9876, name: "Acme", slug: "acme" } } },
      account_id: 9876,
    }));
    expect(await listMondayAccount({ token: TOKEN })).toEqual([{ id: "9876", name: "Acme" }]);
    expect(calls[0].query).toContain("me { account { id name slug } }");
  });

  it("returns [] when the token no longer works", async () => {
    mockMonday(() => new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), { status: 401 }));
    expect(await listMondayAccount({ token: TOKEN })).toEqual([]);
  });
});

describe("listTargets", () => {
  it("keeps real boards only, named with their workspace", async () => {
    const calls = mockMonday(() => ({
      data: {
        boards: [
          { id: "1", name: "Bugs", description: "Bug intake", type: "board", workspace: { name: "Product" } },
          { id: "2", name: "Subitems of Bugs", description: null, type: "sub_items_board", workspace: { name: "Product" } },
          { id: "3", name: "Spec", description: null, type: "document", workspace: null },
          { id: "4", name: "Roadmap", description: "", type: "board", workspace: null },
        ],
      },
      account_id: 9876,
    }));
    const targets = await makeMondayTracker({ token: TOKEN }).listTargets();
    expect(targets).toEqual([
      { id: "1", key: "Bugs", name: "Product / Bugs", description: "Bug intake" },
      { id: "4", key: "Roadmap", name: "Roadmap", description: undefined },
    ]);
    expect(calls[0].query).toContain("boards(limit: 100, state: active, order_by: used_at)");
  });
});

describe("getTargetDetails", () => {
  it("offers the status labels, groups, subscribers and the remaining settable columns", async () => {
    const calls = mockMonday(() => BOARD);
    const d = await makeMondayTracker({ token: TOKEN }).getTargetDetails(BOARD_ID);
    expect(calls[0].variables).toEqual({ ids: [BOARD_ID] });
    expect(d.states).toEqual(["Working on it", "Done", "Stuck"]);
    expect(d.projects).toEqual([
      { id: "topics", name: "New" },
      { id: "group_mkp7", name: "Triaged bugs" },
    ]);
    expect(d.members).toEqual(["Ann Lee", "Bob Stone"]);
    // Status, priority and people are reachable through their own parameters;
    // name, subitems, computed and read-only columns, files, buttons, votes
    // and integrations can't be set at all.
    expect(d.customFields).toEqual([
      { id: "dropdown_mkp2", name: "Browser", type: "dropdown", allowedValues: ["Chrome", "Firefox", "Safari"] },
      { id: "date4", name: "Due date", type: "date" },
      { id: "text_mkp3", name: "Environment", type: "text" },
      { id: "long_text_mkp4", name: "Notes", type: "long_text" },
      { id: "link_mkp8", name: "Ticket link", type: "link" },
    ]);
  });

  it("names the known boards when the id is wrong", async () => {
    mockMonday((c) =>
      isBoard(c)
        ? { data: { boards: [] }, account_id: 9876 }
        : { data: { boards: [{ id: "1", name: "Bugs", type: "board", workspace: null }] }, account_id: 9876 },
    );
    await expect(makeMondayTracker({ token: TOKEN }).getTargetDetails("42")).rejects.toThrow(
      "Known boards: Bugs (id: 1)",
    );
  });
});

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

describe("fileIssue", () => {
  const input = {
    targetId: BOARD_ID,
    title: "Cart empties after login",
    descriptionMarkdown: "**Steps to reproduce**\n\n1. Add an item\n2. Log in",
    state: "stuck",
    priority: "urgent" as const,
    assignee: "ann@acme.com",
    project: "triaged",
    comment: "Seen on prod too",
    extraFields: {
      Browser: "chrome",
      date4: "2026-10-01T10:00:00Z",
      Environment: "Production",
      Notes: "Only on mobile",
    },
    evidence: [
      { filename: "shot-0.png", contentType: "image/png", bytes: PNG, caption: "The cart shows zero items" },
      { filename: "rec-1699.webm", contentType: "video/webm", bytes: WEBM },
    ],
    details: [
      { title: "Network", markdown: "GET /api/cart 500" },
      { title: "Console", markdown: "" },
    ],
  };

  it("creates the item with resolved column values and group", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);

    const create = calls.find(isCreate)!;
    expect(create.url).toBe("https://api.monday.com/v2");
    expect(create.method).toBe("POST");
    // A typo'd label must never add a stray option to the team's column.
    expect(create.query).toContain("create_labels_if_missing: false");
    expect(create.variables).toMatchObject({ board: BOARD_ID, group: "group_mkp7", name: input.title });
    expect(JSON.parse(String(create.variables.cols))).toEqual({
      status: { label: "Stuck" },
      priority_1: { label: CRITICAL },
      person: { personsAndTeams: [{ id: 111, kind: "person" }] },
      dropdown_mkp2: { labels: ["Chrome"] },
      date4: { date: "2026-10-01" },
      text_mkp3: "Production",
      long_text_mkp4: { text: "Only on mobile" },
    });
  });

  // The person is found by monday's own filter, not by paging the account.
  it("looks the assignee up by email, or by name when it isn't one", async () => {
    let calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, comment: undefined });
    let lookup = calls.find(isUsers)!;
    expect(lookup.query).toContain("users(emails: $emails");
    expect(lookup.variables).toEqual({ emails: ["ann@acme.com"] });

    calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, assignee: "bob", comment: undefined });
    lookup = calls.find(isUsers)!;
    expect(lookup.query).toContain("users(name: $name");
    expect(lookup.variables).toEqual({ name: "bob" });
    expect(JSON.parse(String(calls.find(isCreate)!.variables.cols)).person).toEqual({
      personsAndTeams: [{ id: 222, kind: "person" }],
    });
  });

  it("posts the description as the item's first update, in HTML, ending with the attribution", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);

    expect(calls.filter(isBody)).toHaveLength(1);
    const update = calls.filter(isBody)[0];
    expect(update.variables.item).toBe(ITEM_ID);
    const body = String(update.variables.body);
    expect(body).toContain("<p><strong>Steps to reproduce</strong></p>");
    expect(body).toContain("<ol><li>Add an item</li><li>Log in</li></ol>");
    expect(body.match(/Evidence/g)).toHaveLength(1);
    expect(body).toContain("<li><strong>Screenshot 1:</strong> The cart shows zero items</li>");
    expect(body).toContain("<li><strong>Screen recording</strong></li>");
    expect(body).toMatch(/<hr>\n<p>Reported with <a href="https:\/\/cloud\.get-brief\.app\/"[^>]*>Brief<\/a><\/p>$/);
    // Neither the capture's file names nor the logs file are ever mentioned.
    expect(body).not.toContain("shot-0");
    expect(body).not.toContain("rec-1699");
    expect(body).not.toMatch(/technical|logs/i);
  });

  it("attaches the evidence and then technical-logs.md to that update through /v2/file", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);

    const uploads = calls.filter(isUpload);
    expect(uploads).toHaveLength(3);
    for (const u of uploads) {
      expect(u.method).toBe("POST");
      expect(u.query).toBe(
        "mutation ($file: File!) { add_file_to_update(update_id: 900, file: $file) { id } }",
      );
      // fetch writes the multipart boundary; a hand-set type would break it.
      expect(u.headers.get("Content-Type")).toBeNull();
    }
    const files = uploads.map((u) => u.form!.get("variables[file]") as File);
    expect(files.map((f) => f.name)).toEqual(["screenshot-1.png", "screen-recording.webm", "technical-logs.md"]);
    expect(files[0].type).toBe("image/png");
    expect(Buffer.from(await files[0].arrayBuffer())).toEqual(PNG);
    expect(files[2].type).toBe("text/markdown");
    expect(await files[2].text()).toBe("## Network\n\nGET /api/cart 500\n");
  });

  // monday lists updates newest first: a top-level comment would sit above
  // the description and push it down.
  it("posts the comment as a reply under the description, after the uploads", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    const replies = calls.filter(isReply);
    expect(replies).toHaveLength(1);
    expect(replies[0].query).toContain("create_update(item_id: $item, parent_id: $parent, body: $body)");
    expect(replies[0].variables).toEqual({ item: ITEM_ID, parent: "900", body: "<p>Seen on prod too</p>" });
    expect(calls.indexOf(replies[0])).toBeGreaterThan(calls.indexOf(calls.filter(isUpload)[2]));
  });

  it("posts the comment top-level when monday refuses the reply", async () => {
    const calls = mockMonday(
      filingRoute((c) => (isReply(c) ? rejected("Invalid parent id", "InvalidArgumentException") : undefined)),
    );
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    const bodies = calls.filter(isBody);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].variables).toEqual({ item: ITEM_ID, body: "<p>Seen on prod too</p>" });
  });

  // After a timeout the reply may already be there; a second post would duplicate it.
  it("does not repost the comment when the reply failed in transit", async () => {
    const calls = mockMonday(
      filingRoute((c) => (isReply(c) ? new Response("bad gateway", { status: 502 }) : undefined)),
    );
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    expect(calls.filter(isReply)).toHaveLength(1);
    expect(calls.filter(isBody)).toHaveLength(1);
  });

  it("returns the item id as the identifier, with the item's own url", async () => {
    mockMonday(filingRoute());
    const r = await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    expect(r).toEqual({
      id: ITEM_ID,
      identifier: ITEM_ID,
      url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/${ITEM_ID}`,
      title: input.title,
    });
  });

  it("sends the bare token with the pinned API version on every call", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    for (const c of calls) {
      expect(c.headers.get("Authorization")).toBe(TOKEN);
      expect(c.headers.get("API-Version")).toBe("2026-07");
    }
    expect(calls.find(isCreate)!.headers.get("Content-Type")).toBe("application/json");
  });

  it("skips a status, priority or person the board doesn't have, never creating one", async () => {
    const calls = mockMonday(filingRoute());
    await makeMondayTracker({ token: TOKEN }).fileIssue({
      targetId: BOARD_ID,
      title: "t",
      descriptionMarkdown: "b",
      state: "Shipped",
      assignee: "Nobody Here",
      project: "No such group",
      evidence: [],
    });
    const create = calls.find(isCreate)!;
    expect(create.variables.cols).toBeUndefined();
    expect(create.variables.group).toBeUndefined();
    // No evidence and no logs: nothing to upload.
    expect(calls.filter(isUpload)).toHaveLength(0);
  });

  it("files the item bare when monday rejects a column value", async () => {
    const calls = mockMonday(
      filingRoute((c) =>
        isCreate(c) && c.variables.cols
          ? {
              data: { create_item: null },
              errors: [
                {
                  message: "Incorrect column value formatting",
                  path: ["create_item"],
                  extensions: { code: "ColumnValueException" },
                },
              ],
              account_id: 9876,
            }
          : undefined,
      ),
    );
    const r = await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, comment: undefined });
    const creates = calls.filter(isCreate);
    expect(creates).toHaveLength(2);
    expect(creates[1].variables.cols).toBeUndefined();
    expect(r.identifier).toBe(ITEM_ID);
  });

  // A 5xx, a timeout or a dropped connection may come AFTER monday created
  // the item. Filing again would leave the team with the same bug twice.
  describe("never files twice when the create may have gone through", () => {
    it.each([
      ["a 502", () => new Response("<html>bad gateway</html>", { status: 502 })],
      ["a 500 with an error body", () => new Response(JSON.stringify({ error_message: "Internal server error", status_code: 500 }), { status: 500 })],
      ["a rejected fetch", () => {
        throw new TypeError("fetch failed");
      }],
      ["an error that is not about a column value", () => rejected("Board not found", "InvalidBoardIdException")],
    ])("%s", async (_label, answer) => {
      const calls = mockMonday(filingRoute((c) => (isCreate(c) ? answer() : undefined)));
      await expect(makeMondayTracker({ token: TOKEN }).fileIssue(input)).rejects.toThrow();
      expect(calls.filter(isCreate)).toHaveLength(1);
      expect(calls.filter(isUpdate)).toHaveLength(0);
    });
  });

  describe("when the description update fails", () => {
    const failing = (n: number, answer: () => unknown = () => new Response("unavailable", { status: 503 })) => {
      let seen = 0;
      return (c: Call) => {
        if (!isBody(c)) return undefined;
        seen += 1;
        return seen <= n ? answer() : undefined;
      };
    };

    it("tries the same HTML once more", async () => {
      const calls = mockMonday(filingRoute(failing(1)));
      const r = await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, comment: undefined });
      const bodies = calls.filter(isBody);
      expect(bodies).toHaveLength(2);
      expect(bodies[1].variables.body).toBe(bodies[0].variables.body);
      // The files go on the one update that exists.
      expect(calls.filter(isUpload)[0].query).toContain("update_id: 900");
      expect(r.identifier).toBe(ITEM_ID);
    });

    it("then the same text without tags", async () => {
      const calls = mockMonday(
        filingRoute(failing(2, () => rejected("Body is invalid", "InvalidArgumentException"))),
      );
      const r = await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, comment: undefined });
      const bodies = calls.filter(isBody);
      expect(bodies).toHaveLength(3);
      const plain = String(bodies[2].variables.body);
      expect(plain).not.toMatch(/<[a-z/]/i);
      expect(plain).toContain("Steps to reproduce");
      expect(plain).toContain("Screenshot 1: The cart shows zero items");
      expect(plain).toContain("Reported with Brief");
      expect(calls.filter(isUpload)[0].query).toContain("update_id: 900");
      expect(r.identifier).toBe(ITEM_ID);
    });

    it("then removes the bare item and fails the filing", async () => {
      const calls = mockMonday(filingRoute(failing(3)));
      await expect(makeMondayTracker({ token: TOKEN }).fileIssue(input)).rejects.toThrow(
        /would not take the item's description, so the item was removed/,
      );
      expect(calls.filter(isBody)).toHaveLength(3);
      const del = calls.find(isDelete)!;
      expect(del.variables).toEqual({ item: ITEM_ID });
      // Nothing is uploaded or commented on an item that no longer exists.
      expect(calls.filter(isUpload)).toHaveLength(0);
      expect(calls.filter(isReply)).toHaveLength(0);
    });

    it("says so when the bare item can't be removed either", async () => {
      const bodyFails = failing(3);
      mockMonday(filingRoute((c) => (isDelete(c) ? new Response("unavailable", { status: 503 }) : bodyFails(c))));
      await expect(makeMondayTracker({ token: TOKEN }).fileIssue(input)).rejects.toThrow(
        `Monday would not take the description of item ${ITEM_ID}, and it could not be removed`,
      );
    });
  });

  it("builds the item url from the account slug when monday returns none", async () => {
    mockMonday(
      filingRoute((c) => {
        if (isCreate(c)) return { data: { create_item: { id: ITEM_ID, url: null } }, account_id: 9876 };
        if (c.query.includes("me {")) {
          return { data: { me: { account: { id: 9876, name: "Acme", slug: "acme-co" } } }, account_id: 9876 };
        }
        return undefined;
      }),
    );
    const r = await makeMondayTracker({ token: TOKEN }).fileIssue({ ...input, comment: undefined });
    expect(r.url).toBe(`https://acme-co.monday.com/boards/${BOARD_ID}/pulses/${ITEM_ID}`);
  });

  it("keeps the filed item when an upload fails", async () => {
    const calls = mockMonday(
      filingRoute((c) =>
        isUpload(c) ? new Response(JSON.stringify({ error_message: "File too large" }), { status: 400 }) : undefined,
      ),
    );
    const r = await makeMondayTracker({ token: TOKEN }).fileIssue(input);
    expect(r.identifier).toBe(ITEM_ID);
    // Every file is still tried, and the comment still lands.
    expect(calls.filter(isUpload)).toHaveLength(3);
    expect(calls.filter(isReply)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Update and read back
// ---------------------------------------------------------------------------

describe("updateIssue", () => {
  const itemBoard = { data: { items: [{ id: ITEM_ID, board: { id: BOARD_ID } }] }, account_id: 9876 };

  function updateRoute(c: Call) {
    if (c.query.includes("items(ids: $ids) { id board { id } }")) return itemBoard;
    if (isBoard(c)) return BOARD;
    if (isUsers(c)) return usersAnswer(c);
    if (c.query.includes("change_multiple_column_values")) {
      return { data: { change_multiple_column_values: { id: ITEM_ID } }, account_id: 9876 };
    }
    if (c.query.includes("move_item_to_group")) return { data: { move_item_to_group: { id: ITEM_ID } }, account_id: 9876 };
    throw new Error(`unexpected query: ${c.query}`);
  }

  it("changes the columns and title in one mutation, then moves the group", async () => {
    const calls = mockMonday(updateRoute);
    const r = await makeMondayTracker({ token: TOKEN }).updateIssue(ITEM_ID, {
      state: "done",
      title: "Cart empties after login on mobile",
      priority: "high",
      assignee: "Bob",
      project: "New",
    });
    expect(r).toEqual({ ok: true });

    const change = calls.find((c) => c.query.includes("change_multiple_column_values"))!;
    expect(change.query).toContain("create_labels_if_missing: false");
    expect(change.variables.item).toBe(ITEM_ID);
    expect(change.variables.board).toBe(BOARD_ID);
    expect(JSON.parse(String(change.variables.cols))).toEqual({
      status: { label: "Done" },
      priority_1: { label: "High" },
      person: { personsAndTeams: [{ id: 222, kind: "person" }] },
      name: "Cart empties after login on mobile",
    });
    const move = calls.find((c) => c.query.includes("move_item_to_group"))!;
    expect(move.variables).toEqual({ item: ITEM_ID, group: "topics" });
  });

  it("reports an unknown status with the valid ones, and changes nothing", async () => {
    const calls = mockMonday(updateRoute);
    const r = await makeMondayTracker({ token: TOKEN }).updateIssue(ITEM_ID, { state: "Shipped" });
    expect(r).toEqual({ ok: false, error: 'Unknown status "Shipped". Valid: Working on it, Done, Stuck' });
    expect(calls.some((c) => c.query.includes("change_multiple_column_values"))).toBe(false);
  });

  it("reports an unknown group, person and custom field value", async () => {
    mockMonday(updateRoute);
    const t = makeMondayTracker({ token: TOKEN });
    expect(await t.updateIssue(ITEM_ID, { project: "Icebox" })).toEqual({
      ok: false,
      error: 'Unknown group "Icebox". Valid: New, Triaged bugs',
    });
    expect(await t.updateIssue(ITEM_ID, { assignee: "Zed" })).toEqual({
      ok: false,
      error: 'Unknown person "Zed". Valid: Ann Lee, Bob Stone',
    });
    expect(await t.updateIssue(ITEM_ID, { extraFields: { Browser: "Edge" } })).toEqual({
      ok: false,
      error: 'Unknown value "Edge" for Browser. Valid: Chrome, Firefox, Safari',
    });
  });

  it("names the JSON a column takes when a plain value can't set it", async () => {
    mockMonday(updateRoute);
    expect(
      await makeMondayTracker({ token: TOKEN }).updateIssue(ITEM_ID, {
        extraFields: { "Ticket link": "https://acme.test/t/1" },
      }),
    ).toEqual({
      ok: false,
      error: 'Ticket link (a link column) takes an object like {"url": "https://...", "text": "..."}.',
    });
  });

  it("refuses a read-only column as unknown, listing the settable ones", async () => {
    mockMonday(updateRoute);
    const r = await makeMondayTracker({ token: TOKEN }).updateIssue(ITEM_ID, { extraFields: { Progress: "50" } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Unknown column "Progress"\. Valid: /);
    expect(!r.ok && r.error).not.toMatch(/Progress,|Files|Votes|Item ID/);
  });

  it("passes monday's own message back when the mutation fails", async () => {
    mockMonday((c) =>
      c.query.includes("change_multiple_column_values")
        ? { errors: [{ message: "Incorrect column value formatting", extensions: { code: "ColumnValueException" } }] }
        : updateRoute(c),
    );
    const r = await makeMondayTracker({ token: TOKEN }).updateIssue(ITEM_ID, { extraFields: { Environment: "x" } });
    expect(r).toEqual({ ok: false, error: "Monday: Incorrect column value formatting" });
  });

  it("rejects an identifier that is not an item id, and an item that isn't there", async () => {
    mockMonday(() => ({ data: { items: [] }, account_id: 9876 }));
    const t = makeMondayTracker({ token: TOKEN });
    expect((await t.updateIssue("RAZ-12", { state: "Done" })).ok).toBe(false);
    expect(await t.updateIssue("999", { state: "Done" })).toEqual({ ok: false, error: "Monday item 999 not found." });
  });
});

describe("getIssue", () => {
  it("reads the item back as a flat record", async () => {
    const calls = mockMonday(() => ({
      data: {
        items: [
          {
            id: ITEM_ID,
            name: "Cart empties after login",
            url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/${ITEM_ID}`,
            state: "active",
            board: { id: BOARD_ID, name: "Bugs" },
            group: { title: "Triaged bugs" },
            column_values: cv("Stuck", "Ann Lee", "High"),
          },
        ],
      },
      account_id: 9876,
    }));
    const i = await makeMondayTracker({ token: TOKEN }).getIssue(ITEM_ID);
    expect(calls[0].variables).toEqual({ ids: [ITEM_ID] });
    expect(i).toEqual({
      identifier: ITEM_ID,
      title: "Cart empties after login",
      url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/${ITEM_ID}`,
      board: "Bugs",
      group: "Triaged bugs",
      state: "Stuck",
      priority: "High",
      assignee: "Ann Lee",
      itemState: "active",
      Environment: "Production",
    });
  });
});

// ---------------------------------------------------------------------------
// Search and live read
// ---------------------------------------------------------------------------

describe("searchIssues", () => {
  it("searches item names on the most used boards, best effort per board", async () => {
    const calls = mockMonday((c) => {
      if (c.query.includes("order_by: used_at")) {
        return {
          data: {
            boards: [
              { id: "1", name: "Bugs", type: "board", workspace: { name: "Product" } },
              { id: "2", name: "Private", type: "board", workspace: null },
            ],
          },
          account_id: 9876,
        };
      }
      if ((c.variables.board as string[])[0] === "2") {
        return { errors: [{ message: "User unauthorized to perform action", extensions: { code: "UserUnauthorizedException" } }] };
      }
      return {
        data: {
          boards: [
            {
              id: "1",
              name: "Bugs",
              items_page: {
                items: [
                  {
                    id: "11",
                    name: "Cart empties after login",
                    url: "https://acme.monday.com/boards/1/pulses/11",
                    group: { title: "New" },
                    column_values: cv("Working on it", "Ann Lee, Bob Stone", CRITICAL),
                  },
                ],
              },
            },
          ],
        },
        account_id: 9876,
      };
    });

    const out = await makeMondayTracker({ token: TOKEN }).searchIssues("cart");
    expect(out).toEqual([
      {
        identifier: "11",
        title: "Cart empties after login",
        url: "https://acme.monday.com/boards/1/pulses/11",
        target: "Product / Bugs",
        state: "Working on it",
        assignee: "Ann Lee",
        priority: "urgent",
        project: "New",
      },
    ]);
    const search = calls.find((c) => c.query.includes("items_page"))!;
    expect(search.query).toContain('column_id: "name", compare_value: $q, operator: contains_text');
    expect(search.variables).toEqual({ board: ["1"], q: ["cart"] });
  });

  it("returns [] instead of throwing when monday is down", async () => {
    mockMonday(() => new Response("bad gateway", { status: 502 }));
    expect(await makeMondayTracker({ token: TOKEN }).searchIssues("cart")).toEqual([]);
  });
});

describe("getLiveIssues", () => {
  const item = (id: string, state: string, status: string, people = "") => ({
    id,
    name: `Item ${id}`,
    url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/${id}`,
    state,
    created_at: "2026-10-13T09:00:00Z",
    board: { id: BOARD_ID },
    column_values: cv(status, people),
  });

  it("reads status, assignee and deletions, and never calls a missing item gone", async () => {
    const calls = mockMonday(() => ({
      data: {
        items: [
          item("1", "active", "Working on it", "Ann Lee, Bob Stone"),
          item("2", "deleted", "Done"),
          item("3", "archived", "Working on it"),
          item("5", "active", ""),
          item("6", "active", "Done"),
        ],
      },
      account_id: 9876,
    }));
    const out = await makeMondayTracker({ token: TOKEN }).getLiveIssues(["1", "2", "3", "4", "5", "6"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("items(ids: $ids, limit: 100)");
    expect(calls[0].variables).toEqual({ ids: ["1", "2", "3", "4", "5", "6"] });

    // Deleted is confirmed gone; "4" was left out of the answer, which may
    // only mean this token lost access to its board.
    expect(out.gone).toEqual(["2"]);
    expect(Object.keys(out.issues).sort()).toEqual(["1", "3", "5", "6"]);

    expect(out.issues["1"]).toEqual({
      identifier: "1",
      title: "Item 1",
      url: `https://acme.monday.com/boards/${BOARD_ID}/pulses/1`,
      stateName: "Working on it",
      stateColor: STATUS_COLOR.active,
      createdAt: "2026-10-13T09:00:00Z",
      assignee: { name: "Ann Lee" },
    });
    expect(out.issues["3"]).toMatchObject({ stateName: "Archived", stateColor: STATUS_COLOR.done });
    expect(out.issues["5"]).toMatchObject({ stateName: "Open", stateColor: STATUS_COLOR.neutral, assignee: undefined });
    expect(out.issues["6"]).toMatchObject({ stateName: "Done", stateColor: STATUS_COLOR.done });
  });

  it("asks in chunks of 100", async () => {
    const calls = mockMonday(() => ({ data: { items: [] }, account_id: 9876 }));
    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    await makeMondayTracker({ token: TOKEN }).getLiveIssues(ids);
    expect(calls.map((c) => (c.variables.ids as string[]).length)).toEqual([100, 50]);
  });

  it("leaves `gone` alone when the call fails, so an outage is not a deletion", async () => {
    mockMonday(() => ({ errors: [{ message: "Internal server error" }], account_id: 9876 }));
    const out = await makeMondayTracker({ token: TOKEN }).getLiveIssues(["1"]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });

  // One id monday refuses must not stale every other row in its batch.
  it("asks again in tens, then one by one, when monday refuses a batch", async () => {
    const calls = mockMonday((c) => {
      const ids = c.variables.ids as string[];
      if (ids.includes("7")) return rejected("Invalid item id", "InvalidArgumentException");
      return { data: { items: ids.map((id) => item(id, "active", "Done")) }, account_id: 9876 };
    });
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const out = await makeMondayTracker({ token: TOKEN }).getLiveIssues(ids);

    expect(calls.map((c) => (c.variables.ids as string[]).length)).toEqual([
      12, // the whole batch, refused
      10, // ids 1-10, refused again because of 7
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // then one by one
      2, // ids 11-12
    ]);
    expect(Object.keys(out.issues).sort((a, b) => Number(a) - Number(b))).toEqual(
      ["1", "2", "3", "4", "5", "6", "8", "9", "10", "11", "12"],
    );
    expect(out.gone).toEqual([]);
  });

  it("does not split a batch on an outage, which would only multiply the failures", async () => {
    const calls = mockMonday(() => new Response("bad gateway", { status: 502 }));
    const out = await makeMondayTracker({ token: TOKEN }).getLiveIssues(["1", "2", "3"]);
    expect(calls).toHaveLength(1);
    expect(out).toEqual({ issues: {}, gone: [] });
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("errors", () => {
  it("surfaces a GraphQL error's message", async () => {
    mockMonday(() => ({
      data: { items: null },
      errors: [
        {
          message: "User unauthorized to perform action",
          path: ["items"],
          extensions: { code: "UserUnauthorizedException", status_code: 403 },
        },
      ],
      account_id: 9876,
    }));
    // A permission on one board is not an expired connection.
    await expect(makeMondayTracker({ token: TOKEN }).getIssue(ITEM_ID)).rejects.toThrow(
      "Monday: User unauthorized to perform action",
    );
  });

  it("surfaces the older error_message shape too", async () => {
    mockMonday(
      () =>
        new Response(JSON.stringify({ error_code: "InternalServerError", error_message: "Internal server error", status_code: 500 }), {
          status: 500,
        }),
    );
    await expect(makeMondayTracker({ token: TOKEN }).getIssue(ITEM_ID)).rejects.toThrow("Monday: Internal server error");
  });

  it("asks the user to reconnect when the token is refused", async () => {
    mockMonday(() => new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), { status: 401 }));
    await expect(makeMondayTracker({ token: TOKEN }).getIssue(ITEM_ID)).rejects.toThrow(/reconnect Monday/);
  });
});
