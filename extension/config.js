// Brief Cloud — which backend does the extension talk to?
//
// Change ENV below, then reload the extension at chrome://extensions
// (hit the ↻ button on the Brief Cloud card). That's the only switch.
//
//   local → your dev server      (npm run dev in web/, http://localhost:3000)
//   fly   → the raw Fly app URL   (works today, before the custom domain is set up)
//   prod  → the custom domain     (use once cloud.get-brief.app resolves + has a cert)
//
// Note: every URL here must also be listed in manifest.json
// "externally_connectable.matches" or the /connect token handshake won't reach
// the extension.
export const ENV = "fly"; // "local" | "fly" | "prod"

export const APP_URLS = {
  local: "http://localhost:3000",
  fly: "https://brief-cloud.fly.dev",
  prod: "https://cloud.get-brief.app",
};

export const APP_URL = APP_URLS[ENV];
