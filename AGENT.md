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
- The signed-in account is the only auth actor and the ownership root.
- Email is an account lookup attribute at the product boundary; the durable internal ownership key remains the local app-user id.
- Profiles are child personas under one account, not standalone users.
- One account token covers all profiles owned by that account; profiles do not have separate credentials.
- Profiles do not have separate logins, PATs, service credentials, or account-shared secrets.
- Shared account-scoped data includes addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
- Profile-scoped personal data includes profile settings, watch state/history, provider connections, imports, taste profiles, and recommendations.
- Trakt and Simkl are per-profile, not account-scoped.
- Older ownership plumbing in code is an implementation detail slated for cleanup, not the intended product contract.

## Endpoint model

- Public health route: `GET /healthz`.
- User routes live under `/v1/...`.
- Internal privileged routes live under `/internal/v1/...`.
- Do not guess route shapes from old discussions; verify them against `src/http/app.ts` and `src/http/routes/*.ts`.
- The README contains a maintained endpoint map and should stay in sync with the route files.
- Do not reintroduce legacy profile-only internal compatibility routes; privileged integrations should use `/internal/v1/accounts/...`.
- Human admin and orchestration UI belongs on the API server control plane, not on the recommendation worker.
- Recommendation generation is server-orchestrated: the API server owns user-data loading, AI credential resolution, orchestration, and persistence; the recommendation worker owns recommendation generation and taste-profile computation.
- The recommendation worker may perform read-only TMDB/TVDB/Kitsu catalog or discovery fetches for enrichment, but it must not fetch user/business data or write application storage.
- Recommendation outputs should use final canonical identities: `movie:tmdb:*`, `show:tvdb:*`, and `anime:kitsu:*`, with `mediaKey`, `mediaType`, `provider`, and `providerId` present on every recommendation item.
- Profile-targeted user routes use explicit `:profileId` path params.
- Do not reintroduce header-based or body-based profile targeting fallbacks.

## Runtime shape

- `src/bin/api.ts` starts the HTTP API.
- `src/bin/worker.ts` starts the background worker.
- `docker-compose.yml` runs `api`, `worker`, `postgres`, and `redis`.
- `migrations/` defines the local Postgres schema.

## Main product areas

- accounts, profiles, and account deletion
- watch ingestion, projections, history, and state
- home and calendar surfaces
- TMDB-backed metadata lookups and refreshes
- provider imports and token refresh flows for Trakt and Simkl
- recommendation data, outputs, and work leasing
- AI search and AI insights

## Source-of-truth files

- `config/app-config.json` - editable runtime defaults and AI provider policy
- `src/config/app-config.ts` - config loader and validation
- `src/config/env.ts` - auth env and local infra configuration
- `src/lib/db.ts` - direct Postgres access
- `src/lib/jwks.ts` - remote JWT verification
- `src/http/app.ts` - registered route surface
- `src/http/routes/` - actual endpoint definitions
- `src/http/plugins/auth.ts` - user JWT and PAT auth flow
- `src/http/plugins/service-auth.ts` - internal scoped service auth
- `src/modules/auth/external-auth-admin.service.ts` - optional upstream auth user deletion
- `src/modules/users/user.service.ts` - local app-user bootstrap from auth subject
- `src/modules/users/account-settings.service.ts` - account-shared settings and secrets
- `docker-compose.yml` - local runtime topology
- `DEPLOY.md` - deployment and hosted service auth notes

## Writing guidance for AI agents

- Do not describe this system as using Supabase for the app database.
- Do not assume Supabase tables, Storage, RLS, Edge Functions, or Realtime are part of this repo.
- When explaining data flow, say application data is stored in Postgres on our server.
- When explaining background work or caching, say Redis and BullMQ run on our server.
- If you see Supabase mentioned in env values, treat it as the current external auth provider, not proof that app data lives in Supabase.
- Do not claim profiles have separate auth credentials; they are targets under an authenticated account.
- Do not move Trakt or Simkl to account scope when discussing current product rules.
- If documenting endpoints, prefer exhaustive grouped lists over vague summaries.
- Prefer the phrase "external auth provider" in new high-level docs when possible, but preserve existing env var names and code behavior unless a task explicitly asks for renaming.
- When answering architecture questions, verify claims against the source-of-truth files above.
