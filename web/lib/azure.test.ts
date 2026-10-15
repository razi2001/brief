import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AZ_FIELD,
  attachmentOp,
  azureStateColor,
  bodyField,
  buildAzureBody,
  fieldOps,
  listAzureOrgs,
  makeAzureTracker,
  neutralFileName,
  parseTags,
  parseWorkItemRef,
  priorityName,
  tagsValue,
  workItemUrl,
  type PatchOp,
} from "@/lib/azure";
import { splitAtEvidenceEnd } from "@/lib/ticket-body";
import { BRIEF_URL, STATUS_COLOR, type IssueInput } from "@/lib/tracker";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A fetch stub that records every call and answers from a route table, with
// envelopes shaped like the Azure DevOps REST 7.1 documentation's samples.
// ---------------------------------------------------------------------------

type Call = { url: string; method: string; headers: Headers; body: unknown };
type Reply = { status?: number; json?: unknown; text?: string };

function mockFetch(route: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      let body: unknown = init.body;
      if (typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const call: Call = {
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        headers: new Headers(init.headers),
        body,
      };
      calls.push(call);
      const reply = route(call);
      if (!reply) return new Response(`no route for ${call.method} ${call.url}`, { status: 404 });
      const payload = reply.text ?? JSON.stringify(reply.json ?? {});
      return new Response(payload, {
        status: reply.status ?? 200,
        headers: { "Content-Type": reply.text ? "text/html" : "application/json" },
      });
    }),
  );
  return calls;
}

const ORG = "fabrikam";
const PROJECT = "Fabrikam-Fiber";
const BASE = `https://dev.azure.com/${ORG}`;
const BEARER = "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.e30.sig";
const BASIC = `Basic ${Buffer.from(":not-a-real-pat").toString("base64")}`;

const PROJECTS = {
  count: 1,
  value: [
    {
      id: "eb6e4656-77fc-42a1-9181-4c6d8e9da5d1",
      name: PROJECT,
      description: "Team project for the Fiber suite",
      url: `${BASE}/_apis/projects/eb6e4656-77fc-42a1-9181-4c6d8e9da5d1`,
      state: "wellFormed",
      revision: 411,
      visibility: "private",
    },
  ],
};

const AGILE_TYPES = {
  count: 3,
  value: [
    { name: "Bug", referenceName: "Microsoft.VSTS.WorkItemTypes.Bug", isDisabled: false },
    { name: "Task", referenceName: "Microsoft.VSTS.WorkItemTypes.Task", isDisabled: false },
    { name: "User Story", referenceName: "Microsoft.VSTS.WorkItemTypes.UserStory", isDisabled: false },
  ],
};

// The Basic process has no Bug at all: Epic, Issue, Task.
const BASIC_TYPES = {
  count: 3,
  value: [
    { name: "Epic", referenceName: "Microsoft.VSTS.WorkItemTypes.Epic", isDisabled: false },
    { name: "Issue", referenceName: "Microsoft.VSTS.WorkItemTypes.Issue", isDisabled: false },
    { name: "Task", referenceName: "Microsoft.VSTS.WorkItemTypes.Task", isDisabled: false },
  ],
};

const BUG_STATES = {
  count: 4,
  value: [
    { name: "New", color: "b2b2b2", category: "Proposed" },
    { name: "Active", color: "007acc", category: "InProgress" },
    { name: "Resolved", color: "ff9d00", category: "Resolved" },
    { name: "Closed", color: "339933", category: "Completed" },
  ],
};

function attachmentReply(call: Call): Reply {
  const fileName = new URL(call.url).searchParams.get("fileName") ?? "";
  return {
    status: 201,
    json: {
      id: "a5cedde4-2dd5-4fcf-befe-fd0977dd3433",
      url: `${BASE}/_apis/wit/attachments/a5cedde4-2dd5-4fcf-befe-fd0977dd3433?fileName=${encodeURIComponent(fileName)}`,
    },
  };
}

function createdReply(type: string, title: string, state = "New"): Reply {
  return {
    json: {
      id: 299,
      rev: 1,
      fields: {
        "System.AreaPath": PROJECT,
        "System.TeamProject": PROJECT,
        "System.IterationPath": PROJECT,
        "System.WorkItemType": type,
        "System.State": state,
        "System.Reason": "New",
        "System.CreatedDate": "2026-10-13T09:12:44.51Z",
        "System.Title": title,
      },
      url: `${BASE}/_apis/wit/workItems/299`,
    },
  };
}

