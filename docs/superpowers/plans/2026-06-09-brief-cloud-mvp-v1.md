# Brief Cloud MVP v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin end-to-end SaaS slice of Brief Cloud: sign in to a web app, connect Linear via OAuth, pair the Chrome extension, upload a recorded brief, have a hosted Claude agent file the Linear ticket, then delete the media.

**Architecture:** A Next.js (App Router, TypeScript) app in `web/` provides the UI, API routes, and the processing agent. Supabase provides Auth (Google + magic link), Postgres (with RLS), and private Storage. The existing `extension/` is modified to pair with the cloud (via `externally_connectable`), upload a brief, and trigger processing. The processing route runs the Claude Agent SDK with the user's Linear OAuth token wired into Linear's remote MCP server (`mcp.linear.app`).

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind, **Clerk** (`@clerk/nextjs`) for user login, `@supabase/supabase-js` for Postgres + Storage, Supabase CLI (SQL migrations), `@anthropic-ai/claude-agent-sdk`, Vitest, Chrome MV3.

---

## REVISION 1 — Login uses Clerk (not Supabase Auth)

**Decision (2026-06-09):** user login is handled by **Clerk**; Supabase is used **only** for Postgres + Storage (accessed server-side via the service-role client). This supersedes the Supabase-Auth wording in the tasks below. Concrete deltas:

