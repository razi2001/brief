// Brief Cloud client. The backend URL lives in config.js - change ENV there to
// switch between local / fly / prod, then reload the extension.
import { APP_URL } from "./config.js";
export { APP_URL };

export async function getCloudToken() {
  const { briefCloudToken } = await chrome.storage.local.get("briefCloudToken");
  return briefCloudToken || null;
}
export async function setCloudToken(token) {
  await chrome.storage.local.set({ briefCloudToken: token });
}
export async function clearCloudToken() {
  await chrome.storage.local.remove("briefCloudToken");
}
export function openConnectPage() {
  chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` });
}

export const TICKETS_URL = `${APP_URL}/tickets`;

// Account status for gating "Create ticket": validates the pairing token and
// reports which tracker (if any) the CURRENT account has connected, with its
// display name from the server, and with none, why a connected one can't file
// yet (`trackerIssue`: a workspace to pick, an expired grant). `trackerAction`
// is what Create should offer instead: with a tracker, "reconnect" for a
// Linear, Jira or GitHub still held by Clerk (filing works meanwhile); with
// none, "pick" or "reconnect" for the tracker named in `trackerName`, else
// "connect". A 401
// means the pairing is dead (revoked, or the user switched accounts) - drop
// the cached token so the UI honestly shows "not connected" instead of filing
// into the void. Network errors return null so callers keep last-known state
// (don't block offline users).
export const TRACKER_ACTIONS = ['reconnect', 'pick', 'connect'];
export async function fetchAccountStatus() {
  const token = await getCloudToken();
  if (!token) return { connected: false, tracker: null, trackerName: null, trackerIssue: null, trackerAction: null };
  try {
    const res = await fetch(`${APP_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await clearCloudToken();
      return { connected: false, tracker: null, trackerName: null, trackerIssue: null, trackerAction: null };
    }
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return {
      connected: true,
      tracker: body?.tracker ?? null,
      trackerName: body?.trackerName ?? null,
      trackerIssue: typeof body?.trackerIssue === 'string' && body.trackerIssue ? body.trackerIssue : null,
      trackerAction: TRACKER_ACTIONS.includes(body?.trackerAction) ? body.trackerAction : null,
    };
  } catch {
    return null;
  }
}

// Read a (possibly truncated) error body so failures name their own cause in
// the inbox tooltip and the offscreen console - a bare status code ("415",
// "413") tells us nothing; the body says "object exceeded the maximum allowed
// size", "unauthorized", etc. Best-effort: never let reading the body throw.
async function errorDetail(res) {
  try {
    const text = (await res.text())?.trim();
    return text ? ` - ${text.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}

// fetch() that turns a network-level failure (DNS, offline, aborted because the
// offscreen document was torn down) into a labelled error instead of a bare
// "Failed to fetch", so the inbox tooltip distinguishes "can't reach server"
// from "server said no".
async function fetchOrThrow(url, init, label) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new Error(`${label}: network error (${err?.message || err})`);
  }
}

// Transcribe a short voice note (recorded in the popup) via the cloud - reuses
// the same model the brief-filing agent uses. Sends the audio as the raw body.
// Returns the recognized text (possibly empty); throws a labelled error on a
// network/auth/server failure so the caller can show a friendly hint.
export async function transcribeNote(blob, tokenOverride) {
  const token = tokenOverride || (await getCloudToken());
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetchOrThrow(
    `${APP_URL}/api/transcribe`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "audio/webm" },
      body: blob,
    },
    "transcribe",
  );
  if (!res.ok) throw new Error(`transcribe failed: ${res.status}${await errorDetail(res)}`);
  const body = await res.json().catch(() => ({}));
  return (body?.text || "").trim();
}

// Create a brief row + upload its files. Does NOT file the ticket - the brief
// sits as an "uploaded" draft until processBrief() is called. Returns the cloud
// brief id. Used for recordings: we upload on stop to preserve the video, but
// only file when the user hits "Create ticket".
//
// `tokenOverride` lets a caller pass a token captured earlier (before any
// account-sync churn could clear storage); falls back to the stored token.
export async function uploadDraft(files, meta, tokenOverride) {
  const token = tokenOverride || (await getCloudToken());
  if (!token) throw new Error("Not connected to Brief Cloud");
  const create = await fetchOrThrow(`${APP_URL}/api/briefs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ meta, files: files.map((f) => f.name) }),
  }, "create brief");
  if (!create.ok) throw new Error(`create brief failed: ${create.status}${await errorDetail(create)}`);
  const { briefId, uploads } = await create.json();
  await putAll(files, uploads, {});
  return briefId;
}

