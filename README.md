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

Redis backs BullMQ and cached API surfaces such as calendar.

## Auth model

- This ownership contract is authoritative for future migrations even where some internals still use older ownership plumbing today.
- One authenticated account can access all profiles that belong to that account.
- The signed-in account is the only auth actor and the ownership root for the whole profile group.
- Email identifies the account at the product boundary, but the durable internal ownership key should remain the local account id (`app_user.id`), not the raw email value.
- Profiles are child personas under one account, similar to Netflix-style labels such as `me`, `mom`, `dad`, or `tom`.
- Profiles do not have their own API keys or bearer tokens.
- Profiles do not have separate logins, PATs, service credentials, or account-shared secrets.
- Shared account-level settings and secrets include addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
- Profile-personal data includes profile settings, watch history, continue watching, ratings, watchlist, episodic follow state, provider connections, imports, taste profiles, and recommendations.
- Trakt and Simkl connections remain per-profile.
- Internal and external privileged consumers should treat the account as the owning identity and use profile ids only to select which profile's personal experience data to read or write.

### User auth

- Requests send a bearer token.
- `src/http/plugins/auth.ts` verifies the JWT through `src/lib/jwks.ts`.
- After verification, the backend creates or updates a local app user record using the auth subject in `src/modules/users/user.service.ts`.

### Personal access tokens

- Local PATs start with `cp_pat_`.
- They are issued, stored, and verified by this backend.

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
- `/internal/v1/apps/...` routes use app authentication; account management uses Supabase JWT-backed user auth.
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
- `GET /v1/account/settings` - account-shared settings including AI client metadata and metadata-enrichment availability flags
- `PATCH /v1/account/settings` - update account-shared settings such as addons and `ai.providerId`
- `GET /v1/account/secrets/ai-api-key` - read account AI API key
- `PUT /v1/account/secrets/ai-api-key` - set account AI API key
- `DELETE /v1/account/secrets/ai-api-key` - delete account AI API key
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
- `POST /v1/profiles/:profileId/imports/start` - provider action for a profile; request body must include `provider` and `action` where `action` is one of `connect`, `reconnect`, or `import`
- `GET /v1/profiles/:profileId/imports` - list import jobs for a profile
- `GET /v1/profiles/:profileId/imports/:jobId` - inspect one import job
- `GET /v1/profiles/:profileId/import-connections` - list Trakt or Simkl connections for a profile
- `DELETE /v1/profiles/:profileId/import-connections/:provider` - disconnect provider for a profile

#### Watch and calendar

Watch mutations update canonical server state. They do not perform inline write-through to Trakt or Simkl.

- `GET /v1/profiles/:profileId/calendar` - calendar surface for one profile
- `GET /v1/profiles/:profileId/calendar/this-week` - this-week calendar slice for one profile
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

#### Provider connections

- `GET /v1/profiles/:profileId/import-connections` - list Trakt or Simkl connections for a profile
- `DELETE /v1/profiles/:profileId/import-connections/:provider` - disconnect provider for a profile

Public contracts are collection-oriented. The backend does not prescribe Home, Library, or any other client placement. Clients should compose their own surfaces from the canonical `/watch/*` endpoints and `/import-connections`.

#### Metadata and AI

- `GET /v1/metadata/resolve` - resolve metadata identity
- `GET /v1/metadata/titles/:mediaKey` - title detail by title `mediaKey`
- `GET /v1/metadata/titles/:mediaKey/content` - title content enriched with MDBList data by title `mediaKey`
- `GET /v1/metadata/titles/:mediaKey/seasons/:seasonNumber` - season detail by show `mediaKey`
- `GET /v1/playback/resolve` - resolve playback context for a title, season, or episode lookup
- `GET /v1/search/titles` - TMDB-backed title search
- `POST /v1/profiles/:profileId/ai/search` - AI-assisted search for a profile
- `POST /v1/profiles/:profileId/ai/insights` - AI insights for a title and profile