- **Deps (Task 1 addendum):** also install `@clerk/nextjs`. (Done as a follow-up if Task 1 already ran.)
- **Env:** add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`. Enable **Google** + **Email** in the Clerk dashboard. Supabase Auth provider config is no longer needed. Keep all `SUPABASE_*` and `TOKEN_ENC_KEY`, `LINEAR_*`, `ANTHROPIC_API_KEY`, `APP_URL` vars.
- **User IDs are Clerk strings** (e.g. `user_2ab...`), not UUIDs. Every `user_id` column becomes `text`.
- **Task 5 (schema):** drop the `profiles` table and the `handle_new_user` trigger/function entirely (Clerk is the user store). For `connections`, `extension_tokens`, `briefs`: change `user_id uuid ... references auth.users(id)` → `user_id text not null`. **Remove all RLS policies and `enable row level security`** — there is no `auth.uid()` without Supabase Auth. Access is server-only via the service-role client, always scoped by the Clerk `userId` in code. (Re-introducing RLS via Clerk JWT templates is a later hardening step.)
- **Task 6 (clients):** keep ONLY `createAdminSupabase()` (service role) for DB + Storage. Delete the `createServerSupabase` / browser Supabase-auth clients. `lib/auth.ts` becomes Clerk-based:
  ```ts
  import { auth } from "@clerk/nextjs/server";
  import { redirect } from "next/navigation";
  export async function getUserId() { return (await auth()).userId; }
  export async function requireUserId() {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
    return userId;
  }
  ```
  Everywhere later tasks call `requireUser()` / use `user.id`, use `requireUserId()` / the returned string instead.
- **Task 7 (login + callback):** REPLACE entirely. Wrap `app/layout.tsx` in `<ClerkProvider>`. Add `web/middleware.ts`:
  ```ts
  import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
  const isPublic = createRouteMatcher(["/sign-in(.*)", "/api/briefs(.*)"]);
  export default clerkMiddleware(async (auth, req) => { if (!isPublic(req)) await auth.protect(); });
  export const config = { matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"] };
  ```
  Note `/api/briefs(.*)` is PUBLIC to Clerk because it authenticates via the extension **bearer token**, not a Clerk session. Add `web/app/sign-in/[[...sign-in]]/page.tsx` rendering Clerk's `<SignIn />`. No `/auth/callback` route is needed.
- **Tasks 8, 9, 10, 16:** unchanged except `requireUser()`→`requireUserId()` and `user.id`→ the returned `userId` string; stored into `*.user_id` (text).
- **Tasks 11, 12, 15 (extension bearer API):** UNAFFECTED by Clerk — they authenticate via `extension_tokens` bearer lookup. Only the column type (`user_id text`) changes.
- **Tasks 2, 3, 4 (pure logic):** UNAFFECTED.

**Profile & account = Clerk (no local user table).** Clerk is the single source of truth for the user record (email, name, avatar). We never store or sync a copy.
- Server-side, when we need the user's email/name (e.g. for display or to label a connection), read it from `currentUser()` (`@clerk/nextjs/server`) — not from any DB row.
- Account management UI (avatar menu, manage account, sign out) uses Clerk's `<UserButton />`; client components read `useUser()` (`@clerk/nextjs`).
- **Task 16 (dashboard):** add `<UserButton />` in the header for account/sign-out, and greet the user via `currentUser()`. Our tables hold only the Clerk `userId` string as a foreign reference — no email/name columns.

When dispatching the affected tasks, the controller feeds the Clerk-correct code directly.

---

## REVISION 2 — Max Clerk for connections (Linear via Clerk, not our routes)

**Decision (2026-06-09):** Clerk is also the **connection vault**. The Linear connection is a Clerk **social connection** (preset); the OAuth flow, token storage, and refresh-on-fetch all live in Clerk. Our agent fetches the token from Clerk's Backend API at processing time. Verified against Clerk docs: presets exist for Linear, Slack, GitHub, GitLab, Notion, Atlassian/Jira; others (ClickUp, Asana, Azure DevOps) are addable as custom OAuth. Token retrieval: `clerkClient.users.getUserOauthAccessToken(userId, 'oauth_linear')` (custom providers use a `custom_` prefix). Clerk refreshes the token when requested.

Deltas vs. the tasks below:
- **Task 2 (`crypto.ts`):** built + committed, but **currently unused** under Max Clerk (we no longer store the Linear token ourselves). Keep as a util; revisit if we ever store a secret.
- **Task 5 (schema):** **DROP the `connections` table entirely** — Clerk holds the connection. Keep only `extension_tokens` and `briefs`, both with `user_id text`. No `profiles`, no RLS (server-side scoping via Clerk `userId`).
- **Task 8 (Linear OAuth routes):** **DELETED.** Replaced by:
  1. Dashboard config (no code): enable **Linear** social connection in the Clerk dashboard with scopes `read,write`; allow users to connect it as an additional connected account.
  2. A connect entry point in our UI that opens Clerk's connect-account flow (Clerk `<UserProfile/>` "Connected accounts", or `user.createExternalAccount({ strategy: 'oauth_linear', ... })`).
  3. A server helper `web/lib/linear.ts` → `getLinearToken(userId)`:
     ```ts
     import { clerkClient } from "@clerk/nextjs/server";
     export async function getLinearToken(userId: string): Promise<string | null> {
       const client = await clerkClient();
       const res = await client.users.getUserOauthAccessToken(userId, "oauth_linear");
       return res.data?.[0]?.token ?? null;
     }
     ```
- **Task 15 (process route):** replace the `connections` lookup + `decryptToken(...)` with `const linearToken = await getLinearToken(userId)` (where `userId` is resolved from the extension bearer token). If null → 409 "linear not connected".
- **Task 16 (dashboard):** connection status comes from Clerk — check whether the user has an `oauth_linear` external account (via `currentUser()` `externalAccounts`, or by attempting `getLinearToken`). "Connect Linear" triggers Clerk's connect flow. No `connections` table reads.

Net effect: removes our OAuth callback route, the `connections` table, and per-provider token crypto. Adding Jira/GitHub/etc. later = enable the provider in Clerk + a one-line token fetch.

---

## Prerequisites (one-time, before Task 1)

The implementing engineer needs these ready. They are inputs, not build steps.

- **Node 20+** and **pnpm** (or npm) installed.
- A **Supabase project**. Capture: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Install the Supabase CLI (`npm i -g supabase`) and run `supabase login`.
- A **Linear OAuth application** (Linear → Settings → API → OAuth applications). Capture `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`. Set redirect URL to `http://localhost:3000/api/connections/linear/callback`.
- An **Anthropic API key**: `ANTHROPIC_API_KEY`.
- A **32-byte encryption key** for token encryption: `TOKEN_ENC_KEY` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
- In Supabase Auth settings: enable **Google** provider (paste Google OAuth client id/secret) and enable **Email** (magic link). Set Site URL to `http://localhost:3000`.

All env vars live in `web/.env.local` (gitignored).

---

## File Structure

```
brief-cloud/
├── extension/                         # existing — modified
│   ├── manifest.json                  # + externally_connectable, + host_permissions
│   ├── background.js                  # + onMessageExternal pairing listener
│   ├── cloud.js                       # NEW — cloud client (token, upload, process)
│   ├── popup.js / popup.html          # + "Create ticket" CTA, connect status
│   └── settings.js / settings.html    # + "Connect to Brief Cloud" entry point
└── web/                               # NEW Next.js app
    ├── .env.local                     # secrets (gitignored)
    ├── package.json
    ├── supabase/
    │   └── migrations/
    │       └── 0001_init.sql          # profiles, connections, extension_tokens, briefs + RLS
    ├── lib/
    │   ├── crypto.ts                  # AES token encrypt/decrypt (pure, TDD)
    │   ├── tokens.ts                  # extension-token generate/hash/verify (pure, TDD)
    │   ├── brief.ts                   # parse brief.json → source_kind (pure, TDD)
    │   ├── supabase/server.ts         # server client (cookies, service role)
    │   ├── supabase/browser.ts        # browser client
    │   └── auth.ts                    # getUser() / requireUser() helpers
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                   # landing → redirect to /dashboard or /login
    │   ├── login/page.tsx             # Google + magic link
    │   ├── auth/callback/route.ts     # Supabase auth code exchange
    │   ├── dashboard/page.tsx         # connections + recent briefs
    │   ├── connect/page.tsx           # extension pairing page (pushes token)
    │   └── api/
    │       ├── connections/linear/route.ts          # start OAuth
    │       ├── connections/linear/callback/route.ts # OAuth callback → store token
    │       ├── extension-token/route.ts             # issue extension token (web session)
    │       ├── briefs/route.ts                       # POST create brief + signed upload URLs
    │       └── briefs/[id]/process/route.ts          # run agent, file ticket, delete media
    └── lib/agent/
        ├── system-prompt.ts           # ported SKILL.md + ticket.md rules
        └── process-brief.ts           # Agent SDK runner (Linear MCP + fs tools)
```

---

## Phase 0 — Scaffold

### Task 1: Scaffold the Next.js app

**Files:**
- Create: `web/` (Next.js project)

- [ ] **Step 1: Create the app**

Run from `brief-cloud/`:
```bash
npx create-next-app@latest web --typescript --tailwind --app --eslint --src-dir=false --import-alias="@/*" --no-turbopack
```
Accept defaults for any remaining prompts.

- [ ] **Step 2: Install dependencies**

```bash
cd web
pnpm add @supabase/supabase-js @supabase/ssr @anthropic-ai/claude-agent-sdk
pnpm add -D vitest
```

- [ ] **Step 3: Add the test script**

In `web/package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Verify the app boots**

Run: `pnpm dev`
Expected: dev server on `http://localhost:3000`, default Next page renders. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): scaffold Next.js app with supabase + agent sdk deps"
```

---

## Phase 1 — Pure logic (TDD)

### Task 2: Token encryption (`crypto.ts`)

**Files:**
- Create: `web/lib/crypto.ts`
- Test: `web/lib/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

`web/lib/crypto.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64"); // deterministic test key

describe("token crypto", () => {
  it("round-trips a value", () => {
    const cipher = encryptToken("lin_oauth_secret", KEY);
    expect(cipher).not.toContain("lin_oauth_secret");
    expect(decryptToken(cipher, KEY)).toBe("lin_oauth_secret");
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encryptToken("x", KEY)).not.toBe(encryptToken("x", KEY));
  });

  it("fails to decrypt with the wrong key", () => {
    const other = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptToken(encryptToken("x", KEY), other)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test crypto`
Expected: FAIL — `encryptToken` is not defined.

- [ ] **Step 3: Implement**

`web/lib/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM. Format: base64(iv).base64(authTag).base64(ciphertext)
export function encryptToken(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(payload: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test crypto`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/crypto.ts web/lib/crypto.test.ts
git commit -m "feat(web): AES-256-GCM token encryption"
```

---

### Task 3: Extension tokens (`tokens.ts`)

**Files:**
- Create: `web/lib/tokens.ts`
- Test: `web/lib/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

`web/lib/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateExtensionToken, hashToken, verifyToken } from "./tokens";

describe("extension tokens", () => {
  it("generates a prefixed, high-entropy token", () => {
    const t = generateExtensionToken();
    expect(t).toMatch(/^bxt_[A-Za-z0-9_-]{43}$/);
  });

  it("hash is stable and verifies", () => {
    const t = generateExtensionToken();
    const h = hashToken(t);
    expect(hashToken(t)).toBe(h);          // deterministic
    expect(verifyToken(t, h)).toBe(true);
    expect(verifyToken(t + "x", h)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tokens`
Expected: FAIL — `generateExtensionToken` not defined.

- [ ] **Step 3: Implement**

`web/lib/tokens.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from "crypto";

export function generateExtensionToken(): string {
  return "bxt_" + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyToken(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/tokens.ts web/lib/tokens.test.ts
git commit -m "feat(web): extension token generate/hash/verify"
```

---

### Task 4: Brief parsing (`brief.ts`)

**Files:**
- Create: `web/lib/brief.ts`
- Test: `web/lib/brief.test.ts`

- [ ] **Step 1: Write the failing test**

`web/lib/brief.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectSourceKind } from "./brief";

describe("detectSourceKind", () => {
  it("recording when keyframes/transcript present", () => {
    expect(detectSourceKind({ transcript: "hi", keyframeCount: 12 })).toBe("recording");
  });
  it("screenshot when only screenshot", () => {
    expect(detectSourceKind({ hasScreenshot: true })).toBe("screenshot");
  });
  it("text when only description", () => {
    expect(detectSourceKind({ description: "button broken" })).toBe("text");
  });
  it("mix when recording + screenshot", () => {
    expect(detectSourceKind({ keyframeCount: 5, hasScreenshot: true })).toBe("mix");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test brief`
Expected: FAIL — `detectSourceKind` not defined.

- [ ] **Step 3: Implement**

`web/lib/brief.ts`:
```ts
export type SourceKind = "recording" | "screenshot" | "text" | "mix";

export interface BriefMeta {
  transcript?: string;
  keyframeCount?: number;
  hasScreenshot?: boolean;
  description?: string;
}

export function detectSourceKind(b: BriefMeta): SourceKind {
  const hasRecording = !!(b.keyframeCount && b.keyframeCount > 0) || !!b.transcript;
  const hasShot = !!b.hasScreenshot;
  const hasText = !!(b.description && b.description.trim());
  const kinds = [hasRecording, hasShot, hasText].filter(Boolean).length;
  if (kinds > 1) return "mix";
  if (hasRecording) return "recording";
  if (hasShot) return "screenshot";
  return "text";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test brief`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/brief.ts web/lib/brief.test.ts
git commit -m "feat(web): brief source-kind detection"
```

---

## Phase 2 — Database

### Task 5: Supabase schema + RLS

**Files:**
- Create: `web/supabase/migrations/0001_init.sql`

- [ ] **Step 1: Init Supabase locally and link**

Run from `web/`:
```bash
supabase init
supabase link --project-ref <your-project-ref>
```

- [ ] **Step 2: Write the migration**

`web/supabase/migrations/0001_init.sql`:
```sql
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- auto-create profile on signup
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- connections
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('linear')),
  access_token text not null,        -- encrypted
  refresh_token text,                -- encrypted
  scope text,
  external_account_id text,
  external_account_name text,
  status text not null default 'active' check (status in ('active','broken')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, provider)
);
alter table public.connections enable row level security;
create policy "own connections" on public.connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- extension tokens
create table public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text,
  last_used_at timestamptz,
  created_at timestamptz default now(),
  revoked_at timestamptz
);
alter table public.extension_tokens enable row level security;
create policy "own tokens" on public.extension_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- briefs
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','filed','failed')),
  source_kind text check (source_kind in ('recording','screenshot','text','mix')),
  storage_prefix text not null,
  ticket_url text,
  ticket_identifier text,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.briefs enable row level security;
