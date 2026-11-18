# Security

## Reporting a problem

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/razi2001/brief-cloud/security/advisories/new), not in a public issue. We reply within three days and will credit you in the fix unless you'd rather not.

In scope: the extension, the web app, the hosted instance at cloud.get-brief.app, and anything where the code does more with your data than [PRIVACY.md](PRIVACY.md) says.

## How Brief is built to be safe

- Tracker tokens are encrypted at rest (AES-256-GCM, `web/lib/crypto.ts`).
- The extension authenticates with a pairing token stored hashed (`extension_tokens.token_hash`). Only the app's own origin may hand the extension a token (`externally_connectable` plus an origin re-check in `background.js`).
- Every database table has row level security on and no policies; only the server's service-role key reads data.
- Uploads go straight to a private storage bucket through short-lived signed URLs.
- Owner views read an allowlist of columns that contains no ticket content, pinned by tests.
