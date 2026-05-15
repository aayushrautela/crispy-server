# Agent Notes

This repository is easy to misread if you only scan env vars. Read this first before making architecture changes, writing docs, or answering questions about the stack.

## Code quality constraints

- Keep changes simple: follow KISS, DRY, and YAGNI.
- Refactor existing logic instead of layering new code over old paths.
- Delete obsolete, unused, or commented-out code when it becomes irrelevant.
- Keep functions small, focused, and single-purpose.
- Avoid premature abstraction; solve the current problem first.
- Prefer self-documenting names over comments; only comment to explain why.
- Reuse existing utilities and patterns before adding new ones.

## Non-negotiable architecture facts

- This repo is a backend server, not a Supabase-native client app.
- Supabase Auth is the external identity/session provider:
  - clients may use Supabase Auth directly for login/session
  - Fastify verifies bearer JWTs through Supabase issuer/JWKS discovery
  - Fastify may use the upstream auth admin API for deleting Supabase auth users
- Supabase Postgres/RPC/RLS is the store and authorization substrate for all durable user/account/profile-scoped data behind Fastify:
  - accounts, profiles, memberships, preferences, and entitlements
  - account/profile secrets, token metadata, provider credentials, and PAT hashes
  - profile watch state
  - watch history
  - continue watching
  - watchlist/favorites/list items
  - ratings
  - provider-import interaction facts
  - recommendation outputs, taste profiles, idempotency, and copied profile signals
- Normal app data calls must go through Fastify by default. Fastify passes the original user access token to Supabase user-scoped RPC/Data API calls so RLS applies.
- Supabase service-role credentials are server-only and limited to trusted backend jobs, imports, admin repair, auth admin, and other explicitly audited privileged paths.
- Supabase is not used here as the metadata authority, AI execution layer, queue system, or default direct client data API.
- Local Postgres is metadata/cache-only, except temporary explicitly allowlisted operational outbox/admin delivery state. It must not become durable source-of-truth for user/account/profile data.
- Core backend logic remains on our server:
  - Fastify API
  - BullMQ worker
  - local Postgres for backend-owned metadata/cache tables and temporary explicitly allowlisted operational outbox/admin delivery state
  - Redis accessed directly with `ioredis`

## Auth model

- User auth: bearer JWTs are verified against a remote JWKS, then the backend ensures the corresponding Supabase account/profile bootstrap.
- Personal access tokens: `cp_pat_...` tokens are issued and validated by this server, but durable token metadata/hashes belong in Supabase private/service-role tables.
- Official recommender auth: callers send a bearer token whose SHA-256 hash matches `RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH`.
- Main-to-recommender auth: the outbox dispatcher sends `MAIN_TO_RECOMMENDER_SERVICE_TOKEN` to the recommender's internal event endpoint.
- The signed-in account is the only auth actor and the ownership root.
- Email is an account lookup attribute at the product boundary; the durable internal ownership key is the Supabase account id.
- Profiles are child personas under one account, not standalone users.
- One account token covers all profiles owned by that account; profiles do not have separate credentials.
- Profiles do not have separate logins, PATs, service credentials, or account-shared secrets.
- Shared account-scoped data includes addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
- Profile-scoped personal data includes profile settings, watch state/history, provider connections, imports, taste profiles, and recommendations.
- Trakt and Simkl are per-profile, not account-scoped.
- Older ownership plumbing in code is an implementation detail slated for cleanup, not the intended product contract.
- For AI-assisted recommendation generation, the engine calls `POST /internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan` with business inputs and a bounded candidate pool. Crispy Server owns provider selection, model selection, credentials, prompt construction, vendor protocol, response parsing, and typed-plan validation. The engine never receives raw OpenRouter, OpenAI-compatible, server-funded, or account BYOK API keys, provider/model routing config, proxy URLs, or raw vendor request details.

## Endpoint model