create policy "own briefs" on public.briefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db push`
Expected: migration applied; tables visible in the Supabase dashboard Table editor.

- [ ] **Step 4: Create the storage bucket**

In Supabase dashboard → Storage → New bucket: name `briefs`, **Private**. (Or `supabase storage` CLI.) Server access uses the service role key, so no extra storage RLS is required for v1.

- [ ] **Step 5: Commit**

```bash
git add web/supabase
git commit -m "feat(db): profiles, connections, extension_tokens, briefs + RLS"
```

---

## Phase 3 — Supabase clients & auth

### Task 6: Supabase client helpers

**Files:**
- Create: `web/lib/supabase/server.ts`, `web/lib/supabase/browser.ts`, `web/lib/auth.ts`

- [ ] **Step 1: Browser client**

`web/lib/supabase/browser.ts`:
```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Server client (cookie-bound, for user session)**

`web/lib/supabase/server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createAdmin } from "@supabase/supabase-js";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          ),
      },
    }
  );
}

// Service-role client — bypasses RLS. Use only in API routes after auth checks.
export function createAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

- [ ] **Step 3: Auth helpers**

`web/lib/auth.ts`:
```ts
import { redirect } from "next/navigation";
import { createServerSupabase } from "./supabase/server";

export async function getUser() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `pnpm build` (or `npx tsc --noEmit`)
Expected: no type errors in these files.