/** Routes the calls a plain fileIssue makes against an Agile or Basic project. */
function filingRoutes(types: typeof AGILE_TYPES, extra?: (call: Call) => Reply | undefined) {
  return (call: Call): Reply | undefined => {
    const hit = extra?.(call);
    if (hit) return hit;
    const u = new URL(call.url);
    if (u.pathname === `/${ORG}/_apis/projects`) return { json: PROJECTS };
    if (u.pathname === `/${ORG}/${PROJECT}/_apis/wit/workitemtypes`) return { json: types };
    if (u.pathname.endsWith("/states")) return { json: BUG_STATES };
    if (u.pathname === `/${ORG}/${PROJECT}/_apis/wit/attachments`) return attachmentReply(call);
    const create = /\/_apis\/wit\/workitems\/\$(.+)$/.exec(decodeURIComponent(u.pathname));
    if (create && call.method === "POST") {
      const ops = call.body as PatchOp[];
      const title = String(ops.find((o) => o.path === "/fields/System.Title")?.value ?? "");
      return createdReply(create[1], title);
    }
    return undefined;
  };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function input(over: Partial<IssueInput> = {}): IssueInput {
  return {
    targetId: PROJECT,
    title: "Save fails on the billing page",
    descriptionMarkdown: "**Steps to reproduce**\n\n1. Open billing\n2. Click Save",
    evidence: [],
    ...over,
  };
}

function opsOf(call: Call): PatchOp[] {
  return call.body as PatchOp[];
}

function fieldValue(ops: PatchOp[], field: string): unknown {
  return ops.find((o) => o.path === `/fields/${field}`)?.value;
}

function createCall(calls: Call[]): Call {
  const c = calls.find((x) => x.method === "POST" && /\/_apis\/wit\/workitems\/\$/.test(decodeURIComponent(x.url)));
  if (!c) throw new Error("no create call");
  return c;
}

// ---------------------------------------------------------------------------
// Pure helpers (ported unchanged)
// ---------------------------------------------------------------------------

describe("bodyField", () => {
  // The Bug work item in every stock Azure DevOps process shows Repro Steps on
  // its form and does NOT show System.Description. Writing a bug's body into
  // Description produces a work item that looks empty to whoever has to fix it.
  it("puts a bug's body in Repro Steps, not Description", () => {
    expect(bodyField("Bug")).toBe(AZ_FIELD.reproSteps);
    expect(bodyField("bug")).toBe(AZ_FIELD.reproSteps);
    // Process templates rename it; anything bug-shaped still gets Repro Steps.
    expect(bodyField("Bug (Agile)")).toBe(AZ_FIELD.reproSteps);
  });

  it("uses Description for every other work item type", () => {
    expect(bodyField("Task")).toBe(AZ_FIELD.description);
    expect(bodyField("User Story")).toBe(AZ_FIELD.description);
    expect(bodyField("Issue")).toBe(AZ_FIELD.description);
    expect(bodyField("Epic")).toBe(AZ_FIELD.description);
  });
});

describe("fieldOps", () => {
  it("emits one add op per field, under /fields", () => {
    expect(fieldOps({ [AZ_FIELD.title]: "Save fails", [AZ_FIELD.priority]: 2 })).toEqual([
      { op: "add", path: "/fields/System.Title", value: "Save fails" },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 2 },
    ]);
  });

  it("drops empty values rather than sending them", () => {
    // An empty string clears a field in Azure DevOps, so sending one for a
    // field the agent simply didn't set would erase a default.
    expect(fieldOps({ a: "", b: null, c: undefined, d: 0, e: false })).toEqual([
      { op: "add", path: "/fields/d", value: 0 },
      { op: "add", path: "/fields/e", value: false },
    ]);
  });
});