- Public health route: `GET /healthz`.
- User routes live under `/v1/...`.
- Internal privileged routes live under `/internal/v1/...`.
- Do not guess route shapes from old discussions; verify them against `src/http/app.ts` and `src/http/routes/*.ts`.
- The README intentionally does not maintain an endpoint inventory; OpenAPI specs in `openapi/` are the machine-readable source of truth for endpoint contracts.
- Do not reintroduce legacy profile-only internal compatibility routes; privileged integrations should use `/internal/v1/accounts/...`.
- Human admin and diagnostics UI belongs on the API server control plane, not on the external recommendation engine.
- Recommendation generation is event-driven and external: MAIN emits recompute events through its outbox, and the engine calls authenticated Crispy API endpoints to fetch bounded source data. For AI-assisted planning it uses `POST /internal/recommendations/v1/accounts/:accountId/profiles/:profileId/ai-plan`; do not document raw AI key delivery, provider/model config delivery, config-bundle delivery, or AI proxy calls to RECO. Do not describe MAIN as submitting generation jobs to it or polling it for status.
- The external recommendation engine is not this repository's BullMQ worker. `src/bin/worker.ts`, `npm run dev:worker`, and the `worker` container refer only to the internal BullMQ worker for backend queue jobs.
- Recommendation outputs should use final canonical TMDB-backed identities: `movie:tmdb:*`, `show:tmdb:*`, `season:tmdb:*`, `episode:tmdb:*`, and `person:tmdb:*`. TVDB and Kitsu IDs may appear only as non-canonical import-source bookkeeping, external IDs, or compatibility crosswalk fields.
- Profile-targeted user routes use explicit `:profileId` path params.
- Do not reintroduce header-based or body-based profile targeting fallbacks.

## Runtime shape

- `src/bin/api.ts` starts the HTTP API.
- `src/bin/worker.ts` starts the background worker.
- `docker-compose.yml` runs `api`, `worker`, `postgres`, and `redis`.
- `migrations/` defines the local Postgres metadata/cache schema and temporary operational exception tables.
- Durable user-data schema belongs in `supabase/migrations/`.

## Main product areas

- accounts, profiles, and account deletion
- watch ingestion, projections, history, and state
- home and calendar surfaces
- TMDB-backed metadata lookups and refreshes
- provider imports and token refresh flows for Trakt and Simkl
- recommendation data, external engine integration surfaces, and stored outputs
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
- `src/modules/auth/external-auth-admin.service.ts` - optional upstream auth user deletion
- `src/modules/users/user.service.ts` - account bootstrap from auth subject; target persistence is Supabase
- `src/modules/users/account-settings.service.ts` - account-shared settings and secrets; target persistence is Supabase
- `docker-compose.yml` - local runtime topology
- `DEPLOY.md` - deployment and hosted service auth notes
- `docs/supabase-fastify-rls-target-architecture-plan.md` - canonical Supabase/Fastify/RLS migration plan
- `docs/specs/user-data-supabase-residency.md` - user-data residency spec and local/Supabase boundary rules

## User data residency guardrails

- Do not create local Postgres tables that store durable user/account/profile data.
- Do not add local Postgres columns such as `account_id`, `profile_id`, `user_id`, `app_user_id`, `auth_subject`, `email`, `settings_json`, `secrets_json`, or `token_hash` unless the table is an explicitly documented operational exception.
- If a feature needs durable user persistence, add a Supabase migration/RLS/RPC/service-role path instead of a local migration.
- Local Postgres may keep metadata/cache tables and temporary operational delivery/admin tables such as `service_outbox_events` and `admin_bulk_jobs*`.
- Operational exception rows must stay minimal and must not contain secrets or copied user signal snapshots.
- Redis/BullMQ may be used for transient work, locks, queues, and cache invalidation, but not as durable user-data source-of-truth.
- Do not add local fallback repositories for user-scoped Supabase data.
- Check `docs/specs/user-data-supabase-residency.md` before changing identity, profile, settings, secrets, PAT, provider integration, recommendation, or signal storage.

## Writing guidance for AI agents

- Do not describe this system as Supabase-auth-only.
- Do not assume clients should call Supabase data APIs directly; normal app data calls go through Fastify.
- When explaining data flow, say Fastify is the default API boundary and Supabase user data is accessed through user-JWT/RLS-backed server calls or audited service-role backend paths.
- When explaining background work or caching, say Redis and BullMQ run on our server and local Postgres is metadata/cache-only except temporary operational outbox/admin state.
- If you see Supabase mentioned in env values, distinguish publishable user-JWT/RLS paths from service-role trusted backend paths.
- Do not claim profiles have separate auth credentials; they are targets under an authenticated account.
- Do not move Trakt or Simkl to account scope when discussing current product rules.
- If documenting endpoints, prefer exhaustive grouped lists over vague summaries.
- Prefer the phrase "external auth provider" in new high-level docs when possible, but preserve existing env var names and code behavior unless a task explicitly asks for renaming.
- When answering architecture questions, verify claims against the source-of-truth files above.
