# Crispy Server

Crispy Server is the backend for the Crispy app. It runs the API, background jobs, persistence, provider imports, recommendations, and AI integrations on our own infrastructure.

## Important architecture note

Supabase is used for auth only.

- Supabase provides the JWT issuer and JWKS used to verify user bearer tokens.
- Supabase can also be used as the upstream auth admin API when deleting an auth user.
- Supabase is not the application database in this repo.
- Supabase is not used here for Storage, Edge Functions, Realtime, or RLS-managed app data.

All application data and business logic run on our server:

- Fastify API
- BullMQ worker
- Postgres for primary data
- Redis for queues and cached surfaces

If an AI agent or doc says this service "uses Supabase" without that auth-only qualifier, that description is incomplete.

## Stack

- TypeScript + Fastify
- Postgres via `pg`
- Redis + BullMQ
- TMDB for metadata
- OpenAI-compatible endpoints for AI features
- Trakt and Simkl for provider imports
- Supabase for external auth only

## Runtime components

### API

The API process is started by `src/bin/api.ts` and assembled in `src/http/app.ts`.

It serves:

- user/account/profile routes
- watch ingestion and read models
- home and calendar views
- metadata lookups
- provider import flows
- recommendation APIs
- AI search and AI insights

### Worker

The worker process is started by `src/bin/worker.ts` and dispatches BullMQ jobs from `src/worker/index.ts`.

It handles:

- projection rebuilds
- metadata refresh jobs
- home/calendar cache refreshes
- provider imports
- provider token refresh jobs

### Postgres

Postgres is the source of truth for application data. The code uses direct `pg` connections from `src/lib/db.ts`, and the schema lives under `migrations/`.

### Redis

Redis backs BullMQ and cached API surfaces such as home and calendar.

## Auth model

- This ownership contract is authoritative for future migrations even where some internals still use older ownership plumbing today.
- One authenticated account can access all profiles that belong to that account.
- The signed-in account is the only auth actor and the ownership root for the whole profile group.
- Email identifies the account at the product boundary, but the durable internal ownership key should remain the local account id (`app_user.id`), not the raw email value.
- Profiles are child personas under one account, similar to Netflix-style labels such as `me`, `mom`, `dad`, or `tom`.
- Profiles do not have their own API keys or bearer tokens.
- Profiles do not have separate logins, PATs, service credentials, or account-shared secrets.
- Shared account-level settings and secrets include addons, AI API key, OMDb key, PATs, account deletion, and profile roster management.
- Profile-personal data includes profile settings, watch history, continue watching, ratings, watchlist, tracked series, provider connections, imports, taste profiles, and recommendations.
- Trakt and Simkl connections remain per-profile.
- Internal and external privileged consumers should treat the account as the owning identity and use profile ids only to select which profile's personal experience data to read or write.

### User auth

- Requests send a bearer token.
- `src/http/plugins/auth.ts` verifies the JWT through `src/lib/jwks.ts`.
- After verification, the backend creates or updates a local app user record using the auth subject in `src/modules/users/user.service.ts`.

### Personal access tokens

- Local PATs start with `cp_pat_`.
- They are issued, stored, and verified by this backend.

### Internal service auth

- Internal callers use `x-service-id` and `x-api-key`.
- Credentials come from `SERVICE_CLIENTS_JSON`.
- This is mainly used for hosted internal consumers such as the recommendation engine.

## Auth envs