- [ ] **Step 5: Commit**

```bash
git add web/lib/supabase web/lib/auth.ts
git commit -m "feat(web): supabase server/browser clients + auth helpers"
```

---

### Task 7: Login page + auth callback (Google + magic link)

**Files:**
- Create: `web/app/login/page.tsx`, `web/app/auth/callback/route.ts`

- [ ] **Step 1: Login page**

`web/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function Login() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>✦ Brief Cloud</h1>
      <button
        onClick={() =>
          supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: `${origin}/auth/callback` },
          })
        }
      >
        Sign in with Google
      </button>
      <hr />
      {sent ? (
        <p>Check your email for a magic link.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await supabase.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: `${origin}/auth/callback` },
            });
            setSent(true);
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
          <button type="submit">Send magic link</button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Auth callback route**

`web/app/auth/callback/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
```

- [ ] **Step 3: Manual verification**

Run `pnpm dev`. Visit `http://localhost:3000/login`.
- Click "Sign in with Google" → complete consent → land on `/dashboard` (will 404 until Task 11; that's fine — confirm the URL is `/dashboard` and a session cookie is set).
- Enter your email, "Send magic link" → click the email link → also lands on `/dashboard`.

Expected: a Supabase session cookie exists (DevTools → Application → Cookies → `sb-...`).

- [ ] **Step 4: Commit**

```bash
git add web/app/login web/app/auth
git commit -m "feat(web): login (google + magic link) and auth callback"
```

---

## Phase 4 — Linear OAuth

### Task 8: Linear OAuth connect + callback

**Files:**
- Create: `web/app/api/connections/linear/route.ts`, `web/app/api/connections/linear/callback/route.ts`

Linear OAuth endpoints: authorize `https://linear.app/oauth/authorize`, token `https://api.linear.app/oauth/token`. Scope `read,write` (issues create). We store the access token encrypted.

- [ ] **Step 1: Start-OAuth route**

`web/app/api/connections/linear/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

export async function GET() {
  await requireUser(); // must be signed in
  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID!,
    redirect_uri: `${process.env.APP_URL}/api/connections/linear/callback`,
    response_type: "code",
    scope: "read,write",
    state: "linear", // CSRF token could be added in a later phase
  });
  return NextResponse.redirect(
    `https://linear.app/oauth/authorize?${params.toString()}`
  );
}
```
(Add `APP_URL=http://localhost:3000` to `.env.local`.)

- [ ] **Step 2: Callback route — exchange code, store encrypted token**

