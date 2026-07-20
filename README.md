# Crispy Server

Crispy Server is the backend for the Crispy app. It runs the API, internal backend jobs, persistence integrations, provider imports, stored recommendation surfaces, and AI-assisted features on Crispy-owned infrastructure.

## What this service owns

Supabase is the external auth provider. Fastify remains the application data API, and product data lives in local Postgres.

- Supabase Auth provides the JWT issuer and JWKS used to verify user bearer tokens.
- Fastify verifies user JWTs and authorizes access to local account/profile data.
- Local Postgres stores profile watch state, history, continue watching, watchlist, ratings, provider-import interaction facts, metadata caches, recommendation outputs, taste profiles, outbox/admin state, and other product data.
- Supabase service-role credentials are server-only and limited to upstream auth admin calls when required.
- Metadata, provider secrets, AI vendor calls, admin/ops, queues, and recommendation orchestration remain backend-owned.

Application data and business logic are owned by:

- Fastify API runtime
- Internal BullMQ worker runtime
- Local Postgres for product data, operational data, metadata caches, outbox/admin state, and recommendation data
- Redis for queues and cached read surfaces

## Stack

- TypeScript + Fastify
- Postgres via `pg`
- Redis + BullMQ
- TMDB for canonical metadata
- Trakt and Simkl for provider imports
- OpenAI-compatible endpoints for AI features
- Supabase Auth for external identity/session

## Runtime components

- `src/bin/api.ts` starts the HTTP API assembled in `src/http/app.ts`.
- `src/bin/worker.ts` starts the internal BullMQ worker for backend-owned async jobs.
- `migrations/` contains the Postgres schema history.
- `config/app-config.json.example` contains committed runtime defaults; `config/app-config.json` is the gitignored local override.

The external recommendation engine is a separate event-driven service. It is not this repository's BullMQ worker, does not read Crispy storage directly, and integrates through authenticated APIs plus fire-and-forget `recommendation.recompute_requested` notifications posted from `RecommenderNotifier` (no persistent outbox, no retries; reco is idempotent on `profileId`).

## Product/auth model

- The signed-in account is the auth actor and ownership root.
- Profiles are child personas under an account, not separately authenticated users.
- The first profile on an account is the admin (main) profile; account-scoped operations route through it.
- Per-profile 4-digit PINs are stored as bcrypt hashes with exponential backoff on invalid attempts. A successful verify unlocks the profile in Redis for 30 days (Netflix-style: once unlocked, no per-request token needed); `POST /v1/profiles/:profileId/lock` re-locks. Profile-scoped routes (`watch`, `ai`, `calendar`) require an unlocked profile when the profile has a PIN set.
- The admin profile may require a valid PIN when new profiles are added; the PIN set/change/remove/verify endpoints live under `/v1/profiles/:profileId/pin`.
- Profile `interface_language` and country code are validated against code-only catalogs exposed at `/v1/i18n/languages` and `/v1/i18n/countries`.
- Profile `avatar_url` must be a valid Dicebear URL (`https://api.dicebear.com/v9/<style>/<format>`); avatar rendering is client-side.
- First authenticated request bootstraps the account + admin profile; if `name`, `interfaceLanguage`, or `avatarUrl` are missing/invalid, the API returns `409 signup_incomplete`.
- Account-shared data includes profile roster management, addons, PATs, account deletion, metadata-enrichment availability flags, and AI provider/secret settings.
- Profile-personal data includes profile settings, watch state, history, continue watching, watchlist, ratings, episodic follow state, provider connections/imports, taste profiles, and recommendations.
- Trakt and Simkl connections remain per-profile.

## Local development

1. Copy env vars:

   ```bash
   cp .env.example .env
   ```

2. Fill required values in `.env`.

   Key groups include `DATABASE_URL`, `REDIS_URL`, external auth settings such as `AUTH_BASE_URL`/`AUTH_JWT_AUDIENCE`, optional AI credentials, provider import credentials, and optional `RECOMMENDER_INTERNAL_BASE_URL` + `MAIN_TO_RECOMMENDER_SERVICE_TOKEN` for fire-and-forget notifier calls to the recommender engine.

3. Start the local stack:

   ```bash
   docker compose up --build
   ```

4. Run migrations:

   ```bash
   docker compose exec api npm run migrate
   ```

5. Check health:

   ```bash
   curl http://127.0.0.1:18765/healthz
   ```

Useful commands:

```bash
npm run dev:api
npm run dev:worker
npm run build
npm run typecheck
npm run test
```

## Documentation and source of truth

| Topic | Source |
| --- | --- |
| System architecture | `architecture.md` |
| Deployment | `DEPLOY.md` |
| API classification, contract workflow, and quality gates | `docs/api/README.md` |
| Canonical machine-readable HTTP contracts | `openapi/*.yaml` |
| Generated API artifacts | `openapi/generated/`, `docs/api/generated/` |
| Recommendation API guide | `docs/api/recommendations.md` |
| Recommendation-engine boundary and security contract | `docs/architecture/recommendation-engine.md` |
| Supabase auth-only boundary | `supabase/README.md` |
| Client media identity/watch-state guidance | `docs/api/media-state.md` |

The README intentionally does not maintain an endpoint inventory. OpenAPI is the canonical API contract; use `docs/api/README.md` for the workflow and run the contract checks before merging API changes.

## API contract checks

```bash
npm run contract:lint
npm run docs:api
npm run contract:drift
```

For the full API quality gate, run:

```bash
npm run contract:check
```

## Deployment

See `DEPLOY.md` for the VPS flow and hosted deployment setup.