When Supabase is the external auth provider, configure the backend with the project base URL and a server-only secret key:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
AUTH_JWT_AUDIENCE=authenticated
SUPABASE_SECRET_KEY=<sb_secret key>
```

- The backend derives the JWT issuer, JWKS URL, and auth admin URL from `SUPABASE_URL`.
- `SUPABASE_SECRET_KEY` must be a server-only secret key. Do not use a publishable or anon key.

## Endpoint rules

- `GET /healthz` is public.
- Most `/v1/...` routes require user auth through bearer JWT or local PAT.
- Most `/internal/v1/...` routes require service auth through `x-service-id` and `x-api-key`.
- Profile-targeted user routes now use explicit `:profileId` path params.
- Profiles are targets under an authenticated account, not separately authenticated actors.
- `GET /v1/imports/:provider/callback` is the provider OAuth callback and does not require prior API auth.

## Current endpoint map

This is the current API surface registered in `src/http/app.ts`. Keep docs and clients aligned to this list rather than guessing from old architecture notes.

### Public routes

- `GET /healthz` - liveness check
- `GET /v1/imports/:provider/callback` - completes Trakt or Simkl OAuth callback

### Admin routes

- `GET /admin` - API-server-hosted operator UI protected by admin basic auth

### User routes

#### Account and identity

- `GET /v1/me` - current account summary, account-shared settings contract, and profiles
- `GET /v1/account/settings` - account-shared settings including AI client metadata and OMDb availability flags
- `PATCH /v1/account/settings` - update account-shared settings such as addons and `ai.providerId`
- `GET /v1/account/secrets/ai-api-key` - read account AI API key
- `PUT /v1/account/secrets/ai-api-key` - set account AI API key
- `DELETE /v1/account/secrets/ai-api-key` - delete account AI API key
- `GET /v1/account/secrets/omdb-api-key` - read account OMDb key
- `PUT /v1/account/secrets/omdb-api-key` - set account OMDb key
- `DELETE /v1/account/secrets/omdb-api-key` - delete account OMDb key
- `DELETE /v1/account` - delete local app account and attempt upstream auth-user deletion
- `GET /v1/auth/personal-access-tokens` - list PATs
- `POST /v1/auth/personal-access-tokens` - create PAT
- `DELETE /v1/auth/personal-access-tokens/:tokenId` - revoke PAT

#### Profiles and imports

- `GET /v1/profiles` - list profiles for the signed-in account
- `POST /v1/profiles` - create a profile
- `PATCH /v1/profiles/:profileId` - update a profile
- `GET /v1/profiles/:profileId/settings` - read profile-only settings
- `PATCH /v1/profiles/:profileId/settings` - update profile-only settings
- `POST /v1/profiles/:profileId/imports/start` - start Trakt or Simkl import for a profile
- `GET /v1/profiles/:profileId/imports` - list import jobs for a profile
- `GET /v1/profiles/:profileId/imports/:jobId` - inspect one import job
- `GET /v1/profiles/:profileId/import-connections` - list Trakt or Simkl connections for a profile
- `DELETE /v1/profiles/:profileId/import-connections/:provider` - disconnect provider for a profile

#### Watch, home, and calendar

- `GET /v1/profiles/:profileId/home` - home surface for one profile
- `GET /v1/profiles/:profileId/calendar` - calendar surface for one profile
- `POST /v1/profiles/:profileId/watch/events` - ingest watch event
- `GET /v1/profiles/:profileId/watch/continue-watching` - continue watching list
- `DELETE /v1/profiles/:profileId/watch/continue-watching/:id` - dismiss continue watching item
- `GET /v1/profiles/:profileId/watch/history` - watch history
- `GET /v1/profiles/:profileId/watch/watchlist` - watchlist
- `GET /v1/profiles/:profileId/watch/ratings` - ratings
- `GET /v1/profiles/:profileId/watch/state` - resolve watch state for one item
- `POST /v1/profiles/:profileId/watch/states` - resolve watch state for many items
- `POST /v1/profiles/:profileId/watch/mark-watched` - mark item watched
- `POST /v1/profiles/:profileId/watch/unmark-watched` - unmark item watched
- `PUT /v1/profiles/:profileId/watch/watchlist/:mediaKey` - add or update watchlist item
- `DELETE /v1/profiles/:profileId/watch/watchlist/:mediaKey` - remove watchlist item
- `PUT /v1/profiles/:profileId/watch/rating/:mediaKey` - set rating
- `DELETE /v1/profiles/:profileId/watch/rating/:mediaKey` - remove rating

#### Library and provider auth

- `GET /v1/profiles/:profileId/library` - combined library view across local and provider-backed sources
- `GET /v1/profiles/:profileId/provider-auth/state` - provider auth summary for a profile
- `POST /v1/profiles/:profileId/library/watchlist` - write watchlist state through the library facade
- `POST /v1/profiles/:profileId/library/rating` - write rating state through the library facade

#### Metadata and AI

- `GET /v1/metadata/resolve` - resolve metadata identity
- `GET /v1/metadata/titles/:id` - title detail
- `GET /v1/metadata/titles/:id/content` - title content enriched with OMDb data
- `GET /v1/metadata/titles/:id/seasons/:seasonNumber` - season detail
- `GET /v1/playback/resolve` - resolve playback context for a title, season, or episode lookup
- `GET /v1/search/titles` - TMDB-backed search
- `POST /v1/profiles/:profileId/ai/search` - AI-assisted search for a profile
- `POST /v1/profiles/:profileId/ai/insights` - AI insights for a title and profile

`GET /v1/metadata/titles/:id/content` returns the existing metadata item plus an `omdb` object resolved from a cached OMDb enrichment when available, otherwise using keys in this order: the requesting account's OMDb key, server-managed keys from `OMDB_API_KEYS`, then the shared pool of other stored account OMDb keys.

`GET /v1/account/settings`, `PATCH /v1/account/settings`, and `GET /v1/me` now expose the account-level AI client contract under `settings.ai` or `accountSettings.ai`:

```json
{
  "ai": {
    "providerId": "openrouter",
    "hasAiApiKey": true,
    "defaultProviderId": "openai",
    "providers": [
      {
        "id": "openai",
        "label": "OpenAI",
        "endpointUrl": "https://api.openai.com/v1/chat/completions"
      },
      {
        "id": "openrouter",
        "label": "OpenRouter",
        "endpointUrl": "https://openrouter.ai/api/v1/chat/completions"
      }
    ]
  },
  "metadata": {
    "hasOmdbApiKey": false
  }
}
```

Important account-settings rules:

- `ai.providerId` is editable via `PATCH /v1/account/settings` and selects which provider should be used for account-owned AI keys and pooled-key fallback.
- `GET/PUT/DELETE /v1/account/secrets/ai-api-key` still manage only the raw secret value. Provider choice is stored separately in account settings.
- `/v1/profiles/:profileId/settings` remains profile-only and rejects account-scoped keys such as top-level `ai`, `ai.api_key`, `metadata.omdb_api_key`, and `addons`.
- The old derived field `ai.endpointUrl` is no longer returned. Clients should use `ai.providerId` plus the `ai.providers[]` catalog instead.

Example account settings patch body:

```json
{
  "ai": {
    "providerId": "openrouter"
  }
}
```

Example response shape:

```json
{
  "item": {
    "id": "crisp:movie:55",
    "title": "Arrival",
    "externalIds": {
      "imdb": "tt2543164"
    }
  },
  "omdb": {
    "imdbId": "tt2543164",
    "title": "Arrival",
    "type": "movie",
    "year": "2016",
    "rated": "PG-13",
    "released": "11 Nov 2016",
    "runtime": "116 min",
    "genres": ["Drama", "Mystery", "Sci-Fi"],
    "directors": ["Denis Villeneuve"],
    "writers": ["Eric Heisserer", "Ted Chiang"],
    "actors": ["Amy Adams", "Jeremy Renner", "Forest Whitaker"],
    "plot": "A linguist works with the military to communicate with alien lifeforms after mysterious spacecraft appear around the world.",
    "languages": ["English", "Russian", "Mandarin"],
    "countries": ["United States", "Canada"],
    "awards": "Won 1 Oscar. 73 wins & 265 nominations total",
    "posterUrl": "https://...",
    "ratings": [
      { "source": "Internet Movie Database", "value": "7.9/10" },
      { "source": "Rotten Tomatoes", "value": "94%" },
      { "source": "Metacritic", "value": "81/100" }
    ],
    "imdbRating": 7.9,
    "imdbVotes": 756123,
    "metascore": 81,
    "boxOffice": "$100,546,139",
    "production": "Paramount Pictures",
    "website": null,
    "totalSeasons": null
  }
}
```

Continue-watching items include a Crispy projection `id`; pass that same value to `DELETE /v1/profiles/:profileId/watch/continue-watching/:id` when dismissing an item.

#### Recommendations

- `GET /v1/recommendation-consumers` - list user-owned recommendation consumers
- `POST /v1/recommendation-consumers` - create user-owned recommendation consumer
- `DELETE /v1/recommendation-consumers/:consumerId` - revoke user-owned recommendation consumer
- `GET /v1/profiles/:profileId/tracked-series` - tracked series for a profile
- `GET /v1/profiles/:profileId/taste-profiles` - list taste profiles by source
- `GET /v1/profiles/:profileId/taste-profile` - read one taste profile
- `PUT /v1/profiles/:profileId/taste-profile` - upsert one taste profile
- `GET /v1/profiles/:profileId/recommendations` - read recommendation snapshot or active recommendation
- `PUT /v1/profiles/:profileId/recommendations` - upsert recommendation snapshot
- `GET /v1/profiles/:profileId/recommender-source` - read active recommendation source
- `PUT /v1/profiles/:profileId/recommender-source` - set active recommendation source
- `POST /v1/recommendation-work/claim` - public route exists, but it is intended for privileged consumers with the right scopes
- `POST /v1/recommendation-work/renew` - same note as above
- `POST /v1/recommendation-work/complete` - same note as above

### Internal service routes

#### Account-rooted internal routes

- These are the only supported privileged routes for engines that start from account identity or email.
- `GET /internal/v1/accounts/by-email/:email` - resolve an owning account id from email
- `GET /internal/v1/accounts/:accountId/profiles` - list profiles under one account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/watch-history` - profile watch history scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/continue-watching` - profile continue watching scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/watchlist` - profile watchlist scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/ratings` - profile ratings scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/tracked-series` - tracked series scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/taste-profile` - read taste profile by source under the owning account
- `PUT /internal/v1/accounts/:accountId/profiles/:profileId/taste-profile` - write taste profile under the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/recommendations` - read recommendations under the owning account
- `PUT /internal/v1/accounts/:accountId/profiles/:profileId/recommendations` - write recommendations under the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/secrets/ai-api-key` - read account-shared AI API key after confirming the profile belongs to the account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/secrets/omdb-api-key` - read account-shared OMDb key after confirming the profile belongs to the account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/connection` - provider connection summary after confirming the profile belongs to the account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/token-status` - provider token status after confirming the profile belongs to the account
- `POST /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/access-token` - fetch provider access token after confirming the profile belongs to the account
- `POST /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/refresh` - refresh provider token after confirming the profile belongs to the account

