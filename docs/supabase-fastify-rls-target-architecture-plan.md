# Supabase, Fastify, and RLS Architecture

This document describes the current Supabase/Fastify/RLS architecture for Crispy user data. The detailed migration spec for removing durable user data from local Postgres is `docs/specs/user-data-supabase-residency.md`.

## Source of truth

- Fastify remains the client API boundary.
- Supabase Auth is the user session authority.
- Supabase Postgres/RPC/RLS stores durable user/account/profile-scoped data behind Fastify.
- This includes accounts, profiles, preferences, secrets/token metadata, provider integration state, watch/list/rating/progress state, recommendation outputs, taste profiles, and copied profile signals.
- Local Postgres is metadata/cache-only, except temporary explicitly allowlisted operational outbox/admin delivery state.
- Clients should not call Supabase user-state tables or RPCs directly by default.
- Fastify forwards the original Supabase user access token to user-scoped Supabase RPC/Data API calls so RLS applies.
- Supabase service-role access is server-only and limited to trusted backend jobs: provider imports, admin repair, controlled backfills, and auth admin tasks.

## User data residency

Durable user/account/profile-scoped data belongs in Supabase, not local Postgres. Local Postgres may store metadata/cache tables and, for now, explicitly allowlisted operational delivery/admin state such as `service_outbox_events` and `admin_bulk_jobs*`.

Forbidden local source-of-truth data includes account/profile identity, settings, preferences, secrets, PATs, provider credentials, watch/list/rating/progress state, recommendation outputs, taste profiles, and copied profile signals.

See `docs/specs/user-data-supabase-residency.md` for the migration plan, guardrail requirements, and acceptance criteria.

## Identity

All watch/list/rating user-state rows use canonical `media_key` values:

```text
movie:tmdb:{tmdb_id}
show:tmdb:{tmdb_id}
season:tmdb:{show_tmdb_id}:{season_number}
episode:tmdb:{show_tmdb_id}:{season_number}:{episode_number}
person:tmdb:{tmdb_id}
```

Rules:

- `media_type` is derived from or validated against `media_key`.
- TMDB-backed `mediaKey` is canonical for navigation and watch-domain operations.
- Trakt, Simkl, TVDB, Kitsu, IMDb, and provider-local ids are import/crosswalk metadata only.
- Provider imports normalize into Crispy product facts using canonical `mediaKey` values.

## Watch-domain storage model

### `watch_events`

Durable chronological watch ledger.

Stores user-visible watched-history facts:

- `playback_completed`
- `marked_watched`
- `marked_unwatched`

Rules:

- Every completed playback creates a row, including rewatches.
- Manual mark watched creates a row but does not imply playback count unless product rules explicitly change.
- Manual unwatch creates a row that can make current watched state false.
- Provider import is represented as `source_kind = 'provider_import'`, not as an event type.
- High-frequency in-progress playback ticks do not belong here.

### `playback_progress`

Current active resume state only.

Rules:

- One active row per `(profile_id, title_media_key)`.
- Incomplete playback upserts this table.
- Completion removes the matching active resume row.
- Manual mark watched removes the matching active resume row.
- Dismiss continue watching hides the active resume row from continue-watching lists.
- This table is not watched history and must not power watched badges.

### `media_watch_summary`

Derived watched-state projection per profile and playable media key.

Rules:

- Rebuildable from `watch_events`.
- Powers watched badges, show watched episode keys, play counts, and last watched/unwatched timestamps.
- `play_count` counts `playback_completed` events.
- Effective watched state is decided by the latest watched-state event.

### List and rating tables

- `profile_list_items` stores watchlist/favorites/custom list facts.
- `profile_ratings` stores rating facts.
- Provider import metadata is tracked through `provider_import_batches` and source fields on imported facts.

## User RPC contract

User-scoped RPCs are called with a Supabase user JWT and must verify `auth.uid()` plus profile membership internally.

Current watch/read RPCs:

- `record_playback_state(...)`
- `dismiss_continue_watching(p_profile_id, p_title_media_key)`
- `set_profile_watched_state(...)`
- `get_profile_watch_state(p_profile_id, p_media_keys[])`
- `list_continue_watching_page(...)`
- `list_watch_history_page(...)`
- `list_media_watch_history_page(...)`
- `list_profile_list_items_page(...)`
- `list_profile_ratings_page(...)`

RPC rules:

- Anonymous callers are denied.
- Profile access is checked inside the RPC/RLS boundary.
- Limits are bounded and cursors are stable.
- Route success must mean the intended Supabase operation succeeded.
- Fastify must not silently fall back to service-role writes for normal user routes.

## Trusted service-role RPCs

Provider import and admin repair are trusted backend operations.

Current provider import RPCs:

- `replace_provider_import_history(...)`
- `replace_provider_import_playback_states(...)`
- `replace_provider_import_list_items(...)`
- `replace_provider_import_ratings(...)`

Rules:

- Executable by service role only.
- Validate explicit account/profile/import scope.
- Replace provider-owned facts without deleting user-local facts.
- Use `source_kind = 'provider_import'` and `source_provider` metadata.
- Never expose provider tokens or secrets to user-accessible tables.

## Fastify route behavior

Public user watch routes live under `/v1/profiles/:profileId/watch/**` and call Supabase through `SupabaseUserWatchService` with the user's access token.

Behavior by product intent:

- playback progress: updates active resume state; completed playback records history and clears resume state.
- continue watching: reads active resume rows.
- watch history: reads chronological `watch_events`; rewatches are preserved.
- media-specific history: filters chronological history by movie/episode/show title media key.
- watched state: reads `media_watch_summary` and active progress/list/rating context.
- watched episode keys: derived from `media_watch_summary` for requested show keys.
- calendar watched flags: read watched state from `media_watch_summary`.
- provider imports: write canonical product facts through service-role RPCs.

## PAT policy

Personal access tokens do not carry a Supabase Auth user JWT.

Default behavior:

- Supabase user-state routes require a user session access token.
- PAT callers are rejected unless a route has a separately approved trusted-relay design.
- Fastify must not swap PAT calls to service-role Supabase access for normal user-state routes.

## Security rules

- User-accessible tables use RLS.
- User RPCs require `auth.uid()` and profile membership checks.
- Service-role usage is isolated to trusted backend modules.
- SECURITY DEFINER functions use fixed `search_path`.
- Supabase service-role keys are never logged, returned, documented for clients, or included in OpenAPI examples.

## Verification

Run after watch-domain code or SQL changes:

```bash
npm run typecheck
npm run build
node --import tsx --test "src/http/routes/watch.test.ts" "src/modules/watch/watch-supabase-enrichment.service.test.ts"
```

For Supabase DDL/RLS/RPC changes:

- apply the migration to a Supabase branch or controlled target.
- verify expected tables, functions, grants, and constraints.
- run Supabase security and performance advisors.
- verify watched episode aggregation for shows and chronological history pagination.

## Documentation ownership

- `architecture.md` owns high-level system architecture.
- `docs/api/media-state.md` owns client-facing media identity and watch-state behavior.
- `openapi/*.yaml` owns exact HTTP schemas.
- `supabase/migrations/*.sql` owns Supabase schema/RPC/RLS history.