describe("tags", () => {
  it("joins tags the way Azure DevOps stores them: one semicolon-separated string", () => {
    expect(tagsValue(["billing", "regression"])).toBe("billing; regression");
  });

  it("drops blanks so a stray comma can't create an empty tag", () => {
    expect(tagsValue(["billing", "  ", ""])).toBe("billing");
  });

  it("round-trips back to a list", () => {
    expect(parseTags("billing; regression")).toEqual(["billing", "regression"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe("attachmentOp", () => {
  it("builds the relation that puts a file in the Attachments panel", () => {
    expect(attachmentOp("https://dev.azure.com/x/_apis/wit/attachments/abc", "The empty cart")).toEqual({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "AttachedFile",
        url: "https://dev.azure.com/x/_apis/wit/attachments/abc",
        attributes: { comment: "The empty cart" },
      },
    });
  });

  it("omits the comment when there is none", () => {
    expect(attachmentOp("https://x/y").value).toMatchObject({ attributes: {} });
  });
});

describe("parseWorkItemRef", () => {
  it("reads the Project#id form Brief files under", () => {
    expect(parseWorkItemRef("Contoso#1234")).toEqual({ project: "Contoso", id: 1234 });
  });

  it("accepts a bare id, with or without the Azure Boards hash", () => {
    expect(parseWorkItemRef("1234")).toEqual({ id: 1234 });
    expect(parseWorkItemRef("#1234")).toEqual({ id: 1234 });
  });

  it("keeps a project name that contains spaces", () => {
    expect(parseWorkItemRef("My Team Project#7")).toEqual({ project: "My Team Project", id: 7 });
  });

  it("rejects anything that isn't a work item ref", () => {
    expect(parseWorkItemRef("APP-1234")).toBeNull();
    expect(parseWorkItemRef("")).toBeNull();
  });
});

describe("priorityName", () => {
  it("maps Azure DevOps' 1-4 back to our normalized names", () => {
    expect(priorityName(1)).toBe("urgent");
    expect(priorityName(2)).toBe("high");
    expect(priorityName("3")).toBe("medium");
    expect(priorityName(4)).toBe("low");
  });

  it("returns null for an unset or out-of-range priority", () => {
    expect(priorityName(undefined)).toBeNull();
    expect(priorityName(9)).toBeNull();
  });
});

describe("azureStateColor", () => {
  it("colors by state category when one is given", () => {
    expect(azureStateColor("Completed")).toBe(STATUS_COLOR.done);
    expect(azureStateColor("InProgress")).toBe(STATUS_COLOR.active);
    expect(azureStateColor("Proposed")).toBe(STATUS_COLOR.neutral);
  });

  it("falls back to the stock state names when there's no category", () => {
    expect(azureStateColor(undefined, "Closed")).toBe(STATUS_COLOR.done);
    expect(azureStateColor(undefined, "Active")).toBe(STATUS_COLOR.active);
    expect(azureStateColor(undefined, "New")).toBe(STATUS_COLOR.neutral);
  });
});

describe("workItemUrl", () => {
  it("builds the browse url, escaping a project name with spaces", () => {
    expect(workItemUrl("contoso", "My Project", 42)).toBe(
      "https://dev.azure.com/contoso/My%20Project/_workitems/edit/42",
    );
  });
});

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

describe("neutralFileName", () => {
  // The upload name is baked into the attachment url and shown in the
  // Attachments panel, so Brief's own names must never reach Azure DevOps.
  it("names screenshots and recordings plainly, keeping the extension", () => {
    expect(neutralFileName("image/jpeg", 2)).toBe("Screenshot 2.jpg");
    expect(neutralFileName("video/webm;codecs=vp9", 1)).toBe("Screen recording.webm");
    expect(neutralFileName("video/mp4", 2)).toBe("Screen recording 2.mp4");
  });
});

describe("splitAtEvidenceEnd", () => {
  it("ends the agent's Evidence section at the next heading of the same level", () => {
    const md = "Intro\n\n## Evidence\n\nThe dialog.\n\n## Notes\n\nMore.";
    expect(splitAtEvidenceEnd(md)).toEqual({
      head: "Intro\n\n## Evidence\n\nThe dialog.\n",
      tail: "## Notes\n\nMore.",
    });
  });

  it("keeps a deeper heading inside the Evidence section", () => {
    const md = "## Evidence\n\n### Detail\n\nx";
    expect(splitAtEvidenceEnd(md)).toEqual({ head: md, tail: "" });
  });

  it("ignores an Evidence heading inside a code block", () => {
    expect(splitAtEvidenceEnd("```\n## Evidence\n```")).toBeNull();
    expect(splitAtEvidenceEnd("No evidence heading here")).toBeNull();
  });

  it("accepts a trailing colon on the heading", () => {
    expect(splitAtEvidenceEnd("## Evidence:\n\nx")).toEqual({ head: "## Evidence:\n\nx", tail: "" });
  });

  // mdToHtml renders a heading only for 1-4 "#" at the very start of the line.
  // Matching anything else would suppress our heading over a line that shows
  // up as a plain paragraph, leaving the screenshots under no heading at all.
  it("only counts what mdToHtml renders as a heading", () => {
    expect(splitAtEvidenceEnd("##### Evidence\n\nx")).toBeNull();
    expect(splitAtEvidenceEnd("   ## Evidence\n\nx")).toBeNull();
    expect(splitAtEvidenceEnd("##Evidence\n\nx")).toBeNull();
    // A "#####" line inside the section is a paragraph, so it doesn't end it.
    expect(splitAtEvidenceEnd("## Evidence\n\n##### Notes\n\nx")?.tail).toBe("");
  });
});

describe("buildAzureBody", () => {
  const img = (n: number, caption?: string) => ({
    url: `${BASE}/_apis/wit/attachments/g${n}?fileName=Screenshot%20${n}.png`,
    isImage: true,
    caption,
  });
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it("adds one Evidence heading with each caption directly above its image", () => {
    const html = buildAzureBody("The save fails.", [img(1, "The error toast"), img(2)]);
    expect(count(html, /<h3>Evidence<\/h3>/g)).toBe(1);
    expect(html).toContain(
      `<p>The error toast</p>\n<p><img src="${BASE}/_apis/wit/attachments/g1?fileName=Screenshot%201.png" alt="Screenshot 1" /></p>`,
    );
    expect(html).toContain('alt="Screenshot 2"');
    expect(html.indexOf("The save fails.")).toBeLessThan(html.indexOf("<h3>Evidence</h3>"));
  });

  it("reuses the agent's own Evidence heading instead of adding a second one", () => {
    const html = buildAzureBody("Broken.\n\n## Evidence\n\nSee the toast.", [img(1, "Toast")]);
    expect(count(html, /Evidence/g)).toBe(1);
    expect(html.indexOf("See the toast.")).toBeLessThan(html.indexOf("<img"));
  });

  it("treats a bold Evidence label as the agent's heading too", () => {
    const html = buildAzureBody("Broken.\n\n**Evidence**\n\nSee below.", [img(1)]);
    expect(count(html, /Evidence/g)).toBe(1);
  });

  it("reuses an Evidence heading written with a colon, bold or not", () => {
    for (const md of ["Broken.\n\n## Evidence:\n\nSee below.", "Broken.\n\n**Evidence:**\n\nSee below."]) {
      const html = buildAzureBody(md, [img(1)]);
      expect(count(html, /Evidence/g)).toBe(1);
      expect(html).toMatch(/<h\d>Evidence:<\/h\d>/);
      expect(html.indexOf("See below.")).toBeLessThan(html.indexOf("<img"));
    }
  });

  it("adds its own heading when the agent's line doesn't render as one", () => {
    const html = buildAzureBody("Broken.\n\n##### Evidence", [img(1)]);
    expect(count(html, /<h\d>Evidence<\/h\d>/g)).toBe(1);
    expect(html.indexOf("<h3>Evidence</h3>")).toBeLessThan(html.indexOf("<img"));
  });

  it("puts the images inside the agent's Evidence section, not under a later one", () => {
    const html = buildAzureBody("## Evidence\n\nToast.\n\n## Environment\n\nChrome 141", [img(1)]);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Environment"));
    expect(html).toContain("Chrome 141");
  });

  it("calls a recording only 'Screen recording', never by file name", () => {
    const html = buildAzureBody("x", [
      { url: `${BASE}/_apis/wit/attachments/r1?fileName=Screen%20recording.webm`, isImage: false, caption: "replay.webm" },
    ]);
    expect(html).toContain("<strong>Screen recording:</strong>");
    expect(html).toContain("Watch the screen recording");
    // The caption of a recording is not rendered, so nothing it says leaks.
    expect(html).not.toContain("replay");
  });

  it("appends each technical-logs section under its title, after the evidence", () => {
    const html = buildAzureBody("x", [img(1)], [
      { title: "Network <calls>", markdown: "| Method | Status |\n|---|---|\n| GET | 500 |" },
      { title: "Empty", markdown: "   " },
    ]);
    expect(html).toContain("<h3>Network &lt;calls&gt;</h3>");
    expect(html).toContain("<td>500</td>");
    expect(html).not.toContain("Empty");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Network"));
  });

  it("always ends with the attribution, exactly once", () => {
    const html = buildAzureBody(`x\n\n---\n\nReported with [Brief](${BRIEF_URL})`, [img(1)], [
      { title: "Console", markdown: "`TypeError`" },
    ]);
    expect(count(html, /Reported with/g)).toBe(1);
    expect(html.endsWith(`<a href="${BRIEF_URL}" target="_blank" rel="noreferrer noopener">Brief</a></p>`)).toBe(true);
    expect(html.indexOf("Console")).toBeLessThan(html.indexOf("<hr />"));
    expect(html).not.toContain("<p>---</p>");
  });

  it("escapes caption text", () => {
    expect(buildAzureBody("x", [img(1, "<script>")])).toContain("<p>&lt;script&gt;</p>");
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("authorization header", () => {
  // A PAT only works as HTTP Basic and an Entra token only as Bearer, so the
  // adapter must send whichever it was given byte for byte.
  it.each([
    ["Basic (PAT)", BASIC],
    ["Bearer (Entra ID)", BEARER],
  ])("passes %s through verbatim", async (_label, authorization) => {
    const calls = mockFetch(() => ({ json: PROJECTS }));
    const targets = await makeAzureTracker({ org: ORG, authorization }).listTargets();
    expect(targets.map((t) => t.name)).toEqual([PROJECT]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/_apis/projects?$top=200&api-version=7.1`);
    expect(calls[0].headers.get("Authorization")).toBe(authorization);
  });

  it("reads a 203 sign-in page as an expired connection", async () => {
    mockFetch(() => ({ status: 203, text: "<html>Sign in</html>" }));
    await expect(makeAzureTracker({ org: ORG, authorization: BASIC }).listTargets()).rejects.toThrow(
      /reconnect Azure DevOps/,
    );
  });
});

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

describe("fileIssue", () => {
  it("files a Bug with evidence, logs and attribution in Repro Steps", async () => {
    const calls = mockFetch(filingRoutes(AGILE_TYPES));
    const out = await makeAzureTracker({ org: ORG, authorization: BEARER }).fileIssue(
      input({
        evidence: [
          { filename: "replay-frames/f-0001.png", contentType: "image/png", bytes: PNG, caption: "The error toast" },
          { filename: "replay.webm", contentType: "video/webm", bytes: Buffer.from("webm") },
        ],
        details: [{ title: "Network calls", markdown: "- `POST /api/save` 500" }],
      }),
    );

    expect(out).toEqual({
      id: "299",
      identifier: `${PROJECT}#299`,
      url: `${BASE}/${PROJECT}/_workitems/edit/299`,
      title: "Save fails on the billing page",
    });

    // Uploaded under plain names: Brief's file names say how it was captured.
    const uploads = calls.filter((c) => c.url.includes("/_apis/wit/attachments"));
    expect(uploads.map((c) => new URL(c.url).searchParams.get("fileName"))).toEqual([
      "Screenshot 1.png",
      "Screen recording.webm",
    ]);
    expect(uploads[0].headers.get("Content-Type")).toBe("application/octet-stream");
    expect(uploads.every((c) => c.headers.get("Authorization") === BEARER)).toBe(true);

    const create = createCall(calls);
    expect(create.url).toBe(`${BASE}/${PROJECT}/_apis/wit/workitems/$Bug?api-version=7.1`);
    expect(create.headers.get("Content-Type")).toBe("application/json-patch+json");
    const ops = opsOf(create);
    const body = String(fieldValue(ops, AZ_FIELD.reproSteps));
    expect(fieldValue(ops, AZ_FIELD.description)).toBeUndefined();

    // Section label promoted, evidence, then logs, then the attribution last.
    expect(body).toContain("<h4>Steps to reproduce</h4>");
    expect(body).toContain('<p>The error toast</p>\n<p><img src="');
    expect(body).toContain("<strong>Screen recording:</strong>");
    expect(body).toContain("<h3>Network calls</h3>\n<ul><li><code>POST /api/save</code> 500</li></ul>");
    expect(body.indexOf("<img")).toBeLessThan(body.indexOf("Network calls"));
    expect(body.indexOf("Network calls")).toBeLessThan(body.indexOf("Reported with"));
    expect(body).not.toMatch(/replay/);

    // Both files also land in the Attachments panel.
    const rels = ops.filter((o) => o.path === "/relations/-");
    expect(rels).toHaveLength(2);
    expect(rels[0].value).toMatchObject({ rel: "AttachedFile", attributes: { comment: "The error toast" } });
  });

  it("puts the logs in Description for a work item type that isn't a Bug", async () => {
    const calls = mockFetch(filingRoutes(BASIC_TYPES));
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({ details: [{ title: "Console", markdown: "`TypeError: x is undefined`" }] }),
    );
    const create = createCall(calls);
    // The Basic process has no Bug, so Issue is the next best fit.
    expect(decodeURIComponent(create.url)).toContain("/_apis/wit/workitems/$Issue?");
    const ops = opsOf(create);
    expect(fieldValue(ops, AZ_FIELD.reproSteps)).toBeUndefined();
    const body = String(fieldValue(ops, AZ_FIELD.description));
    expect(body).toContain("<h3>Console</h3>\n<p><code>TypeError: x is undefined</code></p>");
    expect(body).toMatch(/Reported with <a [^>]*>Brief<\/a><\/p>$/);
  });

  it("honors System.WorkItemType from the custom fields without sending it as a field", async () => {
    const calls = mockFetch(filingRoutes(AGILE_TYPES));
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({ extraFields: { "System.WorkItemType": "user story" } }),
    );
    const create = createCall(calls);
    expect(decodeURIComponent(create.url)).toContain("/workitems/$User Story?");
    expect(opsOf(create).some((o) => o.path === "/fields/System.WorkItemType")).toBe(false);
    expect(fieldValue(opsOf(create), AZ_FIELD.description)).toBeTruthy();
  });

  it("writes a single Evidence heading when the agent already wrote one", async () => {
    const calls = mockFetch(filingRoutes(AGILE_TYPES));
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({
        descriptionMarkdown: "Save fails.\n\n## Evidence\n\nThe toast says 500.",
        evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG, caption: "Toast" }],
      }),
    );
    const body = String(fieldValue(opsOf(createCall(calls)), AZ_FIELD.reproSteps));
    expect(body.match(/Evidence/g)).toHaveLength(1);
  });

  it("sends tags, priority, assignee and area path, and retries without them on a 400", async () => {
    let attempts = 0;
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) => {
        if (call.method === "POST" && decodeURIComponent(call.url).includes("/workitems/$Bug")) {
          attempts += 1;
          if (attempts === 1) {
            return {
              status: 400,
              json: {
                message: "TF401347: Invalid tree name given for work item -1, field 'System.AreaPath'.",
                typeKey: "WorkItemFieldInvalidTreeNameException",
              },
            };
          }
        }
        return undefined;
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({ labels: ["billing", "regression"], priority: "high", assignee: "Jamal Hartnett", project: "Nope" }),
    );
    expect(out.identifier).toBe(`${PROJECT}#299`);

    const creates = calls.filter((c) => c.method === "POST" && decodeURIComponent(c.url).includes("/workitems/$Bug"));
    expect(creates).toHaveLength(2);
    const first = opsOf(creates[0]);
    expect(fieldValue(first, AZ_FIELD.tags)).toBe("billing; regression");
    expect(fieldValue(first, AZ_FIELD.priority)).toBe(2);
    expect(fieldValue(first, AZ_FIELD.assignedTo)).toBe("Jamal Hartnett");
    expect(fieldValue(first, AZ_FIELD.areaPath)).toBe("Nope");
    const retry = opsOf(creates[1]);
    expect(retry.map((o) => o.path)).toEqual(["/fields/System.Title", `/fields/${AZ_FIELD.reproSteps}`]);
  });

  it("passes raw fields through to the create, with resolved fields winning", async () => {
    const calls = mockFetch(filingRoutes(AGILE_TYPES));
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({
        priority: "urgent",
        extraFields: {
          "Microsoft.VSTS.Common.Severity": "2 - High",
          [AZ_FIELD.priority]: 4,
          [AZ_FIELD.title]: "Not this title",
        },
      }),
    );
    const ops = opsOf(createCall(calls));
    expect(fieldValue(ops, "Microsoft.VSTS.Common.Severity")).toBe("2 - High");
    expect(fieldValue(ops, AZ_FIELD.priority)).toBe(1);
    expect(fieldValue(ops, AZ_FIELD.title)).toBe("Save fails on the billing page");
    // One op per path: a duplicate would leave the outcome to Azure DevOps.
    expect(new Set(ops.map((o) => o.path)).size).toBe(ops.length);
  });

  // A project can make a custom field required. The agent sets it from
  // get_target_details through the raw fields, so a retry that dropped those
  // too would fail on the missing field every time.
  it("keeps a required custom field when it retries without the resolved fields", async () => {
    const REQUIRED = "Custom.Environment";
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) => {
        if (call.method !== "POST" || !decodeURIComponent(call.url).includes("/workitems/$Bug")) return undefined;
        const ops = opsOf(call);
        if (fieldValue(ops, REQUIRED) === undefined) {
          return {
            status: 400,
            json: { message: `TF401320: Rule Error for field Environment. Error code: Required, InvalidEmpty.` },
          };
        }
        if (fieldValue(ops, AZ_FIELD.assignedTo) !== undefined) {
          return {
            status: 400,
            json: { message: "The identity value 'Devin' for field 'Assigned To' is an unknown identity." },
          };
        }
        return undefined;
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({ assignee: "Devin", extraFields: { [REQUIRED]: "Production" } }),
    );
    expect(out.identifier).toBe(`${PROJECT}#299`);
    const creates = calls.filter((c) => c.method === "POST" && decodeURIComponent(c.url).includes("/workitems/$Bug"));
    expect(creates).toHaveLength(2);
    expect(fieldValue(opsOf(creates[1]), REQUIRED)).toBe("Production");
    expect(fieldValue(opsOf(creates[1]), AZ_FIELD.assignedTo)).toBeUndefined();
  });

  it("drops the raw fields last, and gives up only when the bare create fails", async () => {
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) =>
        call.method === "POST" && decodeURIComponent(call.url).includes("/workitems/$Bug")
          ? { status: 400, json: { message: "TF401326: Invalid field status 'InvalidListValue'." } }
          : undefined,
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
        input({ labels: ["billing"], extraFields: { "Custom.Environment": "Mars" } }),
      ),
    ).rejects.toThrow(/create failed: 400/);
    const creates = calls.filter((c) => c.method === "POST" && decodeURIComponent(c.url).includes("/workitems/$Bug"));
    expect(creates.map((c) => opsOf(c).map((o) => o.path.replace("/fields/", "")))).toEqual([
      [AZ_FIELD.title, AZ_FIELD.reproSteps, "Custom.Environment", AZ_FIELD.tags],
      [AZ_FIELD.title, AZ_FIELD.reproSteps, "Custom.Environment"],
      [AZ_FIELD.title, AZ_FIELD.reproSteps],
    ]);
  });

  it("sets the state after the create, resolved against the type's real states", async () => {
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) =>
        call.method === "PATCH" ? createdReply("Bug", "Save fails on the billing page", "Active") : undefined,
      ),
    );
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(input({ state: "active" }));
    expect(opsOf(createCall(calls)).some((o) => o.path === "/fields/System.State")).toBe(false);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`${BASE}/_apis/wit/workitems/299?api-version=7.1`);
    expect(patch?.body).toEqual([{ op: "add", path: "/fields/System.State", value: "Active" }]);
  });

  it("never fails the filing over an unknown state", async () => {
    const calls = mockFetch(filingRoutes(AGILE_TYPES));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(input({ state: "Triage" }));
    expect(out.identifier).toBe(`${PROJECT}#299`);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("posts the comment on the preview comments API", async () => {
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) =>
        call.url.includes("/comments") ? { json: { workItemId: 299, commentId: 50, version: 1 } } : undefined,
      ),
    );
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(input({ comment: "In progress" }));
    const c = calls.find((x) => x.url.includes("/comments"));
    expect(c?.url).toBe(`${BASE}/${PROJECT}/_apis/wit/workItems/299/comments?api-version=7.1-preview.4`);
    expect(c?.body).toEqual({ text: "<p>In progress</p>" });
  });

  it("files the work item even when an upload fails", async () => {
    const calls = mockFetch(
      filingRoutes(AGILE_TYPES, (call) =>
        call.url.includes("/_apis/wit/attachments") ? { status: 413, json: { message: "too large" } } : undefined,
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await makeAzureTracker({ org: ORG, authorization: BASIC }).fileIssue(
      input({ evidence: [{ filename: "a.png", contentType: "image/png", bytes: PNG }] }),
    );
    const ops = opsOf(createCall(calls));
    expect(ops.some((o) => o.path === "/relations/-")).toBe(false);
    expect(String(fieldValue(ops, AZ_FIELD.reproSteps))).not.toContain("Evidence");
  });
});

