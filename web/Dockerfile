# syntax=docker/dockerfile:1

# ---- deps: install with the lockfile ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- migrate: applies supabase/migrations and creates the storage bucket ----
# docker compose runs this once before the app starts (docker-compose.yml).
FROM deps AS migrate
COPY scripts/migrate.mjs scripts/ensure-bucket.mjs ./scripts/
COPY supabase ./supabase
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/ensure-bucket.mjs"]

# ---- builder: produce the standalone server ----
FROM node:26-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* are inlined at build time, so they must be present here (passed
# as --build-arg / compose build.args / fly.toml [build.args], NOT runtime secrets).
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
# Which Clerk strategy backs each tracker. Empty = Clerk's built-in
# connection; oauth_custom_<slug> uses a custom connector, which is the only
# way to request scopes like GitHub's `repo`. See lib/clerk-strategies.ts.
ARG NEXT_PUBLIC_GITHUB_CLERK_STRATEGY=
ARG NEXT_PUBLIC_LINEAR_CLERK_STRATEGY=
ARG NEXT_PUBLIC_JIRA_CLERK_STRATEGY=
# The extension's id, so the app pairs it without a click. Empty = the Web Store build.
ARG NEXT_PUBLIC_EXTENSION_ID=
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL \
    NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL \
    NEXT_PUBLIC_GITHUB_CLERK_STRATEGY=$NEXT_PUBLIC_GITHUB_CLERK_STRATEGY \
    NEXT_PUBLIC_LINEAR_CLERK_STRATEGY=$NEXT_PUBLIC_LINEAR_CLERK_STRATEGY \
    NEXT_PUBLIC_JIRA_CLERK_STRATEGY=$NEXT_PUBLIC_JIRA_CLERK_STRATEGY \
    NEXT_PUBLIC_EXTENSION_ID=$NEXT_PUBLIC_EXTENSION_ID \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: slim runtime ----
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# Standalone output doesn't include public/ or .next/static — copy them in.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
