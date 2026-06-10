// Brief — settings page.
//
// The filing skill ships inside every brief zip, so there's no install step.
// Account-level state (ticket preferences, connections) now lives in the Brief
// Cloud dashboard; this page only shows the cloud connection status and links
// out to the dashboard.

import { APP_URL, getCloudToken, clearCloudToken, openConnectPage } from "./cloud.js";

const DASHBOARD_URL = `${APP_URL}/dashboard`;

const els = {
  badgeConnected: document.getElementById("badgeConnected"),
  badgeDisconnected: document.getElementById("badgeDisconnected"),
  actionsConnected: document.getElementById("actionsConnected"),
  actionsDisconnected: document.getElementById("actionsDisconnected"),
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  openDashboard: document.getElementById("openDashboard"),
  dashboardLink: document.getElementById("dashboardLink"),
};

function show(el, visible) {
  if (el) el.classList.toggle("hidden", !visible);
}

async function render() {
  const token = await getCloudToken();
  const connected = !!token;
  show(els.badgeConnected, connected);
  show(els.badgeDisconnected, !connected);
  show(els.actionsConnected, connected);
  show(els.actionsDisconnected, !connected);
}

// Dashboard link target.
if (els.dashboardLink) els.dashboardLink.href = DASHBOARD_URL;

els.connect?.addEventListener("click", () => {
  openConnectPage();
});

els.disconnect?.addEventListener("click", async () => {
  await clearCloudToken();
  await render();
});

els.openDashboard?.addEventListener("click", () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});

render();