`web/app/api/connections/linear/callback/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  const user = await requireUser();
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${process.env.APP_URL}/dashboard?error=linear`);

  const tokenRes = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.LINEAR_CLIENT_ID!,
      client_secret: process.env.LINEAR_CLIENT_SECRET!,
      redirect_uri: `${process.env.APP_URL}/api/connections/linear/callback`,
      grant_type: "authorization_code",
      code,
    }),
  });
  const tok = await tokenRes.json(); // { access_token, scope, ... }

  // fetch workspace name for display
  let name: string | null = null;
  try {
    const me = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: tok.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ organization { id name } }" }),
    }).then((r) => r.json());
    name = me?.data?.organization?.name ?? null;
  } catch {}

  const admin = createAdminSupabase();
  await admin.from("connections").upsert(
    {
      user_id: user.id,
      provider: "linear",
      access_token: encryptToken(tok.access_token, process.env.TOKEN_ENC_KEY!),
      scope: tok.scope ?? "read,write",
      external_account_name: name,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  return NextResponse.redirect(`${process.env.APP_URL}/dashboard?connected=linear`);
}
```

- [ ] **Step 3: Manual verification**

With `pnpm dev` running and signed in, visit `http://localhost:3000/api/connections/linear`.
Complete Linear consent. Expected: redirect to `/dashboard?connected=linear`, and a `connections` row exists (Supabase Table editor) with provider `linear`, a non-plaintext `access_token`, and `status=active`.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/connections
git commit -m "feat(web): Linear OAuth connect + encrypted token storage"
```

---

## Phase 5 — Extension token issuance & pairing

### Task 9: Issue extension token (web session)

**Files:**
- Create: `web/app/api/extension-token/route.ts`

- [ ] **Step 1: Implement issue route**

`web/app/api/extension-token/route.ts`:
```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { generateExtensionToken, hashToken } from "@/lib/tokens";

export async function POST() {
  const user = await requireUser();
  const token = generateExtensionToken();
  const admin = createAdminSupabase();
  const { error } = await admin.from("extension_tokens").insert({
    user_id: user.id,
    token_hash: hashToken(token),
    label: "chrome-extension",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // returned once, never stored in plaintext server-side
  return NextResponse.json({ token });
}
```

- [ ] **Step 2: Manual verification**

Signed in, run in the browser console at `localhost:3000`:
```js
await fetch("/api/extension-token", { method: "POST" }).then(r => r.json());
```
Expected: `{ token: "bxt_..." }`, and a new `extension_tokens` row (hash only).

- [ ] **Step 3: Commit**

```bash
git add web/app/api/extension-token
git commit -m "feat(web): issue revocable extension tokens"
```

---

### Task 10: Pairing page (pushes token to the extension)

**Files:**
- Create: `web/app/connect/page.tsx`

The extension opens `/connect?ext=<EXTENSION_ID>`. After sign-in, the page issues a token and pushes it to the extension via `chrome.runtime.sendMessage`.

- [ ] **Step 1: Implement the connect page**

`web/app/connect/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

export default function Connect() {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");

  useEffect(() => {
    const extId = new URLSearchParams(window.location.search).get("ext");
    (async () => {
      try {
        const res = await fetch("/api/extension-token", { method: "POST" });
        if (res.status === 401) { window.location.href = "/login?next=/connect" + window.location.search; return; }
        const { token } = await res.json();
        // @ts-ignore - chrome present on the page when extension installed
        chrome.runtime.sendMessage(extId, { type: "brief-cloud-token", token }, () => {
          setState("ok");
        });
      } catch {
        setState("err");
      }
    })();
  }, []);

  return (
    <main style={{ maxWidth: 420, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>✦ Connecting Brief</h1>
      {state === "ok" && <p>Connected. You can close this tab and return to the extension.</p>}
      {state === "err" && <p>Couldn’t reach the extension. Make sure Brief is installed and try again.</p>}
      {state === "idle" && <p>Pairing…</p>}
    </main>
  );
}
```

- [ ] **Step 2: Verification deferred**

This page is verified end-to-end in Task 14 (after the extension listener exists). For now confirm it renders at `/connect?ext=test` without crashing (it will show the error state since no extension answers — acceptable).

- [ ] **Step 3: Commit**

```bash
git add web/app/connect
git commit -m "feat(web): extension pairing page"
```

---

## Phase 6 — Briefs API & processing agent

### Task 11: Bearer auth helper for the extension API

**Files:**
- Create: `web/lib/extauth.ts`
- Test: `web/lib/extauth.test.ts`

- [ ] **Step 1: Write the failing test (hash matching is the testable unit)**

`web/lib/extauth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bearerFromHeader } from "./extauth";

describe("bearerFromHeader", () => {
  it("extracts the token", () => {
    expect(bearerFromHeader("Bearer bxt_abc")).toBe("bxt_abc");
  });
  it("returns null when missing/malformed", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("Basic xyz")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test extauth`
Expected: FAIL — `bearerFromHeader` not defined.

- [ ] **Step 3: Implement**

`web/lib/extauth.ts`:
```ts
import { createAdminSupabase } from "./supabase/server";
import { hashToken } from "./tokens";

export function bearerFromHeader(h: string | null): string | null {
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice("Bearer ".length).trim() || null;
}

// Returns the user_id for a valid, non-revoked extension token, else null.
export async function userIdForToken(token: string): Promise<string | null> {
  const admin = createAdminSupabase();
  const { data } = await admin
    .from("extension_tokens")
    .select("user_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  await admin
    .from("extension_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token));
  return data.user_id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test extauth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/extauth.ts web/lib/extauth.test.ts
git commit -m "feat(web): bearer extraction + extension-token auth lookup"
```

---

### Task 12: Create-brief route (signed upload URLs)

**Files:**
- Create: `web/app/api/briefs/route.ts`

The extension POSTs the list of files it wants to upload + brief metadata. We create the `briefs` row and return signed upload URLs (one per file) under `{userId}/{briefId}/`.

- [ ] **Step 1: Implement**

`web/app/api/briefs/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { detectSourceKind } from "@/lib/brief";

export async function POST(req: NextRequest) {
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json(); // { meta: BriefMeta, files: string[] }
  const admin = createAdminSupabase();
  const sourceKind = detectSourceKind(body.meta ?? {});

  const { data: brief, error } = await admin
    .from("briefs")
    .insert({ user_id: userId, status: "uploaded", source_kind: sourceKind, storage_prefix: "pending" })
    .select("id")
    .single();
  if (error || !brief) return NextResponse.json({ error: error?.message }, { status: 500 });

  const prefix = `${userId}/${brief.id}`;
  await admin.from("briefs").update({ storage_prefix: prefix }).eq("id", brief.id);

  const uploads: Record<string, { path: string; token: string }> = {};
  for (const file of body.files as string[]) {
    const path = `${prefix}/${file}`;
    const { data, error: e } = await admin.storage
      .from("briefs")
      .createSignedUploadUrl(path);
    if (e || !data) return NextResponse.json({ error: e?.message }, { status: 500 });
    uploads[file] = { path, token: data.token };
  }

  return NextResponse.json({ briefId: brief.id, uploads });
}
```

- [ ] **Step 2: Manual verification (curl with a real token)**

```bash
curl -s -X POST http://localhost:3000/api/briefs \
  -H "Authorization: Bearer <token-from-task-9>" \
  -H "Content-Type: application/json" \
  -d '{"meta":{"keyframeCount":3,"transcript":"x"},"files":["brief.json","keyframes/keyframe-000.png"]}'
```
Expected: JSON with `briefId` and `uploads` map containing a `path` + `token` per file; a `briefs` row with `status=uploaded`, `source_kind=recording`.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/briefs/route.ts
git commit -m "feat(web): create-brief endpoint with signed upload URLs"
```

---

### Task 13: Agent system prompt (port the skill)

**Files:**
- Create: `web/lib/agent/system-prompt.ts`

- [ ] **Step 1: Port SKILL.md + ticket.md into a prompt constant**

`web/lib/agent/system-prompt.ts`:
```ts
// Server-side port of extension/skill/SKILL.md + playbooks/ticket.md.
// The agent reads the brief from a local working dir and files ONE ticket via the Linear MCP.
export const SYSTEM_PROMPT = `
You turn a captured "brief" into exactly one Linear ticket, then stop.

The brief lives in your working directory:
- brief.json — transcript, time-stamped chunks, events, console errors, description, flags
- keyframes/keyframe-*.png — frames sampled every ~2s (recording briefs)
- recording.webm — original screen+voice (only attach if it beats the keyframes)
- screenshot.png — annotated screenshot; RED markings are the user pointing at the issue

Rules:
1. Read brief.json FIRST. Use whatever is present (recording / screenshot / text / mix). Never assume a recording exists.
2. Binary-search keyframes: read 3-5 strategic frames (first, midpoint, last; more only if needed), not all.
3. Map transcript chunks to keyframes by timestamp (±2000ms). Treat the transcript as a DRAFT — Chrome speech recognition is mediocre; keyframes + page context are ground truth. Silently correct obvious mis-transcriptions.
4. Infer the Linear team yourself (page URL, workspace, recent activity). NEVER ask the user anything. Decide every judgment call.
5. The ticket must read like a teammate wrote it from scratch: describe the bug/feature and show evidence. Embed images INLINE as markdown so it reads end-to-end without clicking attachments.
6. BANNED vocabulary anywhere in title/description/captions: "brief"/"briefs", brief IDs, "recording"/"captured"/"capture" (tool sense), "transcript"/"voice"/"narrated"/"the user said", "keyframe"/"Frame at 0:02"/media timestamps, file paths/names, "in the recording"/"as shown in the video". Captions describe what's IN the image, not what was said.
7. Narrate each step in one short declarative line as you go. Statements, never questions.
8. When done, output ONLY a JSON object on the final line: {"ticketUrl": "...", "ticketIdentifier": "ABC-123", "summary": "one line"}.
`.trim();
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/agent/system-prompt.ts
git commit -m "feat(agent): server-side filing system prompt"
```

---

### Task 14: Process-brief runner (Agent SDK + Linear MCP)

**Files:**
- Create: `web/lib/agent/process-brief.ts`

- [ ] **Step 1: Implement the runner**

`web/lib/agent/process-brief.ts`:
```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "./system-prompt";

export interface FileResult {
  ticketUrl: string;
  ticketIdentifier: string;
  summary: string;
}

// workingDir already contains brief.json + keyframes/ + optional recording/screenshot.
// linearToken is the user's decrypted OAuth access token.
export async function processBrief(
  workingDir: string,
  linearToken: string
): Promise<FileResult> {
  let last = "";
  for await (const msg of query({
    prompt:
      "Read the brief in the working directory and file exactly one Linear ticket. End with the JSON result line.",
    options: {
      cwd: workingDir,
      systemPrompt: SYSTEM_PROMPT,
      model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Glob", "Grep"],
      mcpServers: {
        linear: {
          type: "sse",
          url: "https://mcp.linear.app/sse",
          headers: { Authorization: `Bearer ${linearToken}` },
        },
      },
    },
  })) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") last += block.text;
      }
    }
  }

  const match = last.match(/\{[^{}]*"ticketUrl"[\s\S]*\}/);
  if (!match) throw new Error("agent did not return a ticket result");
  return JSON.parse(match[0]) as FileResult;
}
```

> **Note for the implementer:** verify the exact `@anthropic-ai/claude-agent-sdk` `query` option names against the installed version's types (`node_modules/@anthropic-ai/claude-agent-sdk`). The shape above (`cwd`, `systemPrompt`, `mcpServers`, `allowedTools`, `permissionMode`) matches the current SDK; adjust property names if the installed version differs. The MCP transport key for a remote SSE server is `type: "sse"` with `url` + `headers`.

- [ ] **Step 2: Commit**

```bash
git add web/lib/agent/process-brief.ts
git commit -m "feat(agent): brief processing runner with Linear remote MCP"
```

---

### Task 15: Process route (download media, run agent, file, delete)

**Files:**
- Create: `web/app/api/briefs/[id]/process/route.ts`

- [ ] **Step 1: Implement**

`web/app/api/briefs/[id]/process/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { bearerFromHeader, userIdForToken } from "@/lib/extauth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto";
import { processBrief } from "@/lib/agent/process-brief";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";

export const maxDuration = 300; // allow long agent runs where the platform supports it

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const token = bearerFromHeader(req.headers.get("authorization"));
  const userId = token ? await userIdForToken(token) : null;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();
  const { data: brief } = await admin
    .from("briefs").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!brief) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: conn } = await admin
    .from("connections").select("*").eq("user_id", userId).eq("provider", "linear").maybeSingle();
  if (!conn || conn.status !== "active")
    return NextResponse.json({ error: "linear not connected" }, { status: 409 });

  await admin.from("briefs").update({ status: "processing" }).eq("id", id);

  const work = await mkdtemp(join(tmpdir(), "brief-"));
  try {
    // download every object under the prefix into the working dir
    const { data: list } = await admin.storage.from("briefs").list(brief.storage_prefix, { limit: 100 });
    for (const obj of list ?? []) {
      const rel = obj.name;
      const { data: blob } = await admin.storage
        .from("briefs").download(`${brief.storage_prefix}/${rel}`);
      if (!blob) continue;
      const dest = join(work, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await blob.arrayBuffer()));
    }
    // keyframes live in a subfolder; list them too
    const { data: kf } = await admin.storage.from("briefs").list(`${brief.storage_prefix}/keyframes`, { limit: 200 });
    for (const obj of kf ?? []) {
      const { data: blob } = await admin.storage
        .from("briefs").download(`${brief.storage_prefix}/keyframes/${obj.name}`);
      if (!blob) continue;
      const dest = join(work, "keyframes", obj.name);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await blob.arrayBuffer()));
    }

    const linearToken = decryptToken(conn.access_token, process.env.TOKEN_ENC_KEY!);
    const result = await processBrief(work, linearToken);

    await admin.from("briefs").update({
      status: "filed",
      ticket_url: result.ticketUrl,
      ticket_identifier: result.ticketIdentifier,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    // delete media on success (keep the row)
    const all = [
      ...(list ?? []).map((o) => `${brief.storage_prefix}/${o.name}`),
      ...(kf ?? []).map((o) => `${brief.storage_prefix}/keyframes/${o.name}`),
    ];
    if (all.length) await admin.storage.from("briefs").remove(all);

    return NextResponse.json(result);
  } catch (e: any) {
    await admin.from("briefs").update({ status: "failed", error: String(e?.message ?? e) }).eq("id", id);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

- [ ] **Step 2: Integration verification (real Linear sandbox)**

Prep a fixture brief by uploading via curl (signed URLs from Task 12) — at minimum a `brief.json` like:
```json
{ "description": "The Pay button on /checkout does nothing when clicked.", "keyframeCount": 0 }
```
Then:
```bash
curl -s -X POST http://localhost:3000/api/briefs/<briefId>/process \
  -H "Authorization: Bearer <token>"
```
Expected: JSON `{ ticketUrl, ticketIdentifier, summary }`; a real issue appears in your Linear test workspace; the `briefs` row is `status=filed` with the ticket URL; storage objects under the prefix are gone.

- [ ] **Step 3: Commit**

```bash
git add "web/app/api/briefs/[id]/process/route.ts"
git commit -m "feat(web): process route — download, agent-file, delete media"
```

---

## Phase 7 — Dashboard

### Task 16: Dashboard (connection status + recent briefs)

**Files:**
- Create: `web/app/dashboard/page.tsx`, `web/app/page.tsx`

- [ ] **Step 1: Root redirect**

`web/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/login");
}
```

- [ ] **Step 2: Dashboard (server component)**

`web/app/dashboard/page.tsx`:
```tsx
import { requireUser } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";

export default async function Dashboard() {
  const user = await requireUser();
  const admin = createAdminSupabase();
  const { data: conn } = await admin
    .from("connections").select("*").eq("user_id", user.id).eq("provider", "linear").maybeSingle();
  const { data: briefs } = await admin
    .from("briefs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);

  return (
    <main style={{ maxWidth: 720, margin: "6vh auto", fontFamily: "system-ui" }}>
      <h1>✦ Brief Cloud</h1>
      <section>
        <h2>Linear</h2>
        {conn?.status === "active" ? (
          <p>Connected to <b>{conn.external_account_name ?? "your workspace"}</b>.</p>
        ) : (
          <a href="/api/connections/linear">Connect Linear →</a>
        )}
      </section>
      <section>
        <h2>Recent briefs</h2>
        <ul>
          {(briefs ?? []).map((b) => (
            <li key={b.id}>
              <code>{b.status}</code> · {b.source_kind ?? "?"} ·{" "}
              {b.ticket_url ? <a href={b.ticket_url}>{b.ticket_identifier}</a> : (b.error ?? "—")}
            </li>
          ))}
          {(briefs ?? []).length === 0 && <li>No briefs yet.</li>}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

Signed in with a connected Linear and at least one filed brief, visit `/dashboard`.
Expected: "Connected to <workspace>", and the filed brief listed with a clickable Linear identifier.

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx web/app/dashboard
git commit -m "feat(web): dashboard with connection status + recent briefs"
```

---

## Phase 8 — Extension changes

### Task 17: Manifest — pairing + network permissions

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Add `externally_connectable` and host permission**

Add these top-level keys to `extension/manifest.json` (keep existing keys):
```json
"externally_connectable": {
  "matches": ["http://localhost:3000/*", "https://app.get-brief.app/*"]
},
```
And add the app origins to `host_permissions` (merge with existing `<all_urls>` — already broad, so no change strictly needed, but add explicit entries for clarity):
```json
"host_permissions": ["<all_urls>"]
```

- [ ] **Step 2: Verify the extension still loads**

Load `extension/` unpacked at `chrome://extensions`. Expected: no manifest errors. Note the extension ID shown.

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "feat(ext): externally_connectable for cloud pairing"
```

---

### Task 18: Cloud client module

**Files:**
- Create: `extension/cloud.js`

- [ ] **Step 1: Implement the client**

`extension/cloud.js`:
```js
// Brief Cloud client — token storage, pairing, upload, process.
const APP_URL = "http://localhost:3000"; // swap to https://app.get-brief.app for prod

export async function getCloudToken() {
  const { briefCloudToken } = await chrome.storage.local.get("briefCloudToken");
  return briefCloudToken || null;
}

export async function setCloudToken(token) {
  await chrome.storage.local.set({ briefCloudToken: token });
}

export function openConnectPage() {
  chrome.tabs.create({ url: `${APP_URL}/connect?ext=${chrome.runtime.id}` });
}

// files: { name: string, blob: Blob }[] ; meta: BriefMeta
export async function uploadAndProcess(files, meta) {
  const token = await getCloudToken();
  if (!token) throw new Error("not connected to Brief Cloud");

  const create = await fetch(`${APP_URL}/api/briefs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ meta, files: files.map((f) => f.name) }),
  }).then((r) => r.json());

  // upload each file to its signed URL
  for (const f of files) {
    const up = create.uploads[f.name];
    await fetch(`${APP_URL}/storage/v1/object/upload/sign/briefs/${up.path}?token=${up.token}`, {
      method: "PUT",
      body: f.blob,
    });
  }

  return fetch(`${APP_URL}/api/briefs/${create.briefId}/process`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
}
```

> **Note:** the signed-upload PUT URL format depends on Supabase Storage. The simplest robust path is to use `@supabase/supabase-js` in the extension with `uploadToSignedUrl(path, token, blob)`. If you prefer no SDK in the extension, confirm the exact signed-upload URL shape from the Supabase Storage docs and adjust the PUT above. Keep this isolated in `cloud.js` so it's the only place that knows the upload wire format.

- [ ] **Step 2: Commit**

```bash
git add extension/cloud.js
git commit -m "feat(ext): cloud client (token, pairing, upload, process)"
```

---

### Task 19: Background pairing listener

**Files:**
- Modify: `extension/background.js`

- [ ] **Step 1: Add the external-message listener**

Append to `extension/background.js`:
```js
// Receive the cloud token from the Brief Cloud web app (externally_connectable).
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "brief-cloud-token" && typeof msg.token === "string") {
    chrome.storage.local.set({ briefCloudToken: msg.token }, () => sendResponse({ ok: true }));
    return true; // async response
  }
});
```

- [ ] **Step 2: Manual verification (closes the pairing loop)**

Reload the extension. From the extension, trigger `openConnectPage()` (temporarily wire a button, or run `chrome.tabs.create({url: APP_URL + '/connect?ext=' + chrome.runtime.id})` in the service-worker console). Sign in on the page. Expected: the `/connect` page shows "Connected", and `chrome.storage.local.get('briefCloudToken')` (run in the SW console) returns the token.

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(ext): store cloud token via onMessageExternal"
```

---

### Task 20: Popup — "Create ticket" CTA with export fallback

**Files:**
- Modify: `extension/popup.html`, `extension/popup.js`

This task wires the existing brief data (the same payload the current export builds) into `uploadAndProcess`, and swaps the primary button based on connection state. Because the exact current export code lives in `popup.js`/`background.js`, the implementer must first locate where a brief's files (brief.json, keyframes, recording, screenshot) are assembled for export.

- [ ] **Step 1: Locate the export assembly**

Search the extension for where the brief zip/files are built:
```bash
grep -rn "brief.json\|recording.webm\|keyframe\|createSignedUploadUrl\|zip" extension/*.js
```
Identify the function that gathers the brief's files as Blobs and its `meta`.

- [ ] **Step 2: Add a "Create ticket" button to the popup**

In `extension/popup.html`, add next to the existing export control:
```html
<button id="create-ticket" hidden>Create ticket</button>
<span id="cloud-status"></span>
```

- [ ] **Step 3: Wire connection state + click handler**

In `extension/popup.js` (top-level, module context), import the client and toggle UI:
```js
import { getCloudToken, openConnectPage, uploadAndProcess } from "./cloud.js";

const createBtn = document.getElementById("create-ticket");
const statusEl = document.getElementById("cloud-status");

(async () => {
  const token = await getCloudToken();
  if (token) {
    createBtn.hidden = false; // primary path when connected
  } else {
    statusEl.innerHTML = `<a href="#" id="connect">Connect to Brief Cloud</a>`;
    document.getElementById("connect")?.addEventListener("click", (e) => {
      e.preventDefault();
      openConnectPage();
    });
  }
})();

createBtn?.addEventListener("click", async () => {
  createBtn.disabled = true;
  statusEl.textContent = "Creating ticket…";
  try {
    // gatherBriefFiles() / gatherBriefMeta() = the functions found in Step 1.
    const files = await gatherBriefFiles();   // [{ name, blob }]
    const meta = await gatherBriefMeta();      // { transcript, keyframeCount, hasScreenshot, description }
    const res = await uploadAndProcess(files, meta);
    statusEl.innerHTML = res.ticketUrl
      ? `Ticket created → <a href="${res.ticketUrl}" target="_blank">${res.ticketIdentifier}</a>`
      : `Failed: ${res.error ?? "unknown error"}`;
  } catch (e) {
    statusEl.textContent = "Failed: " + e.message;
  } finally {
    createBtn.disabled = false;
  }
});
```

> If `popup.js` is not already an ES module, either add `type="module"` to its `<script>` tag in `popup.html`, or inline the `cloud.js` functions. Keep the existing **Export** button untouched so the local flow remains the fallback when not connected.

- [ ] **Step 4: End-to-end verification**

With the web app running, Linear connected, and the extension paired: record a brief, open the popup, click **Create ticket**. Expected: "Creating ticket…" then "Ticket created → ABC-123" linking to a real Linear issue; `/dashboard` shows the brief as `filed`; storage media deleted. Disconnect (clear `briefCloudToken`) and confirm the **Export** button still works (fallback intact).

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(ext): Create ticket CTA with local export fallback"
```

---

## Final verification checklist

- [ ] `pnpm test` in `web/` passes (crypto, tokens, brief, extauth).
- [ ] Sign in via Google **and** magic link both reach `/dashboard`.
- [ ] Connect Linear stores an encrypted token; dashboard shows the workspace name.
- [ ] Extension pairs and stores a token via the connect page.
- [ ] Recording a brief + "Create ticket" files a real Linear issue with an inline image.
- [ ] On success the `briefs` row is `filed` and storage media is deleted.
- [ ] On failure the row is `failed`, media retained, error visible on the dashboard.
- [ ] Not-connected extension still falls back to local Export.

---

## Notes carried from the spec (out of scope for v1)

Jira & other trackers · brief/media retention & history · billing · team accounts · queue/worker scaling for long briefs · retry-UI polish · server-side banned-word/quality post-check. CSRF `state` validation on the Linear OAuth flow is a fast follow.
