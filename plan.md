# Watch Domain Cleanup Implementation Plan

Status: implemented.

This file records the final watch-domain architecture that replaced the earlier mixed watch-history/resume model.

## Final model

- `watch_events` is the durable chronological history ledger.
- `playback_progress` is only active resume state.
- `media_watch_summary` is the derived watched-state projection.
- Client apps call Fastify intent-based APIs and do not need to know table storage details.
- Provider imports are source metadata on product facts, not a product event type.

## `watch_events`

Purpose: immutable history ledger.

Current product event types:

- `playback_completed`
- `marked_watched`
- `marked_unwatched`

Rules:

- Completion creates a new row every time, including rewatches.
- Manual mark watched creates a row but does not count as playback.
- Manual unwatch creates a row that can make effective watched state false.
- Provider imports write `playback_completed` rows with `source_kind = 'provider_import'` and `source_provider` metadata.
- In-progress playback ticks are not inserted here.

## `playback_progress`

Purpose: active resume state only.

Rules:

- One active row per `profile_id + title_media_key`.
- Incomplete playback upserts here.
- Completed playback deletes the matching active row.
- Manual mark watched deletes the matching active row.
- Dismiss continue watching hides the active row from continue-watching lists.
- This table is not history and must not be used to answer watched badges.

## `media_watch_summary`

Purpose: fast watched-state projection.

Rules:

- Rebuildable from `watch_events`.
- Powers watched badges, show watched episode keys, `play_count`, and latest watched/unwatched timestamps.
- `play_count` counts only `playback_completed` events.
- Effective watched state is based on the latest watched-state event for the media key.

## Runtime APIs and RPCs

User routes under `/v1/profiles/:profileId/watch/**` call Supabase user RPCs through Fastify with the user's Supabase access token.

Important RPCs:

- `record_playback_state(...)`
- `set_profile_watched_state(...)`
- `dismiss_continue_watching(...)`
- `get_profile_watch_state(...)`
- `list_continue_watching_page(...)`
- `list_watch_history_page(...)`
- `list_media_watch_history_page(...)`

Provider import uses trusted service-role RPCs:

- `replace_provider_import_history(...)`
- `replace_provider_import_playback_states(...)`
- `replace_provider_import_list_items(...)`
- `replace_provider_import_ratings(...)`

## Verification completed

- Old watch-state tables were removed from Supabase.
- Provider import event rows were normalized to product events with provider source metadata.
- Watch summaries were rebuilt from `watch_events`.
- Bob's Burgers watched episode aggregation was verified for the active profile with 441 watched episodes.
- Targeted watch route/enrichment tests pass.
- `npm run typecheck` and `npm run build` pass.

## Source files

- Supabase migration: `supabase/migrations/20260515120000_finalize_watch_domain_cleanup.sql`
- Watch routes: `src/http/routes/watch.ts`
- Watch contracts: `src/http/contracts/watch.ts`
- User Supabase watch service: `src/modules/integrations/supabase-user-watch.service.ts`
- Admin watch read service: `src/modules/integrations/supabase-admin-watch-read.service.ts`
- Supabase watch mapper: `src/modules/integrations/supabase-watch-read.mapper.ts`
- Watch derived item types: `src/modules/watch/watch-derived-item.types.ts`
- Calendar watched state: `src/modules/calendar/calendar-builder.service.ts`
- Client guidance: `docs/api/media-state.md`
- Architecture guidance: `docs/supabase-fastify-rls-target-architecture-plan.md`