// ---------------------------------------------------------------------------
// Update, read, search, live
// ---------------------------------------------------------------------------

const WORK_ITEM_299 = {
  id: 299,
  rev: 3,
  fields: {
    "System.TeamProject": PROJECT,
    "System.AreaPath": `${PROJECT}\\Billing`,
    "System.WorkItemType": "Bug",
    "System.State": "New",
    "System.Title": "Save fails on the billing page",
    "System.Tags": "billing; regression",
    "Microsoft.VSTS.Common.Priority": 2,
    "System.CreatedDate": "2026-10-13T09:12:44.51Z",
    "System.AssignedTo": {
      displayName: "Jamal Hartnett",
      uniqueName: "fabrikamfiber4@hotmail.com",
      id: "d291b0c4-a05c-4ea6-8df1-4b41d5f39eff",
    },
  },
  url: `${BASE}/_apis/wit/workItems/299`,
};

const identity = (displayName: string, uniqueName: string) => ({
  identity: {
    displayName,
    uniqueName,
    id: `id-${uniqueName}`,
    url: `https://vssps.dev.azure.com/${ORG}/_apis/Identities/id-${uniqueName}`,
  },
});

/** Team, roster and area-path envelopes, shaped like the 7.1 docs' samples. */
function projectMetaReply(call: Call): Reply | undefined {
  const u = new URL(call.url);
  const p = decodeURIComponent(u.pathname);
  if (p === `/${ORG}/_apis/projects/${PROJECT}/teams`) {
    return {
      json: {
        count: 2,
        value: [
          { id: "t1", name: `${PROJECT} Team`, projectName: PROJECT },
          { id: "t2", name: "Billing", projectName: PROJECT },
        ],
      },
    };
  }
  if (p === `/${ORG}/_apis/projects/${PROJECT}/teams/${PROJECT} Team/members`) {
    return {
      json: {
        count: 2,
        value: [identity("Jamal Hartnett", "fabrikamfiber4@hotmail.com"), identity("Normal Paulk", "fabrikamfiber16@hotmail.com")],
      },
    };
  }
  if (p === `/${ORG}/_apis/projects/${PROJECT}/teams/Billing/members`) {
    // Jamal is on both teams; he must be listed once.
    return { json: { count: 1, value: [identity("Jamal Hartnett", "fabrikamfiber4@hotmail.com")] } };
  }
  if (p === `/${ORG}/${PROJECT}/_apis/wit/classificationnodes/areas`) {
    return {
      json: {
        id: 126391,
        name: PROJECT,
        structureType: "area",
        hasChildren: true,
        children: [
          {
            id: 126392,
            name: "Billing",
            structureType: "area",
            hasChildren: true,
            children: [{ id: 126394, name: "Invoices", structureType: "area", hasChildren: false }],
          },
          { id: 126393, name: "Web", structureType: "area", hasChildren: false },
        ],
      },
    };
  }
  return undefined;
}

