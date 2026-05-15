# User Data Supabase Residency Spec

## Status

- Specification for planned migration.
- Local Postgres currently contains legacy user-scoped tables that violate this target boundary.
- Implementation must happen through forward migrations and staged repository cutovers; do not rewrite historical migrations in place.

## Goal

All durable user/account/profile-scoped data must live in Supabase. The API server database is reserved for metadata/cache data plus temporary operational delivery state that is explicitly allowlisted.

## Data residency contract

### Supabase-owned user data

A table, queue payload, cache, or repository stores user data if it contains or can reconstruct any of:

- `account_id`, `profile_id`, `user_id`, `app_user_id`, `auth_subject`, `email`
- account/profile names, avatar references, membership, preferences, entitlements, settings, or deletion state
- secrets, provider credentials, API keys, personal access tokens, OAuth sessions, or token hashes
- watch history, playback progress, watchlist/favorites, ratings, provider-import facts, or copied interaction signals
- recommendation outputs, taste profiles, idempotency records, user-visible recommendation audit records, or profile eligibility/signal projections

These records must be stored in Supabase with appropriate RLS, RPCs, service-role-only tables, or private schemas.

### Local Postgres allowed data

Local Postgres may store only backend-owned non-user metadata/cache data, such as:

- TMDB response/title/search/person/collection caches
- IMDb ratings cache
- canonical content metadata identity/cache rows
- media-card metadata caches that do not include account/profile/user identifiers
- schema migration bookkeeping

### Temporary local operational exception

For now, local Postgres may keep operational delivery/admin state required by server workers, including:

- `service_outbox_events`
- `admin_bulk_jobs`
- `admin_bulk_job_targets`
- `admin_bulk_job_requests`
- `admin_bulk_job_events`

These tables are not product source-of-truth. They must be documented as temporary operational state, kept minimal, and must not contain secrets or large user payload snapshots. Future work should either move them to Supabase or remove user identifiers from local rows.

Redis/BullMQ may be used for transient processing, locks, and cache invalidation. Redis must not become durable source-of-truth for user data.

## Current violations to migrate

The following local Postgres areas must move to Supabase or be retired:

| Local area | Current data | Target |
| --- | --- | --- |
| `app_users` | auth subject, email, local user id | `public.accounts` keyed by Supabase auth/account id |
| `profile_groups`, `profile_group_members`, `profiles` | account/profile ownership and profile roster | `public.profiles`, `public.profile_members` |
| `profile_settings` | profile preferences/settings | `public.profile_preferences` |
| `account_settings` | account preferences and pricing/settings JSON | `public.account_preferences` and `public.account_entitlements` |
| `account_secrets` | encrypted API/provider/AI keys | service-role-only Supabase private table |
| `personal_access_tokens` | PAT hashes/scopes/expiry | service-role-only Supabase private table |
| provider connection/session tables | Trakt/Simkl provider credentials and import state | Supabase private/profile-scoped provider tables |
| recommendation snapshots/lists/taste tables | user-visible recommendation outputs and taste profile data | existing or new `reco.*` Supabase tables |
| `profile_input_signal_cache_sections` | copied watch/rating/list/continue-watching signals | remove, read from Supabase live, or move to Supabase private/reco schema |
| `profile_eligibility_*`, `app_profile_*_signals`, `profile_signal_versions` | profile eligibility and copied signal projections | Supabase `reco`/private schema or recomputable service view |
| `public_account_*` recommendation/taste/idempotency/audit tables | account/profile write API outputs and audit | existing or new `reco.*` Supabase tables |
| account/app API key tables with account ownership | account-scoped external app access | Supabase private/service-role tables unless purely system-scoped |

## Target architecture

### Identity and bootstrap

- Supabase Auth remains the session authority.
- The canonical account id is the Supabase auth/account UUID.
- Fastify verifies JWTs through JWKS as today.
- On authenticated requests, Fastify must ensure Supabase account/profile bootstrap using a service-role RPC or tightly controlled service-role repository:
  - upsert `public.accounts`
  - ensure default `public.profiles`
  - ensure `public.profile_members`
  - ensure `public.account_preferences`
  - ensure `public.profile_preferences`
- Local `app_users` must stop being the ownership root.
- Internal naming may temporarily keep `appUserId` while it carries the canonical Supabase account id, but follow-up work should rename it to `accountId`.

### Profiles and preferences

- Profile CRUD reads/writes Supabase `public.profiles` and `public.profile_members`.
- Profile settings read/write Supabase `public.profile_preferences`.
- Account settings read/write Supabase `public.account_preferences` and `public.account_entitlements`.
- Normal user-visible reads must use user JWT/RLS-backed paths when practical.
- Trusted bootstrap, secret access, and account deletion may use service role.

### Secrets and credentials

- Secrets must live only in service-role-only Supabase tables or private schemas.
- Values may keep the existing AES-256-GCM envelope during migration, but the encryption key must remain server-side only.
- No secret table may be readable by `anon` or `authenticated` roles.
- API responses must never return raw provider/AI keys except narrowly approved secret-management flows.

### PATs and API keys

- PAT create/auth/revoke/list operations must use Supabase private/service-role tables.
- Token hashes, previews, scopes, expiry, revoke state, and last-used timestamps are user data.
- Local PAT storage must be retired.