Internal and admin continue-watching responses expose the same item `id` field as the user-facing route so downstream consumers can dismiss or correlate items without extra lookups.

The internal AI secret route now returns provider metadata alongside the secret value so downstream services can choose the correct OpenAI-compatible endpoint and model family for that key:

```json
{
  "secret": {
    "appUserId": "user-123",
    "key": "ai.api_key",
    "value": "sk-...",
    "providerId": "openrouter"
  }
}
```

#### Recommendation work and diagnostics

- `POST /internal/v1/recommendation-work/claim` - claim recommendation work
- `POST /internal/v1/recommendation-work/renew` - renew recommendation work lease
- `POST /internal/v1/recommendation-work/complete` - complete recommendation work
- `GET /internal/v1/admin/recommendations/consumers` - recommendation consumer diagnostics
- `GET /internal/v1/admin/recommendations/work-state` - recommendation work-state diagnostics
- `GET /internal/v1/admin/recommendations/outbox` - recommendation outbox diagnostics
- `GET /internal/v1/admin/imports/connections` - import connection diagnostics
- `GET /internal/v1/admin/imports/jobs` - import job diagnostics

## Current product-scoping rules

- Ownership root: the signed-in account owns the profile group; profiles are child personas under that account.
- Account-shared: addons, AI API key, OMDb key, PATs, account deletion, and profile roster management.
- Account-shared AI settings also include non-secret provider selection metadata such as `ai.providerId`.
- Profile-personal: profile settings, watch history, continue watching, watchlist, ratings, tracked series, Trakt connection, Simkl connection, imports, taste profiles, recommendations.
- Profile-targeted paths select which persona under the account is being addressed; they are not separate logins or separate API clients.
- Some internals still use older ownership plumbing. That is an implementation detail pending cleanup, not the intended product contract.
- Internal services should resolve an account first, then target a profile that belongs to that account.
- End users can only access profiles that belong to their account.

