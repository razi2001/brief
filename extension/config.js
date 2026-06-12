// Brief Cloud - which backend does the extension talk to?
//
// Change ENV below, then reload the extension at chrome://extensions
// (hit the ↻ button on the Brief Cloud card). That's the only switch.
//
//   local → your dev server   (npm run dev in web/, http://localhost:3000)
//   prod  → the deployed app   (https://cloud.get-brief.app)
//
// Note: every URL here must also be listed in manifest.json
// "externally_connectable.matches" or the /connect token handshake won't reach
// the extension.
export const ENV = "prod"; // "local" | "prod"

export const APP_URLS = {
  local: "http://localhost:3000",
  prod: "https://cloud.get-brief.app",
};

export const APP_URL = APP_URLS[ENV];
