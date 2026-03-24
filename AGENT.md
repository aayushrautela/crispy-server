# Agent Notes

This repository is easy to misread if you only scan env vars. Read this first before making architecture changes, writing docs, or answering questions about the stack.

## Non-negotiable architecture facts

- This repo is a backend server, not a Supabase-native app.
- Supabase is used for auth only:
  - bearer JWT issuer and JWKS discovery
  - optional auth admin API for deleting upstream auth users
- Supabase is not used here for:
  - the application database
  - business data storage
  - RLS or policy enforcement
  - Storage buckets
  - Edge Functions
  - Realtime infrastructure
- All core application logic and data live on our own server:
  - Fastify API
  - BullMQ worker
  - Postgres accessed directly with `pg`
  - Redis accessed directly with `ioredis`

## Auth model

- User auth: bearer JWTs are verified against a remote JWKS, then the backend upserts a local app user from the auth subject.
- Personal access tokens: local `cp_pat_...` tokens issued and validated by this server.
- Service-to-service auth: internal callers send `x-service-id` and `x-api-key`; permissions come from `SERVICE_CLIENTS_JSON`.

## Runtime shape

- `src/bin/api.ts` starts the HTTP API.
- `src/bin/worker.ts` starts the background worker.
- `docker-compose.yml` runs `api`, `worker`, `postgres`, and `redis`.
- `migrations/` defines the local Postgres schema.

## Main product areas

- users, households, profiles, and account deletion
- watch ingestion, projections, history, and state
- home and calendar surfaces
- TMDB-backed metadata lookups and refreshes
- provider imports and token refresh flows for Trakt and Simkl
- recommendation data, outputs, and work leasing
- AI search and AI insights

## Source-of-truth files

- `src/config/env.ts` - auth env aliases and local infra configuration
- `src/lib/db.ts` - direct Postgres access
- `src/lib/jwks.ts` - remote JWT verification
- `src/http/plugins/auth.ts` - user JWT and PAT auth flow
- `src/http/plugins/service-auth.ts` - internal scoped service auth
- `src/modules/auth/external-auth-admin.service.ts` - optional upstream auth user deletion
- `src/modules/users/user.service.ts` - local app-user bootstrap from auth subject
- `docker-compose.yml` - local runtime topology
- `DEPLOY.md` - deployment and hosted service auth notes

## Writing guidance for AI agents

- Do not describe this system as using Supabase for the app database.
- Do not assume Supabase tables, Storage, RLS, Edge Functions, or Realtime are part of this repo.
- When explaining data flow, say application data is stored in Postgres on our server.
- When explaining background work or caching, say Redis and BullMQ run on our server.
- If you see Supabase mentioned in env values, treat it as the current external auth provider, not proof that app data lives in Supabase.
- Prefer the phrase "external auth provider" in new high-level docs when possible, but preserve existing env var names and code behavior unless a task explicitly asks for renaming.
- When answering architecture questions, verify claims against the source-of-truth files above.