const AREA_PATHS = [PROJECT, `${PROJECT}\\Billing`, `${PROJECT}\\Billing\\Invoices`, `${PROJECT}\\Web`];

describe("getTargetDetails", () => {
  it("reads types once and returns states, members, area paths and settable fields", async () => {
    const calls = mockFetch((call) => {
      const meta = projectMetaReply(call);
      if (meta) return meta;
      const p = decodeURIComponent(new URL(call.url).pathname);
      if (p === `/${ORG}/_apis/projects`) return { json: PROJECTS };
      if (p === `/${ORG}/${PROJECT}/_apis/wit/workitemtypes`) return { json: AGILE_TYPES };
      if (p === `/${ORG}/${PROJECT}/_apis/wit/workitemtypes/Bug/states`) return { json: BUG_STATES };
      if (p === `/${ORG}/${PROJECT}/_apis/wit/workitemtypes/Bug/fields`) {
        return {
          json: {
            count: 5,
            value: [
              { referenceName: "System.Title", name: "Title", alwaysRequired: true, allowedValues: [] },
              {
                referenceName: "Microsoft.VSTS.Common.Severity",
                name: "Severity",
                alwaysRequired: false,
                defaultValue: "3 - Medium",
                allowedValues: ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"],
              },
              { referenceName: "Custom.Environment", name: "Environment", alwaysRequired: true, allowedValues: [] },
              { referenceName: "System.History", name: "History", alwaysRequired: false, allowedValues: [] },
              {
                referenceName: "Microsoft.VSTS.Common.Priority",
                name: "Priority",
                alwaysRequired: false,
                allowedValues: ["1", "2", "3", "4"],
              },
            ],
          },
        };
      }
      return undefined;
    });

    const d = await makeAzureTracker({ org: ORG, authorization: BASIC }).getTargetDetails(PROJECT);

    expect(calls.filter((c) => new URL(c.url).pathname.endsWith("/_apis/wit/workitemtypes"))).toHaveLength(1);
    expect(d).toEqual({
      id: PROJECT,
      key: PROJECT,
      name: PROJECT,
      description: "Team project for the Fiber suite",
      states: ["New", "Active", "Resolved", "Closed"],
      labels: [],
      members: ["Jamal Hartnett", "Normal Paulk"],
      projects: AREA_PATHS.map((a) => ({ id: a, name: a })),
      issueTypes: ["Bug", "Task", "User Story"],
      // Title and Priority have first-class parameters; History has nothing
      // to choose from and isn't required.
      customFields: [
        {
          id: "Microsoft.VSTS.Common.Severity",
          name: "Severity",
          type: "string",
          required: false,
          allowedValues: ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"],
        },
        { id: "Custom.Environment", name: "Environment", type: "string", required: true, allowedValues: undefined },
      ],
    });
  });

  it("names the known projects when the target isn't one", async () => {
    mockFetch(() => ({ json: PROJECTS }));
    await expect(makeAzureTracker({ org: ORG, authorization: BASIC }).getTargetDetails("Nope")).rejects.toThrow(
      `Known projects: ${PROJECT}`,
    );
  });
});