// Append extra files to an EXISTING brief draft (created earlier by
// uploadDraft - e.g. a recording's draft). Used when a screenshot is added
// AFTER the recording's draft was already uploaded: without this, the popup's
// filing path skips the screenshot entirely (it only uploads files when
// creating a brand-new draft), so the screenshot was silently dropped and only
// the recording reached the ticket.
//
// PUTs with `x-upsert: true` so re-uploading a file that already exists in the
// draft (e.g. the screenshot was bundled in the recording draft, then retaken)
// overwrites it instead of failing.
export async function uploadFilesToDraft(briefId, files, tokenOverride) {
  const token = tokenOverride || (await getCloudToken());
  if (!token) throw new Error("Not connected to Brief Cloud");
  const create = await fetchOrThrow(`${APP_URL}/api/briefs/${briefId}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: files.map((f) => f.name) }),
  }, "add files");
  if (!create.ok) throw new Error(`add files failed: ${create.status}${await errorDetail(create)}`);
  const { uploads } = await create.json();
  await putAll(files, uploads, { "x-upsert": "true" });
}

// PUT every file to its signed URL, a few at a time (they used to go one by
// one: a replay's json, voice-over and stills added seconds to "Create").
async function putAll(files, uploads, extraHeaders, parallel = 4) {
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const up = uploads[f.name];
      if (!up) throw new Error(`no upload URL for ${f.name}`);
      const put = await fetchOrThrow(up.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": f.contentType || f.blob.type || "application/octet-stream", ...extraHeaders },
        body: f.blob,
      }, `upload ${f.name}`);
      if (!put.ok) throw new Error(`upload ${f.name} failed: ${put.status}${await errorDetail(put)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, files.length) }, worker));
}

// Kick off processing (file the ticket) for an already-uploaded brief. The route
// marks it queued and returns immediately (it files in the background), so this
// resolves fast. `overrides` (optional) carries the user's edits made after
// upload - { title, includeVideo, transcript, description, extra, screenshots } -
// which the server applies over the capture-owned brief.json.
//
// Throws on any non-OK response. A 409 means no tracker is connected - the
// thrown error carries `code: "no_tracker"` so the popup can show an
// actionable "connect your tracker" message instead of a generic failure.
export async function processBrief(briefId, overrides = {}) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetch(`${APP_URL}/api/briefs/${briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(overrides || {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.message || body?.error || `process failed: ${res.status}`);
    // 409 already_filed: this capture already has a ticket (or is being filed).
    // Carry the share token so the popup can open the brief instead of erroring.
    err.code =
      body?.error === "already_filed" ? "already_filed"
      : body?.error === "no_tracker" || res.status === 409 ? "no_tracker"
      : "process_failed";
    err.shareId = body?.shareId || null;
    err.status = res.status;
    throw err;
  }
  // The brief's share token, so the popup can open its hosted page (which shows
  // the "writing…" state and resolves into the filed ticket).
  const body = await res.json().catch(() => ({}));
  return body?.shareId || null;
}

// Write an already-uploaded brief up as a DRAFT (no tracker, no filing). The
// route mints the brief's share token and returns it immediately, so the popup
// can open the brief's page (which shows a "writing this up" state and resolves
// into the finished ticket). Unlike processBrief, this needs NO tracker - it's
// the path for people with no tracker connected. Returns the share id.
export async function createDraft(briefId, overrides = {}) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetch(`${APP_URL}/api/briefs/${briefId}/draft`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(overrides || {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.message || body?.error || `draft failed: ${res.status}`);
    // 409 already_filed: it already has a ticket - open it rather than re-draft.
    err.code = body?.error === "already_filed" ? "already_filed" : "draft_failed";
    err.shareId = body?.shareId || null;
    err.status = res.status;
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  return body?.shareId || null;
}

// Absolute URL of a brief's hosted page.
export function briefPageUrl(shareId) {
  return `${APP_URL}/b/${shareId}`;
}
