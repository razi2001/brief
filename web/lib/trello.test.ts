import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRELLO_DESC_LIMIT,
  buildTrelloDesc,
  cardCreatedAt,
  listTrelloWorkspaces,
  makeTrelloTracker,
  parseBatchEntry,
  trelloAttachmentNames,
  trelloListColor,
} from "@/lib/trello";
import { BRIEF_ATTRIBUTION, STATUS_COLOR, matchPriorityLabel } from "@/lib/tracker";

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Fixtures: envelopes shaped like Trello's REST answers
// ---------------------------------------------------------------------------

const tok = { key: "app-key", token: "user-token" };

const BOARD_ID = "5f1a2b3c4d5e6f7a8b9c0d1e";
const LIST_TRIAGE = "60aa00000000000000000001";
const LIST_DOING = "60aa00000000000000000002";
const LIST_DONE = "60aa00000000000000000003";
const LABEL_BUG = "61bb00000000000000000001";
const LABEL_P1 = "61bb00000000000000000002";
const LABEL_P3 = "61bb00000000000000000003";
const LABEL_UI = "61bb00000000000000000004";
const MEMBER_DEVIN = "62cc00000000000000000001";
const CARD_ID = "6524f0a1b2c3d4e5f6a7b8c9";

const BOARDS = [
  {
    id: BOARD_ID,
    name: "Product bugs",
    desc: "Bugs reported against the web app",
    url: "https://trello.com/b/AbCdEf12/product-bugs",
    closed: false,
    lists: [
      { id: LIST_TRIAGE, name: "Triage", closed: false, idBoard: BOARD_ID, pos: 16384 },
      { id: LIST_DOING, name: "Doing", closed: false, idBoard: BOARD_ID, pos: 32768 },
      { id: LIST_DONE, name: "Done", closed: false, idBoard: BOARD_ID, pos: 49152 },
    ],
  },
];

const LISTS = BOARDS[0].lists.map(({ id, name }) => ({ id, name }));

const LABELS = [
  { id: LABEL_BUG, idBoard: BOARD_ID, name: "Bug", color: "red" },
  { id: LABEL_P1, idBoard: BOARD_ID, name: "P1", color: "orange" },
  { id: LABEL_P3, idBoard: BOARD_ID, name: "P3", color: "yellow" },
  { id: LABEL_UI, idBoard: BOARD_ID, name: "UI", color: "blue" },
  // Trello ships every board with unnamed colour labels.
  { id: "61bb00000000000000000009", idBoard: BOARD_ID, name: "", color: "green" },
];

const MEMBERS = [{ id: MEMBER_DEVIN, fullName: "Devin Reyes", username: "devinreyes" }];

const CREATED_CARD = {
  id: CARD_ID,
  badges: { attachments: 0, comments: 0 },
  closed: false,
  desc: "",
  idBoard: BOARD_ID,
  idList: LIST_TRIAGE,
  idLabels: [LABEL_BUG],
  idMembers: [],
  name: "Save button does nothing",
  shortLink: "Xy12Ab34",
  shortUrl: "https://trello.com/c/Xy12Ab34",
  url: "https://trello.com/c/Xy12Ab34/12-save-button-does-nothing",
  labels: [],
};

function attachmentEnvelope(name: string, mimeType: string) {
  return {
    id: `6524f0b9${Math.random().toString(16).slice(2, 18).padEnd(16, "0")}`,
    bytes: 68,
    date: "2026-10-13T10:00:00.000Z",
    edgeColor: null,
    idMember: MEMBER_DEVIN,
    isUpload: true,
    mimeType,
    name,
    previews: [],
    url: `https://trello.com/1/cards/${CARD_ID}/attachments/x/download/${name}`,
    pos: 16384,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: URL; method: string; init?: RequestInit };

/**
 * Stub fetch with a router. Unrouted requests fail the test loudly, so a call
 * the adapter should not make (creating a label, say) cannot slip by.
 */
function mockTrello(route: (c: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const call = { url: new URL(input), method: (init?.method ?? "GET").toUpperCase(), init };
      calls.push(call);
      const r = route(call);
      if (!r) throw new Error(`unexpected ${call.method} ${call.url.pathname}`);
      return r;
    }),
  );
  return calls;
}

/** The board-reading routes every filing needs. */
function boardRoutes(c: Call): Response | undefined {
  const p = c.url.pathname;
  if (c.method !== "GET") return undefined;
  if (p === "/1/members/me/boards") return json(BOARDS);
  if (p === `/1/boards/${BOARD_ID}/lists`) return json(LISTS);
  if (p === `/1/boards/${BOARD_ID}/labels`) return json(LABELS);
  if (p === `/1/boards/${BOARD_ID}/members`) return json(MEMBERS);
  return undefined;
}

function filingRoutes(opts: { failAttachment?: (name: string) => boolean } = {}) {
  return (c: Call): Response | undefined => {
    const p = c.url.pathname;
    if (c.method === "POST" && p === "/1/cards") return json(CREATED_CARD);
    if (c.method === "POST" && p === `/1/cards/${CARD_ID}/attachments`) {
      const name = c.url.searchParams.get("name") ?? "";
      if (opts.failAttachment?.(name)) return new Response("request entity too large", { status: 413 });
      return json(attachmentEnvelope(name, c.url.searchParams.get("mimeType") ?? ""));
    }
    if (c.method === "POST" && p === `/1/cards/${CARD_ID}/actions/comments`) {
      return json({ id: "act1", type: "commentCard", data: JSON.parse(String(c.init?.body)) });
    }
    return boardRoutes(c);
  };
}