describe("updateIssue", () => {
  it("reports the valid states when the requested one doesn't exist", async () => {
    const calls = mockFetch((call) => {
      if (call.url.startsWith(`${BASE}/_apis/wit/workitems/299?`)) return { json: WORK_ITEM_299 };
      if (call.url.includes("/states")) return { json: BUG_STATES };
      return undefined;
    });
    const r = await makeAzureTracker({ org: ORG, authorization: BASIC }).updateIssue(`${PROJECT}#299`, {
      state: "Triage",
    });
    expect(r).toEqual({ ok: false, error: 'state "Triage" not found. Valid states for Bug: New, Active, Resolved, Closed' });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("patches the resolved fields with add ops", async () => {
    const calls = mockFetch((call) => {
      if (call.url.startsWith(`${BASE}/_apis/wit/workitems/299?`)) return { json: WORK_ITEM_299 };
      if (call.url.includes("/states")) return { json: BUG_STATES };
      return undefined;
    });
    const r = await makeAzureTracker({ org: ORG, authorization: BASIC }).updateIssue(`${PROJECT}#299`, {
      state: "resolved",
      priority: "urgent",
    });
    expect(r).toEqual({ ok: true });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual([
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 1 },
      { op: "add", path: "/fields/System.State", value: "Resolved" },
    ]);
  });

  it("surfaces Azure DevOps' own error text", async () => {
    mockFetch((call) => {
      if (call.method === "PATCH") {
        return { status: 400, json: { message: "TF401320: Rule Error for field Assigned To." } };
      }
      return { json: WORK_ITEM_299 };
    });
    const r = await makeAzureTracker({ org: ORG, authorization: BASIC }).updateIssue(`${PROJECT}#299`, {
      assignee: "Nobody",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("TF401320");
  });

  it("lists the valid assignees when Azure DevOps refuses one", async () => {
    mockFetch((call) => {
      if (call.method === "PATCH") {
        return {
          status: 400,
          json: { message: "The identity value 'Jamal' for field 'Assigned To' is an ambiguous identity." },
        };
      }
      return projectMetaReply(call) ?? { json: WORK_ITEM_299 };
    });
    const r = await makeAzureTracker({ org: ORG, authorization: BASIC }).updateIssue(`${PROJECT}#299`, {
      assignee: "Jamal",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("ambiguous identity");
    expect(!r.ok && r.error).toContain("Valid assignees: Jamal Hartnett, Normal Paulk");
    expect(!r.ok && r.error).not.toContain("Valid area paths");
  });

  it("lists the valid area paths when Azure DevOps refuses one", async () => {
    mockFetch((call) => {
      if (call.method === "PATCH") {
        return {
          status: 400,
          json: { message: "TF401347: Invalid tree name given for work item 299, field 'System.AreaPath'." },
        };
      }
      return projectMetaReply(call) ?? { json: WORK_ITEM_299 };
    });
    const r = await makeAzureTracker({ org: ORG, authorization: BASIC }).updateIssue(`${PROJECT}#299`, {
      project: "Billing",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("TF401347");
    expect(!r.ok && r.error).toContain(`Valid area paths: ${AREA_PATHS.join(", ")}`);
  });
});

describe("getIssue", () => {
  it("reads back the fields the agent can verify", async () => {
    mockFetch(() => ({ json: WORK_ITEM_299 }));
    const i = await makeAzureTracker({ org: ORG, authorization: BASIC }).getIssue(`${PROJECT}#299`);
    expect(i).toMatchObject({
      identifier: `${PROJECT}#299`,
      state: "New",
      assignee: "Jamal Hartnett",
      labels: ["billing", "regression"],
      priority: "high",
      issueType: "Bug",
      project: `${PROJECT}\\Billing`,
    });
  });
});

describe("searchIssues", () => {
  it("queries WIQL, then batch-reads the hits, skipping omitted items", async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes("/_apis/wit/wiql")) {
        return { json: { queryType: "flat", workItems: [{ id: 299 }, { id: 300 }] } };
      }
      if (call.url.includes("/_apis/wit/workitems?")) return { json: { count: 2, value: [WORK_ITEM_299, null] } };
      return undefined;
    });
    const hits = await makeAzureTracker({ org: ORG, authorization: BASIC }).searchIssues("it's broken", {
      limit: 5,
    });
    expect(calls[0].url).toBe(`${BASE}/_apis/wit/wiql?$top=5&api-version=7.1`);
    expect((calls[0].body as { query: string }).query).toContain("CONTAINS 'it''s broken'");
    expect(hits).toEqual([
      expect.objectContaining({ identifier: `${PROJECT}#299`, state: "New", priority: "high", issueType: "Bug" }),
    ]);
  });

  it("returns [] on any failure", async () => {
    mockFetch(() => ({ status: 500, json: {} }));
    await expect(makeAzureTracker({ org: ORG, authorization: BASIC }).searchIssues("x")).resolves.toEqual([]);
  });
});

describe("getLiveIssues", () => {
  // Shaped like the documented Recyclebin - Get Deleted Work Items sample.
  const deletedRef = (id: number) => ({
    id: String(id),
    code: 200,
    type: "Bug",
    name: `Bug ${id}`,
    project: PROJECT,
    deletedDate: "10/13/2026 9:21:14 AM",
    deletedBy: "Jamal Hartnett <fabrikamfiber4@hotmail.com>",
    url: `${BASE}/_apis/wit/recycleBin/${id}`,
  });

  function liveRoutes(recycleBin: (call: Call) => Reply) {
    return mockFetch((call) => {
      if (call.url.includes("/_apis/wit/recyclebin")) return recycleBin(call);
      if (call.url.includes("/_apis/wit/workitems?")) {
        return { json: { count: 3, value: [WORK_ITEM_299, null, null] } };
      }
      return undefined;
    });
  }

  const IDS = [`${PROJECT}#299`, `${PROJECT}#300`, `${PROJECT}#301`];

  it("reports an omitted work item as gone only when the recycle bin has it", async () => {
    const calls = liveRoutes(() => ({ json: { count: 1, value: [deletedRef(300)] } }));
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).getLiveIssues(IDS);
    expect(calls[0].url).toContain("/_apis/wit/workitems?ids=299,300,301&fields=");
    expect(calls[0].url).toContain("&errorPolicy=Omit&api-version=7.1");
    // Only the omitted ids are asked about.
    expect(calls[1].url).toBe(`${BASE}/_apis/wit/recyclebin?ids=300,301&api-version=7.1`);
    // 301 was omitted but is not in the recycle bin: the user may simply have
    // lost access to it, so it must not show as deleted.
    expect(out.gone).toEqual([`${PROJECT}#300`]);
    expect(Object.keys(out.issues)).toEqual([`${PROJECT}#299`]);
    expect(out.issues[`${PROJECT}#299`]).toEqual({
      identifier: `${PROJECT}#299`,
      title: "Save fails on the billing page",
      url: `${BASE}/${PROJECT}/_workitems/edit/299`,
      stateName: "New",
      stateColor: STATUS_COLOR.neutral,
      createdAt: "2026-10-13T09:12:44.51Z",
      assignee: { name: "Jamal Hartnett" },
    });
  });

  it("accepts the recycle bin as a bare array, as documented, and skips non-200 entries", async () => {
    liveRoutes(() => ({
      json: [deletedRef(301), { id: 300, code: 404, message: "TF401232: Work item 300 does not exist" }],
    }));
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).getLiveIssues(IDS);
    expect(out.gone).toEqual([`${PROJECT}#301`]);
  });

  it("confirms nothing when the recycle bin can't be read", async () => {
    liveRoutes(() => ({ status: 403, json: { message: "TF51644: access denied" } }));
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).getLiveIssues(IDS);
    expect(out.gone).toEqual([]);
    // The readable work item is still reported.
    expect(Object.keys(out.issues)).toEqual([`${PROJECT}#299`]);
  });

  it("never mistakes a failed read for a deletion", async () => {
    mockFetch(() => ({ status: 500, json: { message: "boom" } }));
    const out = await makeAzureTracker({ org: ORG, authorization: BASIC }).getLiveIssues([`${PROJECT}#299`]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });

  it("does not throw when the connection has expired", async () => {
    mockFetch(() => ({ status: 401, json: {} }));
    const out = await makeAzureTracker({ org: ORG, authorization: BEARER }).getLiveIssues([`${PROJECT}#299`]);
    expect(out).toEqual({ issues: {}, gone: [] });
  });
});

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

describe("listAzureOrgs", () => {
  const ME = {
    displayName: "Normal Paulk",
    publicAlias: "d6245f20-2af8-44f4-9451-8107cb2767db",
    emailAddress: "fabrikamfiber16@hotmail.com",
    coreRevision: 1647,
    timeStamp: "2014-05-12T22:23:07.727+00:00",
    id: "d6245f20-2af8-44f4-9451-8107cb2767db",
    revision: 1647,
  };
  const ACCOUNTS = {
    count: 2,
    value: [
      {
        accountId: "bf83696f-383b-4980-95b5-1f1127640a8a",
        accountUri: "https://vssps.dev.azure.com/NormalPaulk/",
        accountName: "NormalPaulk",
        properties: {},
      },
      {
        accountId: "6affcbef-fe5d-44c6-8a29-439b79aaa118",
        accountUri: "https://vssps.dev.azure.com/Fabrikam-Fiber-Inc/",
        accountName: "Fabrikam-Fiber-Inc",
        properties: {},
      },
    ],
  };

  it("resolves the member id, then lists that member's organizations", async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes("/profile/profiles/me")) return { json: ME };
      if (call.url.includes("/_apis/accounts")) return { json: ACCOUNTS };
      return undefined;
    });
    const orgs = await listAzureOrgs(BEARER);
    expect(calls.map((c) => c.url)).toEqual([
      "https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1",
      `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${ME.id}&api-version=7.1`,
    ]);
    expect(calls.every((c) => c.headers.get("Authorization") === BEARER)).toBe(true);
    expect(orgs).toEqual([
      { id: "Fabrikam-Fiber-Inc", name: "Fabrikam-Fiber-Inc" },
      { id: "NormalPaulk", name: "NormalPaulk" },
    ]);
  });

  it("returns [] without a second call when the profile can't be read", async () => {
    // A PAT scoped to a single organization may not read the global profile.
    const calls = mockFetch(() => ({ status: 401, json: {} }));
    await expect(listAzureOrgs(BASIC)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("returns [] when the accounts call fails or the PAT gets the sign-in page", async () => {
    mockFetch((call) => (call.url.includes("/profile/") ? { json: ME } : { status: 500, json: {} }));
    await expect(listAzureOrgs(BASIC)).resolves.toEqual([]);
    vi.unstubAllGlobals();
    mockFetch(() => ({ status: 203, text: "<html>Sign in</html>" }));
    await expect(listAzureOrgs(BASIC)).resolves.toEqual([]);
  });

  it("returns [] when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(listAzureOrgs(BEARER)).resolves.toEqual([]);
  });
});
