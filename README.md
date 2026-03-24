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
- OpenRouter for AI features
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

## Major feature areas

- users, households, profiles, and account deletion
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

- `src/config/env.ts`
- `src/lib/db.ts`
- `src/lib/jwks.ts`
- `src/http/plugins/auth.ts`
- `src/http/plugins/service-auth.ts`
- `src/bin/api.ts`
- `src/bin/worker.ts`
- `docker-compose.yml`
- `DEPLOY.md`