`GET /v1/metadata/titles/:mediaKey/content` returns the existing metadata item plus a `content` object resolved from MDBList enrichment when available. This route is backed by the server-level `MDBLIST_API_KEY` and is intentionally a rich-detail-only enrichment path.

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
    "hasMdbListAccess": false
  }
}
```

`metadata.hasMdbListAccess` indicates whether MDBList-backed metadata enrichment is available for rich content routes.

Important account-settings rules:

- `ai.providerId` is editable via `PATCH /v1/account/settings` and selects which provider should be used for account-owned AI keys and pooled-key fallback.
- `GET/PUT/DELETE /v1/account/secrets/ai-api-key` still manage only the raw secret value. Provider choice is stored separately in account settings.
- `/v1/profiles/:profileId/settings` remains profile-only and rejects account-scoped keys such as top-level `ai`, `ai.api_key`, and `addons`. The derived `metadata.hasMdbListAccess` field appears on account responses only and is not a writable profile setting.
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
    "mediaType": "movie",
    "kind": "title",
    "mediaKey": "movie:tmdb:329865",
    "provider": "tmdb",
    "providerId": "329865",
    "parentMediaType": null,
    "parentProvider": null,
    "parentProviderId": null,
    "tmdbId": 329865,
    "showTmdbId": null,
    "seasonNumber": null,
    "episodeNumber": null,
    "absoluteEpisodeNumber": null,
    "title": "Arrival",
    "subtitle": null,
    "summary": "A linguist works with the military to communicate with alien lifeforms after mysterious spacecraft appear around the world.",
    "overview": "A linguist works with the military to communicate with alien lifeforms after mysterious spacecraft appear around the world.",
    "artwork": {
      "posterUrl": "https://...",
      "backdropUrl": "https://...",
      "stillUrl": null
    },
    "images": {
      "posterUrl": "https://...",
      "backdropUrl": "https://...",
      "stillUrl": null,
      "logoUrl": null
    },
    "releaseDate": "2016-11-11",
    "releaseYear": 2016,
    "runtimeMinutes": 116,
    "rating": 7.6,
    "certification": "PG-13",
    "status": "released",
    "genres": ["Drama", "Mystery", "Sci-Fi"],
    "externalIds": {
      "tmdb": 329865,
      "imdb": "tt2543164",
      "tvdb": null
    },
    "seasonCount": null,
    "episodeCount": null,
    "nextEpisode": null
  },
  "content": {
    "ids": {
      "imdb": "tt2543164",
      "tmdb": 329865,
      "trakt": null,
      "tvdb": null
    },
    "title": "Arrival",
    "originalTitle": "Arrival",
    "type": "movie",
    "year": 2016,
    "description": "A linguist works with the military to communicate with alien lifeforms after mysterious spacecraft appear around the world.",
    "score": 85,
    "ratings": {
      "imdbRating": 7.9,
      "imdbVotes": 756123,
      "tmdbRating": 7.6,
      "metacritic": 81,
      "rottenTomatoes": 94,
      "letterboxdRating": 4.0,
      "mdblistRating": 85
    },
    "posterUrl": "https://...",
    "backdropUrl": "https://...",
    "genres": ["Drama", "Mystery", "Sci-Fi"],
    "keywords": ["alien", "linguist"],
    "runtime": 116,
    "certification": "PG-13",
    "released": "2016-11-11",
    "language": "English",
    "country": "United States",
    "seasonCount": null,
    "episodeCount": null,
    "directors": ["Denis Villeneuve"],
    "writers": ["Eric Heisserer", "Ted Chiang"],
    "network": null,
    "studio": "Paramount Pictures",
    "status": "released",
    "budget": 47000000,
    "revenue": 203388186,
    "updatedAt": "2026-04-03T00:00:00.000Z"
  }
}
```

Continue-watching items include a Crispy projection `id`; pass that same value to `DELETE /v1/profiles/:profileId/watch/continue-watching/:id` when dismissing an item.

#### Recommendations