## Admin control plane

- `GET /admin` is the API-server-hosted admin UI for recommendation-worker operations and diagnostics.
- Admin UI access uses HTTP Basic Auth configured by `ADMIN_UI_USER` and `ADMIN_UI_PASSWORD`.
- Worker control uses the recommendation engine worker-control endpoint configured with `RECOMMENDATION_ENGINE_WORKER_BASE_URL` and `RECOMMENDATION_ENGINE_WORKER_API_KEY`.
- The API server now hosts the operator UI and human-readable admin backend. The recommendation engine should be treated as a worker compute node with a narrow control surface, not the primary admin surface.

## Major feature areas

- accounts, profiles, and account deletion
- watch event ingestion, projections, history, and state
- TMDB-backed metadata search and detail views
- home and calendar surfaces
- provider imports from Trakt and Simkl
- recommendation data, outputs, and work leasing
- AI search and AI insights

## Local development

1. Copy env vars:

   ```bash
   cp .env.example .env
   ```

2. Fill the required values in `.env`.

    - `DATABASE_URL` and `REDIS_URL` point to our own infrastructure.
    - `AUTH_*` values are only used for external auth.
    - `SERVICE_CLIENTS_JSON` configures internal service-to-service callers.
    - `AI_SERVER_KEYS_JSON` is an optional JSON array of server-managed AI credentials used as the middle fallback step before the shared account-key pool. Example: `[{"providerId":"openai","apiKey":"sk-..."}]`.
    - `OMDB_API_KEYS` remains a comma-separated server-managed OMDb fallback list.
    - Runtime defaults now live in `config/app-config.json`, loaded by `src/config/app-config.ts`. Override the path with `APP_CONFIG_PATH` if needed.

3. Start the stack:

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
npm run test
```

## Deployment

See `DEPLOY.md` for the VPS flow and the expected service-to-service auth setup for hosted internal consumers.

## Source of truth for architecture questions

When in doubt, verify against these files:

- `config/app-config.json`
- `src/config/app-config.ts`
- `src/config/env.ts`
- `src/lib/db.ts`
- `src/lib/jwks.ts`
- `src/http/app.ts`
- `src/http/routes/`
- `src/http/plugins/auth.ts`
- `src/http/plugins/service-auth.ts`
- `src/bin/api.ts`
- `src/bin/worker.ts`
- `docker-compose.yml`
- `DEPLOY.md`