### Provider integrations

- Trakt/Simkl tokens and provider sessions are profile-scoped user data.
- Provider credentials and durable import connection state must move to Supabase private/profile-scoped tables.
- Provider-import watch/list/rating facts continue to write through Supabase RPCs.

### Recommendations and signals

- User-visible recommendation lists, versions, items, taste profiles, and write idempotency must use Supabase `reco.*` or a successor Supabase schema.
- Remove local fallback repositories such as `supabase ? SupabaseRepo : SqlRepo` for user-scoped recommendation data.
- Copied profile signal caches must not remain in local Postgres.
- The recommendation engine should continue to access user data through authenticated Crispy API endpoints, not direct local DB access.

### Local operational exception

- `service_outbox_events` and admin bulk job tables may remain local temporarily.
- Keep rows minimal: identifiers, event type, status, retry/lock timestamps, destination, correlation/idempotency data.
- Do not store secrets or full user signal snapshots in local operational payloads.
- Treat this exception as temporary and visible in docs/guardrails.

## Implementation phases

### Phase 1: Documentation and guardrails

1. Update `architecture.md` with the Supabase user-data residency rule and local operational exception.
2. Update `docs/supabase-fastify-rls-target-architecture-plan.md` from watch-domain-only wording to all user-data wording.
3. Update `AGENT.md` with explicit future-agent rules.
4. Add a local schema guard script that fails on non-allowlisted user-scoped local tables/columns.

### Phase 2: Supabase schema

Add forward Supabase migrations for any missing target tables/RPCs/policies:

- private account secrets
- private PATs/API keys
- provider credentials/sessions
- account/profile bootstrap RPC if chosen
- missing recommendation/idempotency/audit tables if existing `reco.*` coverage is insufficient

Run Supabase security/performance advisors after DDL changes.

### Phase 3: Data migration

Create an idempotent migration script that reads local Postgres and writes Supabase using service role.

Required properties:

- preserves profile ids where possible
- maps `app_users.auth_subject::uuid` to canonical Supabase account id
- stores local ids in legacy columns only for traceability
- validates row counts and key checksums
- can resume safely
- emits a report of migrated/skipped/failed rows

Suggested mapping:

- `app_users.auth_subject::uuid` -> `public.accounts.id`
- `app_users.id` -> `public.accounts.legacy_app_user_id`
- `app_users.email` -> `public.accounts.email`
- local `profiles.id` -> `public.profiles.id`
- local `profile_groups.owner_user_id` -> mapped account id
- `profile_settings.settings_json` -> `public.profile_preferences.settings_json`
- `account_settings.settings_json` -> `public.account_preferences.settings_json`
- `account_secrets.secrets_json` -> Supabase private account secrets table
- `personal_access_tokens.user_id` -> mapped account id in Supabase private PAT table
- local recommendation/taste/output rows -> `reco.*`
- provider credentials/sessions -> Supabase private provider tables

### Phase 4: Repository cutover

Refactor modules from local `DbClient` repositories to Supabase-backed repositories:

- users/account bootstrap
- profile and profile settings services
- account settings/secrets
- PATs/API keys
- provider credentials/sessions
- recommendation outputs/taste profiles/idempotency
- profile signal cache/eligibility projections

Remove local user-data fallback code after successful cutover.

### Phase 5: Local schema retirement

Add forward local migrations after data migration and cutover:

1. First release: rename retired user tables to `retired_*` or restrict access while backups are verified.
2. Final release: drop retired user tables.
3. Keep only allowed metadata/cache tables and temporary operational exception tables.

Do not edit historical migration files.

## Guardrail requirements

The guard script must inspect the final local schema after migrations, not just grep historical SQL.

It should fail for local tables/columns matching user-data patterns unless explicitly allowlisted:

- table names: `app_users`, `profiles`, `profile_groups`, `profile_settings`, `account_settings`, `account_secrets`, `personal_access_tokens`, provider credential/session tables, recommendation/taste/signal tables
- columns: `account_id`, `profile_id`, `user_id`, `app_user_id`, `auth_subject`, `email`, `settings_json`, `secrets_json`, `token_hash`

Allowlist:

- metadata/cache tables with no user ownership
- `schema_migrations`
- temporary operational exception tables listed above

The guard should be added to package scripts and CI once implemented.

## Acceptance criteria

- No durable user/account/profile source-of-truth data remains in local Postgres outside the temporary operational exception.
- Auth bootstrap creates/loads Supabase account/profile rows.
- Profile/account settings use Supabase.
- Secrets, provider credentials, PAT hashes, and account API keys use Supabase private/service-role tables.
- Recommendation outputs and taste profiles use Supabase `reco.*` or successor Supabase tables.
- Local copied signal caches are removed or moved to Supabase.
- Local Postgres schema guard passes.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Supabase advisors are reviewed after schema changes.

## Non-goals

- Do not move TMDB/IMDb metadata caches to Supabase as part of this work.
- Do not allow clients to bypass Fastify for normal app data calls by default.
- Do not expose service-role credentials or private Supabase tables to clients.
- Do not rewrite historical local migrations.