- `GET /v1/profiles/:profileId/taste-profiles` - list taste profiles by source
- `GET /v1/profiles/:profileId/taste-profile` - read one taste profile, defaulting to the canonical recommendation source when `sourceKey` is omitted
- `PUT /v1/profiles/:profileId/taste-profile` - upsert one taste profile
- `GET /v1/profiles/:profileId/recommendations` - read one recommendation snapshot, defaulting to the canonical source and algorithm version when `sourceKey` or `algorithmVersion` is omitted
- `PUT /v1/profiles/:profileId/recommendations` - upsert recommendation snapshot

Recommendation generation is pull-based. RECO authenticates as an internal app principal, reads required data from `/internal/apps/v1` and confidential config from `/internal/confidential/v1`, then writes service-owned recommendation outputs through the internal app API. MAIN does not call RECO.

### Internal privileged app routes

These are the only supported privileged routes for recommendation engines and other app principals. Do not use `/api/integrations/v1` for recommendation generation or privileged RECO workflows.

- `GET /internal/apps/v1/me` - authenticated app principal self-description
- `GET /internal/apps/v1/profiles/eligible/changes` - eligible profile change feed
- `POST /internal/apps/v1/profiles/eligible/snapshots` - create an eligible profile snapshot
- `GET /internal/apps/v1/profiles/eligible/snapshots/:snapshotId/items` - read snapshot assignments
- `GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/eligibility` - check recommendation-generation eligibility
- `GET /internal/apps/v1/accounts/:accountId/profiles/:profileId/signals/recommendation-bundle` - read profile signal bundle for recommendation generation
- `GET /internal/apps/v1/recommendations/service-lists` - list writable service recommendation lists
- `PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey` - write one service-owned recommendation list with `Idempotency-Key` and ordered `items` of `{ type: "movie" | "tv", tmdbId }`; source, rank, media key, write mode, and eligibility are server-derived
- `POST /internal/apps/v1/recommendations/batch-upsert` - batch write service-owned recommendation lists with the same simplified item refs; processed batches return `200 OK` with per-profile result status
- `POST /internal/apps/v1/recommendations/runs` - create recommendation run audit record
- `PATCH /internal/apps/v1/recommendations/runs/:runId` - update recommendation run audit record
- `POST /internal/apps/v1/recommendations/runs/:runId/batches` - create recommendation batch audit record
- `PATCH /internal/apps/v1/recommendations/runs/:runId/batches/:batchId` - update recommendation batch audit record
- `GET /internal/apps/v1/recommendations/backfills/assignments` - get recommendation backfill assignments
- `GET /internal/apps/v1/audit/events` - app-scoped audit events

### Internal confidential routes

- `POST /internal/confidential/v1/accounts/:accountId/profiles/:profileId/config-bundle` - read confidential recommendation config bundle, including final `aiConfig` policy for an eligible app/profile pair
- `POST /internal/confidential/v1/accounts/:accountId/profiles/:profileId/ai-proxy/chat/completions` - scoped AI proxy for recommendation generation; Crispy injects the selected API key server-side and forwards to the configured provider

### Internal service routes

#### Account-rooted internal routes

- These are the only supported privileged routes for engines that start from account identity or email.
- `GET /internal/v1/accounts/by-email/:email` - resolve an owning account id from email
- `GET /internal/v1/accounts/:accountId/profiles` - list profiles under one account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/watch-history` - profile watch history scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/continue-watching` - profile continue watching scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/watchlist` - profile watchlist scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/ratings` - profile ratings scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/episodic-follow` - episodic follow data scoped to the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/taste-profile` - read taste profile by source under the owning account; defaults to the canonical source when `sourceKey` is omitted
- `PUT /internal/v1/accounts/:accountId/profiles/:profileId/taste-profile` - write taste profile under the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/recommendations` - read recommendations under the owning account; defaults to the canonical source and algorithm version when omitted
- `PUT /internal/v1/accounts/:accountId/profiles/:profileId/recommendations` - write recommendations under the owning account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/connection` - provider connection summary after confirming the profile belongs to the account
- `GET /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/token-status` - provider token status after confirming the profile belongs to the account
- `POST /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/access-token` - fetch provider access token after confirming the profile belongs to the account
- `POST /internal/v1/accounts/:accountId/profiles/:profileId/providers/:provider/refresh` - refresh provider token after confirming the profile belongs to the account