const png = (filename: string, caption?: string) => ({
  filename,
  contentType: "image/png",
  bytes: Buffer.from("png-bytes"),
  caption,
  url: `https://cloud.get-brief.app/api/evidence/s1/screenshots/${filename}`,
});

const webm = (filename: string) => ({
  filename,
  contentType: "video/webm",
  bytes: Buffer.from("webm-bytes"),
  url: `https://cloud.get-brief.app/api/evidence/s1/recordings/${filename}`,
});

const attachmentCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/attachments"));

const uploadedFile = (c: Call) => (c.init?.body as FormData).get("file") as File;

// ---------------------------------------------------------------------------
// Pure helpers (ported)
// ---------------------------------------------------------------------------

describe("trelloListColor", () => {
  // A Trello card has no status field - the LIST it sits in is its status - so
  // the list name is the only thing there is to colour by.
  it("reads a finished-sounding list as done", () => {
    expect(trelloListColor("Done")).toBe(STATUS_COLOR.done);
    expect(trelloListColor("Shipped")).toBe(STATUS_COLOR.done);
    expect(trelloListColor("Completed")).toBe(STATUS_COLOR.done);
  });

  it("reads an in-flight list as active", () => {
    expect(trelloListColor("Doing")).toBe(STATUS_COLOR.active);
    expect(trelloListColor("In Progress")).toBe(STATUS_COLOR.active);
    expect(trelloListColor("Code review")).toBe(STATUS_COLOR.active);
  });

  it("leaves anything it can't read as neutral", () => {
    expect(trelloListColor("Triage")).toBe(STATUS_COLOR.neutral);
    expect(trelloListColor("Backlog")).toBe(STATUS_COLOR.neutral);
    expect(trelloListColor("")).toBe(STATUS_COLOR.neutral);
  });

  it("matches on whole words, so a list is not miscoloured by a substring", () => {
    // "Redone" contains "done" but is not a done column.
    expect(trelloListColor("Redone ideas")).toBe(STATUS_COLOR.neutral);
  });
});

describe("cardCreatedAt", () => {
  // Trello exposes no creation timestamp on a card. Its id is a MongoDB
  // ObjectId whose first four bytes are the Unix seconds, which is the only
  // creation time available.
  it("reads the timestamp out of the card id", () => {
    // 0x5f000000 = 1593835520 seconds = 2020-07-04T04:05:20Z
    expect(cardCreatedAt("5f000000aaaaaaaaaaaaaaaa")).toBe("2020-07-04T04:05:20.000Z");
  });

  it("returns empty for an id that isn't an ObjectId, rather than a bogus date", () => {
    expect(cardCreatedAt("shortlink")).toBe("");
    expect(cardCreatedAt("")).toBe("");
    expect(cardCreatedAt("zzzzzzzzaaaaaaaaaaaaaaaa")).toBe("");
  });
});

