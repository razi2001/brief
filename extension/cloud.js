// Brief Cloud client. The backend URL lives in config.js — change ENV there to
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

// Create a brief row + upload its files. Does NOT file the ticket — the brief
// sits as an "uploaded" draft until processBrief() is called. Returns the cloud
// brief id. Used for recordings: we upload on stop to preserve the video, but
// only file when the user hits "Create ticket".
export async function uploadDraft(files, meta) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  const create = await fetch(`${APP_URL}/api/briefs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ meta, files: files.map((f) => f.name) }),
  });
  if (!create.ok) throw new Error(`create brief failed: ${create.status}`);
  const { briefId, uploads } = await create.json();
  for (const f of files) {
    const up = uploads[f.name];
    if (!up) throw new Error(`no upload URL for ${f.name}`);
    const put = await fetch(up.signedUrl, { method: "PUT", headers: { "Content-Type": f.contentType || f.blob.type || "application/octet-stream" }, body: f.blob });
    if (!put.ok) throw new Error(`upload ${f.name} failed: ${put.status}`);
  }
  return briefId;
}

// Kick off processing (file the ticket) for an already-uploaded brief. The route
// marks it queued and returns immediately (it files in the background), so this
// resolves fast. `title` (optional) is the user-given brief name, shown on the
// dashboard while filing.
//
// Throws on any non-OK response. A 409 means no tracker is connected — the
// thrown error carries `code: "no_tracker"` so the popup can show an
// actionable "connect your tracker" message instead of a generic failure.
export async function processBrief(briefId, title) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  const res = await fetch(`${APP_URL}/api/briefs/${briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: title || "" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.message || body?.error || `process failed: ${res.status}`);
    err.code = body?.error === "no_tracker" || res.status === 409 ? "no_tracker" : "process_failed";
    err.status = res.status;
    throw err;
  }
}
