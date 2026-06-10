// Brief Cloud client. Swap APP_URL for production later.
export const APP_URL = "http://localhost:3000";

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

// files: Array<{ name: string, blob: Blob, contentType?: string }>
// meta:  { transcript?, keyframeCount?, hasScreenshot?, description? }
export async function uploadAndProcess(files, meta) {
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
    const put = await fetch(up.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": f.contentType || f.blob.type || "application/octet-stream" },
      body: f.blob,
    });
    if (!put.ok) throw new Error(`upload ${f.name} failed: ${put.status}`);
  }

  const proc = await fetch(`${APP_URL}/api/briefs/${briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await proc.json().catch(() => ({}));
  return { briefId, ok: proc.ok, status: proc.status, ...result };
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

// Kick off processing (file the ticket) for an already-uploaded brief. keepalive
// lets it survive the popup/bar closing. Fire-and-forget by default.
export async function processBrief(briefId) {
  const token = await getCloudToken();
  if (!token) throw new Error("Not connected to Brief Cloud");
  await fetch(`${APP_URL}/api/briefs/${briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    keepalive: true,
  }).catch(() => {});
}

// Upload the brief, then kick off processing WITHOUT waiting for the agent.
// Used for screenshot/text briefs filed straight from the popup.
export async function submitBrief(files, meta) {
  const briefId = await uploadDraft(files, meta);
  processBrief(briefId);
  return { briefId, ticketsUrl: TICKETS_URL, dashboardUrl: `${APP_URL}/dashboard` };
}