describe("priority on a board with no priority field", () => {
  it("adopts an existing board label", () => {
    expect(matchPriorityLabel("urgent", ["Bug", "P0", "Design"])).toBe("P0");
  });

  it("sets nothing when the board has no priority-ish label", () => {
    expect(matchPriorityLabel("high", ["Bug", "Design"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The description
// ---------------------------------------------------------------------------

describe("trelloAttachmentNames", () => {
  it("numbers screenshots and calls a recording a screen recording", () => {
    expect(
      trelloAttachmentNames([
        { contentType: "image/png" },
        { contentType: "video/webm" },
        { contentType: "image/jpeg" },
      ]),
    ).toEqual(["Screenshot 1", "Screen recording", "Screenshot 2"]);
  });

  // As on every other tracker: the first recording is plain "Screen recording".
  it("numbers a second recording, never the first", () => {
    expect(
      trelloAttachmentNames([{ contentType: "video/webm" }, { contentType: "video/mp4" }]),
    ).toEqual(["Screen recording", "Screen recording 2"]);
  });
});

describe("buildTrelloDesc", () => {
  it("puts each caption next to the screenshot it explains, under one Evidence heading", () => {
    const desc = buildTrelloDesc("**Steps to reproduce**\n1. Open settings\n2. Click Save", [
      png("shot-1699999.png", "The Save button stays grey"),
      png("keyframe-03.png"),
      webm("recording-1699999.webm"),
    ]);

    expect(desc).toContain("### Steps to reproduce");
    expect(desc).toContain(
      "## Evidence\n\n- Screenshot 1: The Save button stays grey\n- Screenshot 2\n" +
        "- Screen recording: [Watch the screen recording](https://cloud.get-brief.app/api/evidence/s1/recordings/recording-1699999.webm)",
    );
    // The ticket never says how the report was captured.
    expect(desc).not.toContain("shot-1699999.png");
    expect(desc).not.toContain("keyframe");
    expect(desc.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("reuses the agent's own Evidence heading rather than adding a second one", () => {
    const desc = buildTrelloDesc("Save fails.\n\n## Evidence", [png("a.png", "Grey button")]);
    expect(desc.match(/^#+\s*evidence\s*$/gim)).toHaveLength(1);
    expect(desc).toContain("## Evidence\n\n- Screenshot 1: Grey button");
  });

  it("adds no Evidence section when there is nothing to show", () => {
    const desc = buildTrelloDesc("Save fails.", []);
    expect(desc).not.toMatch(/evidence/i);
    expect(desc).toBe(`Save fails.\n\n---\n\n${BRIEF_ATTRIBUTION}`);
  });

  it("shortens an overlong body to fit Trello's cap, keeping the evidence and the attribution", () => {
    const desc = buildTrelloDesc("word ".repeat(5000), [png("a.png", "Grey button")]);
    expect(desc.length).toBeLessThanOrEqual(TRELLO_DESC_LIMIT);
    expect(desc).toContain("(truncated)");
    expect(desc).toContain("- Screenshot 1: Grey button");
    expect(desc.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("fits the cap with no evidence at all", () => {
    const desc = buildTrelloDesc("x".repeat(TRELLO_DESC_LIMIT), []);
    expect(desc.length).toBeLessThanOrEqual(TRELLO_DESC_LIMIT);
    expect(desc.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("closes a code block the cut landed in, so the attribution is not swallowed into it", () => {
    const desc = buildTrelloDesc("Logs:\n\n```\n" + "line\n".repeat(5000), []);
    expect(desc.length).toBeLessThanOrEqual(TRELLO_DESC_LIMIT);
    expect((desc.match(/^\s*```/gm) ?? []).length % 2).toBe(0);
    expect(desc.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
  });

  it("closes a code block the agent left open, even when nothing is cut", () => {
    const desc = buildTrelloDesc("Console:\n\n```\nTypeError: x is undefined", [png("a.png", "Grey button")]);
    expect(desc).toContain("TypeError: x is undefined\n```\n\n## Evidence\n\n- Screenshot 1: Grey button");
    expect((desc.match(/^\s*```/gm) ?? []).length % 2).toBe(0);
  });

  it("keeps a caption on its own list line", () => {
    const desc = buildTrelloDesc("Save fails.", [
      png("a.png", "# Save\n\n## is   grey"),
      png("b.png", "  two\nlines  "),
    ]);
    expect(desc).toContain("- Screenshot 1: \\# Save ## is grey\n- Screenshot 2: two lines\n");
    // No caption text became a heading of its own.
    expect(desc).not.toMatch(/^#+ (Save|is grey)/m);
  });

  it("links a recording only where a reader can follow the link", () => {
    const local = buildTrelloDesc("Save fails.", [
      { ...webm("rec.webm"), url: "http://localhost:3000/api/evidence/s1/recordings/rec.webm" },
    ]);
    expect(local).toContain("- Screen recording\n");
    expect(local).not.toContain("localhost");

    const hosted = buildTrelloDesc("Save fails.", [webm("rec.webm")]);
    expect(hosted).toContain(
      "- Screen recording: [Watch the screen recording](https://cloud.get-brief.app/api/evidence/s1/recordings/rec.webm)",
    );
  });

  it("never drops the attribution, even when the evidence alone is over the cap", () => {
    const desc = buildTrelloDesc("Save fails.", [png("a.png", "grey ".repeat(5000))]);
    expect(desc.length).toBeLessThanOrEqual(TRELLO_DESC_LIMIT);
    expect(desc.endsWith(`\n\n---\n\n${BRIEF_ATTRIBUTION}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fileIssue
// ---------------------------------------------------------------------------

describe("fileIssue", () => {
  const input = {
    targetId: BOARD_ID,
    title: "Save button does nothing",
    descriptionMarkdown: "**What happened**\nClicking Save does nothing.",
    labels: ["bug", "Nonexistent"],
    priority: "high" as const,
    state: "triage",
    assignee: "Devin",
    comment: "Seen twice today",
    evidence: [png("shot-1699999.png", "The Save button stays grey"), png("shot-1700000.png"), webm("recording.webm")],
    details: [{ title: "Video 1 logs", markdown: "POST /api/save 500" }],
  };

  it("creates the card in the list the state names, with the board's labels and member", async () => {
    const calls = mockTrello(filingRoutes());
    const out = await makeTrelloTracker(tok).fileIssue(input);

    expect(out).toEqual({
      id: CARD_ID,
      identifier: "Xy12Ab34",
      url: "https://trello.com/c/Xy12Ab34",
      title: "Save button does nothing",
    });

    const create = calls.find((c) => c.method === "POST" && c.url.pathname === "/1/cards")!;
    // Key and token ride in the query, as Trello requires.
    expect(create.url.searchParams.get("key")).toBe("app-key");
    expect(create.url.searchParams.get("token")).toBe("user-token");
    // Everything else is a JSON body: a 16k description does not fit in a URL.
    expect(create.url.searchParams.get("desc")).toBeNull();
    const body = JSON.parse(String(create.init?.body));
    expect(body.idList).toBe(LIST_TRIAGE);
    expect(body.name).toBe("Save button does nothing");
    // "bug" resolved to Bug, priority high adopted the board's P1, and the
    // unknown label was skipped rather than created.
    expect(body.idLabels.split(",").sort()).toEqual([LABEL_BUG, LABEL_P1].sort());
    expect(body.idMembers).toBe(MEMBER_DEVIN);
    expect(body.desc).toContain("### What happened");
    expect(body.desc).toContain("- Screenshot 1: The Save button stays grey");
    expect(body.desc.endsWith(BRIEF_ATTRIBUTION)).toBe(true);
    // The logs are an attachment, and the description says nothing about them.
    expect(body.desc).not.toMatch(/technical|logs|500/i);
    expect(calls.some((c) => c.url.pathname.endsWith("/labels") && c.method === "POST")).toBe(false);

    // The comment rides in a JSON body too, never the query string.
    const comment = calls.find((c) => c.url.pathname.endsWith("/actions/comments"))!;
    expect(comment.url.searchParams.get("text")).toBeNull();
    expect(JSON.parse(String(comment.init?.body))).toEqual({ text: "Seen twice today" });
  });

  it("sends one priority label, replacing another the agent listed", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue({ ...input, labels: ["Bug", "P3"], priority: "high" });
    const body = JSON.parse(
      String(calls.find((c) => c.method === "POST" && c.url.pathname === "/1/cards")!.init?.body),
    );
    expect(body.idLabels.split(",")).toEqual([LABEL_BUG, LABEL_P1]);
  });

  it("warns about the list only when no list answered to the state", async () => {
    mockTrello(filingRoutes());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // "tri" resolves to Triage: a match, so nothing to warn about.
    await makeTrelloTracker(tok).fileIssue({ ...input, state: "tri" });
    expect(warn.mock.calls.some((args) => String(args[0]).includes("no list matched"))).toBe(false);

    await makeTrelloTracker(tok).fileIssue({ ...input, state: "Nowhere" });
    expect(warn.mock.calls.map((args) => String(args[0]))).toContain(
      '[trello-tracker] no list matched "Nowhere"; using the first list, "Triage"',
    );
    warn.mockRestore();
  });

  it("uploads the technical logs last, as markdown, after every screenshot", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue(input);

    const uploads = attachmentCalls(calls);
    expect(uploads.map((c) => c.url.searchParams.get("name"))).toEqual([
      "Screenshot 1",
      "Screenshot 2",
      "Screen recording",
      "Technical logs",
    ]);

    const logs = uploads[3];
    expect(logs.url.searchParams.get("mimeType")).toBe("text/markdown");
    expect(logs.url.searchParams.get("setCover")).toBe("false");
    const file = uploadedFile(logs);
    expect(file.name).toBe("technical-logs.md");
    expect(file.type).toBe("text/markdown");
    expect(await file.text()).toBe("## Video 1 logs\n\nPOST /api/save 500\n");
  });

  it("makes only the first screenshot the cover", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue(input);

    expect(attachmentCalls(calls).map((c) => c.url.searchParams.get("setCover"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
  });

  it("covers with the first screenshot even when a recording comes before it", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue({
      ...input,
      evidence: [webm("recording.webm"), png("a.png"), png("b.png")],
    });

    const uploads = attachmentCalls(calls);
    expect(uploads.map((c) => [c.url.searchParams.get("name"), c.url.searchParams.get("setCover")])).toEqual([
      ["Screen recording", "false"],
      ["Screenshot 1", "true"],
      ["Screenshot 2", "false"],
      ["Technical logs", "false"],
    ]);
  });

  it("names attachments neutrally, never by the file they were captured as", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue(input);

    const files = attachmentCalls(calls).map(uploadedFile);
    expect(files.map((f) => f.name)).toEqual([
      "screenshot-1.png",
      "screenshot-2.png",
      "screen-recording.webm",
      "technical-logs.md",
    ]);
    expect(files[0].type).toBe("image/png");
  });

  it("uploads no logs file when there are no technical logs", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue({ ...input, details: [] });
    expect(attachmentCalls(calls).map((c) => c.url.searchParams.get("name"))).toEqual([
      "Screenshot 1",
      "Screenshot 2",
      "Screen recording",
    ]);

    const calls2 = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue({
      ...input,
      details: [{ title: "Video 1 logs", markdown: "   " }],
    });
    expect(attachmentCalls(calls2).some((c) => c.url.searchParams.get("name") === "Technical logs")).toBe(false);
  });

  it("still files, and moves the cover to the next screenshot, when an upload fails", async () => {
    const calls = mockTrello(filingRoutes({ failAttachment: (n) => n === "Screenshot 1" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await makeTrelloTracker(tok).fileIssue(input);
    warn.mockRestore();

    expect(out.identifier).toBe("Xy12Ab34");
    expect(
      attachmentCalls(calls).map((c) => [c.url.searchParams.get("name"), c.url.searchParams.get("setCover")]),
    ).toEqual([
      ["Screenshot 1", "true"],
      ["Screenshot 2", "true"],
      ["Screen recording", "false"],
      ["Technical logs", "false"],
    ]);
  });

  it("falls back to the first list when the state names none, and lets resolved fields beat extraFields", async () => {
    const calls = mockTrello(filingRoutes());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await makeTrelloTracker(tok).fileIssue({
      ...input,
      state: "Nowhere",
      extraFields: { idList: "not-a-list", name: "hijacked", due: "2026-10-20T12:00:00.000Z" },
    });
    warn.mockRestore();

    const body = JSON.parse(
      String(calls.find((c) => c.method === "POST" && c.url.pathname === "/1/cards")!.init?.body),
    );
    expect(body.idList).toBe(LIST_TRIAGE);
    expect(body.name).toBe("Save button does nothing");
    expect(body.due).toBe("2026-10-20T12:00:00.000Z");
  });

  it("accepts a board's name where its id was expected, and names the known boards otherwise", async () => {
    const calls = mockTrello(filingRoutes());
    await makeTrelloTracker(tok).fileIssue({ ...input, targetId: "product bugs" });
    expect(calls.some((c) => c.url.pathname === "/1/cards")).toBe(true);

    mockTrello(filingRoutes());
    await expect(makeTrelloTracker(tok).fileIssue({ ...input, targetId: "nope" })).rejects.toThrow(
      /Known boards: Product bugs \(id: 5f1a2b3c4d5e6f7a8b9c0d1e\)/,
    );
  });

  it("tells the user to reconnect when Trello no longer accepts the token", async () => {
    mockTrello(() => new Response("invalid token", { status: 401 }));
    await expect(makeTrelloTracker(tok).fileIssue(input)).rejects.toThrow(/reconnect Trello/);
  });

  it("tells the user to reconnect when the token is missing a scope", async () => {
    // Reconnecting grants the scope again; a card-level refusal is different.
    mockTrello(() => new Response("unauthorized permission requested", { status: 401 }));
    await expect(makeTrelloTracker(tok).fileIssue(input)).rejects.toThrow(/reconnect Trello/);
  });
});

// ---------------------------------------------------------------------------
// listTargets / getTargetDetails
// ---------------------------------------------------------------------------

describe("targets", () => {
  it("lists boards with their lists as states in one request", async () => {
    const calls = mockTrello(boardRoutes);
    const targets = await makeTrelloTracker(tok).listTargets();

    expect(targets).toEqual([
      {
        id: BOARD_ID,
        key: "Product bugs",
        name: "Product bugs",
        description: "Bugs reported against the web app",
        states: ["Triage", "Doing", "Done"],
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("lists")).toBe("open");
    expect(calls[0].url.searchParams.get("filter")).toBe("open");
  });

  it("details a board with its named labels and members", async () => {
    mockTrello(boardRoutes);
    const d = await makeTrelloTracker(tok).getTargetDetails(BOARD_ID);
    expect(d.states).toEqual(["Triage", "Doing", "Done"]);
    // The unnamed colour label is left out.
    expect(d.labels).toEqual(["Bug", "P1", "P3", "UI"]);
    expect(d.members).toEqual(["Devin Reyes"]);
  });

  it("does not cache a board whose labels failed to load", async () => {
    let labelCalls = 0;
    mockTrello((c) => {
      if (c.url.pathname === `/1/boards/${BOARD_ID}/labels`) {
        labelCalls += 1;
        return labelCalls === 1 ? new Response("rate limited", { status: 429 }) : json(LABELS);
      }
      return boardRoutes(c);
    });
    const tracker = makeTrelloTracker(tok);
    expect((await tracker.getTargetDetails(BOARD_ID)).labels).toEqual([]);
    expect((await tracker.getTargetDetails(BOARD_ID)).labels).toEqual(["Bug", "P1", "P3", "UI"]);
  });
});

// ---------------------------------------------------------------------------
// updateIssue / getIssue
// ---------------------------------------------------------------------------

describe("updateIssue", () => {
  function updateRoutes(card: Record<string, unknown>) {
    return (c: Call): Response | undefined => {
      if (c.url.pathname === "/1/cards/Xy12Ab34" && c.method === "GET") return json(card);
      if (c.url.pathname === "/1/cards/Xy12Ab34" && c.method === "PUT") return json({ ...card });
      return boardRoutes(c);
    };
  }
  const card = { id: CARD_ID, name: "Save fails", idList: LIST_TRIAGE, idBoard: BOARD_ID, idLabels: [LABEL_BUG, LABEL_P3] };
  const put = (calls: Call[]) => calls.find((c) => c.method === "PUT")!;

  it("moves the card to the list the state names", async () => {
    const calls = mockTrello(updateRoutes(card));
    expect(await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { state: "doing" })).toEqual({ ok: true });
    expect(put(calls).url.searchParams.get("idList")).toBe(LIST_DOING);
  });

  it("reports the valid lists when the state names none", async () => {
    mockTrello(updateRoutes(card));
    const r = await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { state: "Shipped" });
    expect(r).toEqual({
      ok: false,
      error: expect.stringContaining("valid lists: Triage, Doing, Done"),
    });
  });

  it("swaps the priority label and keeps the card's other labels", async () => {
    const calls = mockTrello(updateRoutes(card));
    expect(await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { priority: "high" })).toEqual({ ok: true });
    expect(put(calls).url.searchParams.get("idLabels")!.split(",")).toEqual([LABEL_BUG, LABEL_P1]);
  });

  it("sets labels and priority together, with the priority winning over a listed priority label", async () => {
    const calls = mockTrello(updateRoutes(card));
    expect(
      await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { labels: ["UI", "P3"], priority: "high" }),
    ).toEqual({ ok: true });
    // The listed labels replace the card's (Bug is gone), P3 gives way to P1.
    expect(put(calls).url.searchParams.get("idLabels")!.split(",")).toEqual([LABEL_UI, LABEL_P1]);
  });

  it("reports labels the board does not have, with the valid ones", async () => {
    const calls = mockTrello(updateRoutes(card));
    const r = await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { labels: ["Bug", "Regression"] });
    expect(r).toEqual({ ok: false, error: "labels not found: Regression. Valid labels: Bug, P1, P3, UI" });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("reports a member who is not on the board", async () => {
    mockTrello(updateRoutes(card));
    const r = await makeTrelloTracker(tok).updateIssue("Xy12Ab34", { assignee: "Sam" });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Valid members: Devin Reyes") });
  });
});

describe("getIssue", () => {
  it("reads the list back as the state", async () => {
    mockTrello((c) => {
      if (c.url.pathname === "/1/cards/Xy12Ab34") {
        return json({
          id: CARD_ID,
          name: "Save fails",
          url: "https://trello.com/c/Xy12Ab34/12-save-fails",
          shortUrl: "https://trello.com/c/Xy12Ab34",
          shortLink: "Xy12Ab34",
          idList: LIST_DOING,
          idBoard: BOARD_ID,
          closed: false,
          labels: [
            { id: LABEL_BUG, name: "Bug", color: "red" },
            { id: LABEL_P1, name: "P1", color: "orange" },
          ],
          members: [{ id: MEMBER_DEVIN, fullName: "Devin Reyes", username: "devinreyes" }],
        });
      }
      return boardRoutes(c);
    });
    const i = await makeTrelloTracker(tok).getIssue("Xy12Ab34");
    expect(i).toMatchObject({
      identifier: "Xy12Ab34",
      state: "Doing",
      stateColor: STATUS_COLOR.active,
      assignee: "Devin Reyes",
      labels: ["Bug", "P1"],
      priority: "high",
      archived: false,
    });
  });

  it("does not mistake a card the token cannot see for an expired connection", async () => {
    mockTrello(() => new Response("unauthorized card permission requested", { status: 401 }));
    await expect(makeTrelloTracker(tok).getIssue("Xy12Ab34")).rejects.toThrow(
      /401 unauthorized card permission requested/,
    );
  });
});

// ---------------------------------------------------------------------------
// searchIssues
// ---------------------------------------------------------------------------

describe("searchIssues", () => {
  it("names each card's board and list from the same answer", async () => {
    const calls = mockTrello((c) =>
      c.url.pathname === "/1/search"
        ? json({
            options: { terms: [{ text: "save" }], modelTypes: ["cards"], partial: true },
            cards: [
              {
                id: CARD_ID,
                name: "Save fails on Safari",
                url: "https://trello.com/c/Xy12Ab34/12-save-fails-on-safari",
                shortUrl: "https://trello.com/c/Xy12Ab34",
                shortLink: "Xy12Ab34",
                labels: [{ id: LABEL_P1, name: "P1", color: "orange" }],
                board: { id: BOARD_ID, name: "Product bugs" },
                list: { id: LIST_TRIAGE, name: "Triage" },
                members: [{ id: MEMBER_DEVIN, fullName: "Devin Reyes", username: "devinreyes" }],
              },
            ],
          })
        : undefined,
    );
    const r = await makeTrelloTracker(tok).searchIssues("save", { limit: 5 });
    expect(r).toEqual([
      {
        identifier: "Xy12Ab34",
        title: "Save fails on Safari",
        url: "https://trello.com/c/Xy12Ab34",
        target: "Product bugs",
        state: "Triage",
        labels: ["P1"],
        assignee: "Devin Reyes",
        priority: "high",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get("cards_limit")).toBe("5");
    expect(calls[0].url.searchParams.get("modelTypes")).toBe("cards");
  });

  it("returns nothing rather than throwing when Trello fails", async () => {
    mockTrello(() => new Response("server error", { status: 500 }));
    expect(await makeTrelloTracker(tok).searchIssues("save")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLiveIssues
// ---------------------------------------------------------------------------

describe("parseBatchEntry", () => {
  it("reads a card keyed by its 200", () => {
    expect(parseBatchEntry({ "200": { id: CARD_ID, name: "A", url: "u" } })).toEqual({
      card: { id: CARD_ID, name: "A", url: "u" },
    });
  });

  it("reads a failure keyed by its status", () => {
    expect(parseBatchEntry({ "404": "The requested resource was not found." })).toEqual({ status: 404 });
  });

  it("reads a failure that carries its status as statusCode", () => {
    expect(
      parseBatchEntry({ name: "NotFoundError", message: "The requested resource was not found.", statusCode: 404 }),
    ).toEqual({ status: 404 });
  });

  it("reads nothing out of an entry it does not recognise", () => {
    expect(parseBatchEntry(null)).toEqual({});
    expect(parseBatchEntry("oops")).toEqual({});
    expect(parseBatchEntry({ message: "?" })).toEqual({});
  });
});

describe("getLiveIssues", () => {
  // The list comes nested in the card (list=true), so a live read never needs
  // the board.
  const liveCard = (shortLink: string, list = { id: LIST_DOING, name: "Doing", closed: false }) => ({
    id: "5f000000aaaaaaaaaaaaaaaa",
    name: `Card ${shortLink}`,
    url: `https://trello.com/c/${shortLink}/1-card`,
    shortUrl: `https://trello.com/c/${shortLink}`,
    shortLink,
    closed: false,
    list,
    members: [
      {
        id: MEMBER_DEVIN,
        fullName: "Devin Reyes",
        username: "devinreyes",
        avatarUrl: `https://trello-members.s3.amazonaws.com/${MEMBER_DEVIN}/abc123`,
      },
    ],
  });

  /** The ids one /batch call asked for, in order. */
  const batchIds = (c: Call) =>
    c.url.searchParams
      .get("urls")!
      .split(",")
      .map((u) => /^\/cards\/([^?]+)/.exec(u)![1]);

  /** A /batch that answers every sub-request with a live card. */
  const batchOfCards = (c: Call): Response | undefined =>
    c.url.pathname === "/1/batch" ? json(batchIds(c).map((id) => ({ "200": liveCard(id) }))) : undefined;

  const boardRequests = (calls: Call[]) => calls.filter((c) => c.url.pathname.startsWith("/1/boards/"));

  it("reads a batch, and only a 404 counts as gone", async () => {
    const calls = mockTrello((c) =>
      c.url.pathname === "/1/batch"
        ? json([
            { "200": liveCard("Found111") },
            { "404": "The requested resource was not found." },
            { "401": "unauthorized card permission requested" },
            { name: "NotFoundError", message: "The requested resource was not found.", statusCode: 404 },
          ])
        : undefined,
    );

    const out = await makeTrelloTracker(tok).getLiveIssues(["Found111", "Gone2222", "NoAccess", "Gone3333"]);

    expect(out.gone).toEqual(["Gone2222", "Gone3333"]);
    expect(Object.keys(out.issues)).toEqual(["Found111"]);
    expect(out.issues.Found111).toEqual({
      identifier: "Found111",
      title: "Card Found111",
      url: "https://trello.com/c/Found111",
      stateName: "Doing",
      stateColor: STATUS_COLOR.active,
      createdAt: "2020-07-04T04:05:20.000Z",
      assignee: {
        name: "Devin Reyes",
        avatarUrl: `https://trello-members.s3.amazonaws.com/${MEMBER_DEVIN}/abc123/50.png`,
      },
    });

    // One sub-request per card, separated by commas; the commas inside each
    // sub-request's field lists are escaped so they do not split it.
    const urls = calls.find((c) => c.url.pathname === "/1/batch")!.url.searchParams.get("urls")!;
    const subs = urls.split(",");
    expect(subs).toHaveLength(4);
    expect(subs[0]).toMatch(/^\/cards\/Found111\?fields=name%2Curl/);
    expect(subs[0]).toContain("&list=true&list_fields=name%2Cclosed");
  });

  it("reads many cards on one board without a single board request", async () => {
    const ids = Array.from({ length: 30 }, (_, n) => `Card${String(n).padStart(4, "0")}`);
    const calls = mockTrello(batchOfCards);

    const out = await makeTrelloTracker(tok).getLiveIssues(ids);

    expect(Object.keys(out.issues)).toHaveLength(30);
    expect(out.issues.Card0007.stateName).toBe("Doing");
    expect(boardRequests(calls)).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it("splits more than ten cards into batches of ten", async () => {
    const ids = Array.from({ length: 23 }, (_, n) => `Card${String(n).padStart(4, "0")}`);
    const calls = mockTrello(batchOfCards);

    const out = await makeTrelloTracker(tok).getLiveIssues(ids);

    expect(calls.map((c) => batchIds(c).length)).toEqual([10, 10, 3]);
    expect(calls.flatMap(batchIds)).toEqual(ids);
    expect(Object.keys(out.issues)).toHaveLength(23);
  });

  it("reads card by card when Trello refuses the batch, and stops asking for one", async () => {
    const calls = mockTrello((c) => {
      if (c.url.pathname === "/1/batch") return new Response("Invalid value for urls", { status: 400 });
      if (c.url.pathname === "/1/cards/Found111") {
        return json(liveCard("Found111", { id: LIST_DONE, name: "Done", closed: false }));
      }
      if (c.url.pathname === "/1/cards/Gone2222") {
        return new Response("The requested resource was not found.", { status: 404 });
      }
      return undefined;
    });

    const tracker = makeTrelloTracker(tok);
    const out = await tracker.getLiveIssues(["Found111", "Gone2222"]);
    expect(out.gone).toEqual(["Gone2222"]);
    expect(out.issues.Found111.stateName).toBe("Done");
    expect(out.issues.Found111.stateColor).toBe(STATUS_COLOR.done);
    // The single read asks for the same nested list.
    const single = calls.find((c) => c.url.pathname === "/1/cards/Found111")!;
    expect(single.url.searchParams.get("list")).toBe("true");
    expect(single.url.searchParams.get("list_fields")).toBe("name,closed");

    // The refusal sticks for this tracker: the next read skips the batch.
    await tracker.getLiveIssues(["Found111"]);
    expect(calls.filter((c) => c.url.pathname === "/1/batch")).toHaveLength(1);
    expect(boardRequests(calls)).toEqual([]);
  });

  it("falls back to single reads when the batch answer does not line up, but keeps batching", async () => {
    let batches = 0;
    const calls = mockTrello((c) => {
      if (c.url.pathname === "/1/batch") {
        batches += 1;
        // The first answer has one entry for two cards: nothing in it can be
        // matched to a card, so none of it is trusted.
        return batches === 1
          ? json([{ "404": "The requested resource was not found." }])
          : json(batchIds(c).map((id) => ({ "200": liveCard(id) })));
      }
      if (c.url.pathname.startsWith("/1/cards/")) {
        return json(liveCard(c.url.pathname.split("/").pop()!));
      }
      return undefined;
    });

    const tracker = makeTrelloTracker(tok);
    const out = await tracker.getLiveIssues(["Aaaa1111", "Bbbb2222"]);
    expect(out.gone).toEqual([]);
    expect(Object.keys(out.issues).sort()).toEqual(["Aaaa1111", "Bbbb2222"]);
    expect(calls.filter((c) => c.url.pathname.startsWith("/1/cards/"))).toHaveLength(2);

    // Not a refusal of /batch itself, so the next read batches again.
    await tracker.getLiveIssues(["Aaaa1111"]);
    expect(batches).toBe(2);
  });

  it("stops the sync on a rate limit, leaving every card unknown, and batches again next time", async () => {
    let limited = true;
    const calls = mockTrello((c) => {
      if (c.url.pathname === "/1/batch") {
        return limited ? new Response("API_TOKEN_LIMIT_EXCEEDED", { status: 429 }) : batchOfCards(c);
      }
      return undefined;
    });

    const ids = Array.from({ length: 25 }, (_, n) => `Card${String(n).padStart(4, "0")}`);
    const tracker = makeTrelloTracker(tok);
    const out = await tracker.getLiveIssues(ids);

    expect(out).toEqual({ issues: {}, gone: [] });
    // One refused batch, then nothing: no single reads, no further batches.
    expect(calls).toHaveLength(1);

    limited = false;
    const next = await tracker.getLiveIssues(["Card0000"]);
    expect(next.issues.Card0000).toBeDefined();
    expect(calls.filter((c) => c.url.pathname === "/1/batch")).toHaveLength(2);
  });

  it("stops after a chunk whose single reads were rate limited", async () => {
    const calls = mockTrello((c) => {
      if (c.url.pathname === "/1/batch") return new Response("Invalid value for urls", { status: 400 });
      return new Response("API_TOKEN_LIMIT_EXCEEDED", { status: 429 });
    });
    const ids = Array.from({ length: 15 }, (_, n) => `Card${String(n).padStart(4, "0")}`);
    const out = await makeTrelloTracker(tok).getLiveIssues(ids);

    expect(out).toEqual({ issues: {}, gone: [] });
    // The first chunk's ten single reads, and nothing for the second chunk.
    expect(calls.filter((c) => c.url.pathname.startsWith("/1/cards/"))).toHaveLength(10);
  });

  it("reports nothing gone when Trello cannot be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const out = await makeTrelloTracker(tok).getLiveIssues(["Found111", "Gone2222"]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });

  it("shows an archived card, or a card in an archived list, as archived", async () => {
    mockTrello((c) =>
      c.url.pathname === "/1/batch"
        ? json([
            { "200": { ...liveCard("Arch1111"), closed: true } },
            { "200": liveCard("Arch2222", { id: LIST_DONE, name: "Old sprint", closed: true }) },
          ])
        : undefined,
    );
    const out = await makeTrelloTracker(tok).getLiveIssues(["Arch1111", "Arch2222"]);
    expect(out.issues.Arch1111.stateName).toBe("Archived");
    expect(out.issues.Arch2222.stateName).toBe("Archived");
    expect(out.gone).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

describe("listTrelloWorkspaces", () => {
  it("maps each workspace, with its logo sized into a real image", async () => {
    const calls = mockTrello((c) =>
      c.url.pathname === "/1/members/me/organizations"
        ? json([
            {
              id: "5a0000000000000000000001",
              displayName: "Acme Engineering",
              // Like a member's avatarUrl, Trello's logoUrl is a base without a size.
              logoUrl: "https://trello-logos.s3.amazonaws.com/5a0000000000000000000001/9f8e7d6c5b4a",
            },
            { id: "5a0000000000000000000002", displayName: "Side projects", logoUrl: null },
            {
              id: "5a0000000000000000000003",
              displayName: "Design",
              logoUrl: "https://trello-logos.s3.amazonaws.com/5a0000000000000000000003/abc/30.png",
            },
          ])
        : undefined,
    );

    expect(await listTrelloWorkspaces(tok)).toEqual([
      {
        id: "5a0000000000000000000001",
        name: "Acme Engineering",
        avatarUrl: "https://trello-logos.s3.amazonaws.com/5a0000000000000000000001/9f8e7d6c5b4a/170.png",
      },
      { id: "5a0000000000000000000002", name: "Side projects", avatarUrl: undefined },
      // One that already names an image file is used as it is.
      {
        id: "5a0000000000000000000003",
        name: "Design",
        avatarUrl: "https://trello-logos.s3.amazonaws.com/5a0000000000000000000003/abc/30.png",
      },
    ]);
    expect(calls[0].url.searchParams.get("fields")).toBe("id,displayName,logoUrl");
    expect(calls[0].url.searchParams.get("token")).toBe("user-token");
  });

  it("returns an empty list when Trello fails", async () => {
    mockTrello(() => new Response("server error", { status: 500 }));
    expect(await listTrelloWorkspaces(tok)).toEqual([]);
    mockTrello(() => new Response("invalid token", { status: 401 }));
    expect(await listTrelloWorkspaces(tok)).toEqual([]);
  });
});