Internal and admin continue-watching responses expose the same item `id` field as the user-facing route so downstream consumers can dismiss or correlate items without extra lookups.

#### Recommendation diagnostics

- `GET /internal/v1/admin/recommendations/outbox` - recommendation outbox diagnostics
- `GET /internal/v1/admin/imports/connections` - import connection diagnostics
- `GET /internal/v1/admin/imports/jobs` - import job diagnostics

The recommendation engine is an external pull-based service. It calls authenticated Crispy API endpoints to retrieve bounded profile, watch, rating, watchlist, episodic follow, metadata, and configuration context for generation. It is not this repository's internal BullMQ worker, MAIN does not push generation jobs to it, and MAIN does not poll it for job status.

## Current product-scoping rules

- Ownership root: the signed-in account owns the profile group; profiles are child personas under that account.
- Account-shared: addons, AI API key, metadata-enrichment availability flags, PATs, account deletion, and profile roster management.
- Account-shared AI settings also include non-secret provider selection metadata such as `ai.providerId`.
- Profile-personal: profile settings, watch history, continue watching, watchlist, ratings, episodic follow state, Trakt connection, Simkl connection, imports, taste profiles, recommendations.
- Profile-targeted paths select which persona under the account is being addressed; they are not separate logins or separate API clients.
- Some internals still use older ownership plumbing. That is an implementation detail pending cleanup, not the intended product contract.
- Internal services should resolve an account first, then target a profile that belongs to that account.
- End users can only access profiles that belong to their account.

## Recommendation architecture

Recommendation generation is pull-based. The external recommendation engine calls MAIN's authenticated API endpoints, including `/internal/apps/v1` and `/internal/confidential/v1` where authorized, to fetch profile data and configuration. MAIN does not push work to the engine or poll the engine for status. Stored recommendation snapshots remain in Crispy Server and are served to clients by MAIN.

The engine is separate from the internal BullMQ worker started by this repository. Running or scaling `npm run dev:worker` affects only backend queue jobs owned by Crispy Server; it does not run or scale recommendation generation.

## Admin control plane

- `GET /admin` is the API-server-hosted admin UI for recommendation and import diagnostics.
- Admin UI access uses HTTP Basic Auth configured by `ADMIN_UI_USER` and `ADMIN_UI_PASSWORD`.
- The API server hosts the operator UI and human-readable admin backend. Recommendation engines should use pull-based internal app APIs instead of being controlled from the admin surface.

## Major feature areas

- accounts, profiles, and account deletion
- watch event ingestion, projections, history, and state
- provider-routed metadata search and detail views
- home and calendar surfaces
- provider imports from Trakt and Simkl
- recommendation data, external engine integration surfaces, and stored outputs
- AI search and AI insights

## Local development

1. Copy env vars:

   ```bash
   cp .env.example .env
   ```

2. Fill the required values in `.env`.

     - `DATABASE_URL` and `REDIS_URL` point to our own infrastructure.
     - `APP_PUBLIC_URL` and `APP_DISPLAY_NAME` define the API server's canonical outbound app identity. They are used for OpenAI-compatible `HTTP-Referer` and `X-Title` headers.
     - `AUTH_*` values are only used for external auth.
      - `AI_SERVER_API_KEY` is an optional single server-managed AI credential used for Pro and Ultra tier AI features. Lite tier users provide their own OpenRouter key.
     - `RECOMMENDATION_ALGORITHM_VERSION` sets the canonical recommendation snapshot version. It defaults to `v3.2.1`.
     - `MDBLIST_API_KEY` enables the rich metadata-enrichment route `GET /v1/metadata/titles/:mediaKey/content`.
     - Runtime defaults live in `config/app-config.json.example`. The loader checks `config/app-config.json` first (gitignored, for local overrides), then falls back to the example template. Override the path with `APP_CONFIG_PATH` if needed.

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

See `DEPLOY.md` for the VPS flow and hosted deployment setup.

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
- `src/bin/api.ts`
- `src/bin/worker.ts`
- `docker-compose.yml`
- `DEPLOY.md`
