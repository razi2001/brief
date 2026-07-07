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
//
// The build uploaded to the Chrome Web Store lists ONLY the production origins
// (http://localhost:3000 was removed so a stray local server cannot message the
// extension and plant/wipe a pairing token). For local dev: set ENV="local"
// AND temporarily add "http://localhost:3000/*" back to
// externally_connectable.matches in manifest.json. background.js already trusts
// APP_URL as a pairing origin, so no other change is needed. Never commit the
// localhost entry into the package you upload to the Web Store.
export const ENV = "prod"; // "local" | "prod"  ← LOCAL DEV: revert to "prod" before publishing

export const APP_URLS = {
  local: "http://localhost:3000",
  prod: "https://cloud.get-brief.app",
};

export const APP_URL = APP_URLS[ENV];
