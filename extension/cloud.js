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

// Upload the brief, then kick off processing WITHOUT waiting for the agent.
// keepalive lets the /process request survive the popup closing.
export async function submitBrief(files, meta) {
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
  // Fire processing and DO NOT await it. keepalive keeps it alive past popup close.
  fetch(`${APP_URL}/api/briefs/${briefId}/process`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true }).catch(() => {});
  return { briefId, dashboardUrl: `${APP_URL}/dashboard` };
}
