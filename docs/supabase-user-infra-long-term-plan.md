# Supabase User Infrastructure Migration Long-Term Plan

## Purpose

Track the long-term migration from Crispy-owned user infrastructure to Supabase-owned user state.

This is a planning document only. It defines the target architecture, ownership boundaries, migration phases, risk controls, and completion criteria. The implementation-phase plan lives in `docs/supabase-user-infra-current-phase-plan.md`.

## Strategic decision

Move all user-related product state to Supabase using the industry-standard pattern:

- Supabase Auth owns user identity and sessions.
- Supabase Postgres owns user-owned application state.
- Row Level Security controls all client access.
- Clients use only the Supabase publishable key and the signed-in user's session.
- Backend/VPS services use service-role credentials only from server environments.
- Metadata, AI, provider import, recommendation generation, and long-running jobs stay on VPS services.

This migration is not a 1:1 backend port. The goal is to delete user-state ownership from the current server over time while keeping complex privileged logic on backend services.

## Current architecture summary

The current repo treats Supabase as authentication only. Crispy Server owns:

- account/profile application rows
- account/profile preferences
- watch state
- watch history
- continue watching
- watchlist
- ratings
- provider connections/imports
- recommendation surfaces
- AI settings/secrets
- Redis/BullMQ jobs
- metadata caches/search
- admin tooling

The target architecture changes only the user-state source of truth. It does not move metadata, external-provider logic, AI provider calls, or long-running workers into direct client/Supabase logic.

## Target architecture

### Supabase owns

- Auth users
- App account rows
- Profiles
- Profile membership
- Account preferences
- Profile preferences
- Account entitlements/tier
- Watch events
- Watch history
- Current media state
- Continue watching read model
- Watchlist
- Favorites
- Ratings
- Custom/profile lists
- Recommendation results
- Recommendation feedback
- Home feed cached read model
- Public provider connection status
- Private encrypted provider credentials
- Private encrypted account secrets
- Safe AI settings
- Provider import job status and non-sensitive import summaries

### VPS/backend services own

- TMDB metadata server
- TMDB/IMDb/MDBList caches
- Metadata detail/card/search generation
- Playback resolve logic
- Trakt OAuth and API calls
- Simkl OAuth and API calls
- Provider token refresh
- Provider import normalization
- Destructive sync/reconciliation logic
- Recommendation generation/ranking
- AI search and AI insight execution
- OpenRouter/OpenAI-compatible calls
- Admin tooling
- Workers, cron, queues, lock management, retries
- Internal auditing and operational diagnostics

## Hard rules

1. Clients never receive a service-role key.
2. Clients use only the Supabase publishable key plus the user's Supabase session.
3. Every client-accessible Supabase table has RLS enabled.
4. Private tables can live in Supabase but must have no client read/write policies.
5. User state uses stable media identifiers, not full canonical metadata objects.
6. Metadata remains resolved by the metadata server.
7. Home and recommendation surfaces may store denormalized snapshots because they are read models.
8. History/watch state must remain reconstructable from stable IDs plus user facts.
9. Long-running imports, AI calls, metadata refreshes, and recommendation generation stay on VPS.
10. Migration happens by phases, with dual-write/shadow-read before cutover.

## Canonical identity contract

Use `media_key` as the public and user-state identity everywhere.

Canonical format:

```txt
movie:tmdb:{tmdb_id}
show:tmdb:{tmdb_id}
season:tmdb:{show_tmdb_id}:{season_number}
episode:tmdb:{show_tmdb_id}:{season_number}:{episode_number}
```

Store helper columns where useful:

```txt
media_key
media_type
provider
tmdb_id
show_tmdb_id
season_number
episode_number
```

Rules:

- `media_key` is the stable contract.
- Helper columns are for indexing, filtering, and analytics.
- User-state tables must not depend on unstable titles, slugs, or poster URLs.
- Full metadata objects remain outside canonical user-state tables.

## History and metadata snapshot rule

Watch history should primarily store stable IDs plus watch facts.

Canonical history fields:

```txt
profile_id
media_key
media_type
watched_at
event_type
progress_seconds
duration_seconds
percent_complete
source
client_event_id
created_at
updated_at
```

Optional lightweight display snapshots are allowed:

```txt
title_snapshot
poster_path_snapshot
year_snapshot
metadata_snapshot
```

Snapshot rule:

- Snapshot data is fallback display/cache only.
- Snapshot data is not canonical metadata.
- The metadata server remains authoritative for title, poster, cast, season/episode details, ratings, and search.

## Home feed snapshot rule

Home is allowed to store richer data because it is a cached read model.

Home/feed item snapshots may include:

```txt
title
poster_path
backdrop_path
year
overview
genres
runtime
external_rating
season_number
episode_number
next_episode
reason
score
metadata_version
```

Rules:

- Home data can be denormalized for speed.
- Home data must be regeneratable.
- Home data should have `generated_at` and `expires_at`.
- Stale home data should never become the canonical metadata source.

## Target Supabase schema domains

### Identity and account domain

Tables:

- `accounts`
- `profiles`
- `profile_members`
- `account_preferences`
- `profile_preferences`
- `account_entitlements`

Ownership:

- Supabase Auth owns sign-in identity.
- `accounts.id` should align with `auth.users.id` unless a strong reason emerges not to.
- Profiles are child personas under an account.
- `profile_members` keeps shared/family profile support open.

Client access:

- Users can read their own account.
- Users can update safe account fields.
- Users can read profiles where they are members.
- Owners can create/update/delete profiles according to product limits.
- Users can read their own entitlement.
- Clients cannot update tier/entitlement directly.

Service access:

- Service role can bootstrap, repair, admin-update, and backfill.

### User media state domain

Tables:

- `profile_media_state`
- `watch_events`
- `watch_history`
- `continue_watching_items`

Purpose:

- `watch_events` is append-only input/audit.
- `profile_media_state` is current per-profile/per-media state.
- `watch_history` is user-facing watched-history feed.
- `continue_watching_items` is a fast read model for clients/home.

State fields:

```txt
watch_status
progress_seconds
duration_seconds
percent_complete
last_watched_at
completed_at
in_watchlist
watchlist_added_at
is_favorite
favorited_at
rating
rated_at
hidden_from_continue_watching
last_event_at
created_at
updated_at
```

Client access:

- Profile members can read state/history for profiles they can access.
- Allowed roles can insert watch events.
- Allowed roles can update watchlist/favorite/rating/progress state.
- Clients should not be able to mutate another account's profile state.

Service access:

- Provider import service can insert imported watch events and update projections.
- Recommender can read signals.
- Admin/backfill services can repair data.

### Lists and ratings domain

Tables:

- `profile_lists`
- `profile_list_items`
- `profile_ratings`

Purpose:

- Support built-in lists such as watchlist/favorites.
- Support custom ordered lists later.
- Keep rating history/metadata separate from current state where useful.

Recommended mirror:

- Store canonical list/rating rows.
- Mirror common current values into `profile_media_state` for fast detail-page lookup.

### Recommendation domain

Tables:

- `recommendation_runs`
- `recommendation_lists`
- `recommendation_items`
- `recommendation_feedback`

Flow:

1. Recommender service reads user signals from Supabase using service role.
2. Recommender generates ranked results.
3. Recommender writes result lists/items to Supabase.
4. Clients read recommendation surfaces directly from Supabase through RLS.
5. Feedback writes go to Supabase and become future recommender input.

### Home feed domain

Tables:

- `home_feeds`
- `home_sections`
- `home_items`

Purpose:

- Store fast, denormalized, profile-specific home surfaces.
- Allow rich display snapshots.
- Avoid forcing every home load to call multiple backend services.

Generation ownership:

- Prefer VPS generation because home depends on metadata, watch state, recommendations, and ranking.
- Supabase stores the result.
- Edge Functions may be used only for small, bounded maintenance tasks if needed.

### Provider integration domain

Tables:

- `provider_connections`
- `provider_credentials_private`
- `provider_import_jobs`
- `provider_import_events`

Client-readable:

- Provider connection status.
- Provider username/avatar.
- Sync enabled flag.
- Last sync timestamp.
- Last non-sensitive error status.

Service-only:

- Access tokens.
- Refresh tokens.
- Token expiry.
- Token scopes.
- Raw provider payloads if retained.
- Import locks and retry metadata.

Flow:

1. Client starts connect/import from app.
2. VPS handles OAuth redirect/callback.
3. VPS encrypts credentials.
4. VPS writes credentials to private Supabase table.
5. VPS writes public status to provider connection table.
6. VPS imports provider data and writes normalized user state into Supabase.

### AI and secrets domain

Tables:

- `account_ai_settings`
- `account_secrets_private`

Client-readable/writeable safe settings:

- AI enabled flag.
- Preferred model.
- Key mode.
- Boolean secret presence such as `has_openrouter_key`.

Service-only secrets:

- OpenRouter BYOK secret.
- MDBList key.
- Any future account-level API secret.

Flow:

1. Client sends new secret to a trusted backend endpoint.
2. Backend verifies Supabase JWT.
3. Backend encrypts and stores the secret in Supabase private table.
4. Client can later see only presence/status, never the secret value.

## RLS strategy

### Helper concepts

Most policies should reduce to one of these checks:

```txt
auth.uid() = account_id
```

or:

```txt
auth.uid() is a member of profile_id
```

Use SQL helper functions for profile membership checks to avoid duplicating complex policy logic.

### Policy classes

#### Account-owned rows

Examples:

- `accounts`
- `account_preferences`
- `account_ai_settings`

Policy:

- User can select own rows.
- User can update safe own rows.
- User cannot update privileged fields.

#### Profile-owned rows

Examples:

- `profile_media_state`
- `watch_history`
- `profile_lists`
- `home_items`
- `recommendation_feedback`

Policy:

- Profile member can select rows.
- Owner/member role can insert/update according to product role.
- Viewer role can be read-only if sharing is added.

#### Entitlement rows

Policy:

- User can select own entitlement.
- Client cannot insert/update/delete.
- Service role/admin only writes.

#### Private service tables

Examples:

- `provider_credentials_private`
- `account_secrets_private`
- `admin_audit_logs`
- `internal_jobs`

Policy:

- RLS enabled.
- No client policies.
- Service role only.

## Backend service changes

### Metadata service

Target behavior:

- Verifies Supabase JWT on personalized requests.
- Checks profile access through Supabase when needed.
- Resolves `media_key` to metadata.
- Returns metadata details/cards/search results.
- Does not own user watch/list/rating state.

### Integration service

Target behavior:

- Owns Trakt/Simkl OAuth.
- Reads/writes provider credentials in Supabase private tables.
- Refreshes tokens server-side.
- Imports provider data.
- Writes normalized user-state rows into Supabase.
- Updates public provider connection status.

### Recommendation service

Target behavior:

- Reads Supabase user signals with service role.
- Writes recommendation results to Supabase.
- Optionally writes home sections/items.
- Owns algorithm versions, run records, and generation jobs.

### AI service

Target behavior:

- Verifies Supabase JWT.
- Reads entitlement and safe AI settings from Supabase.
- Reads/decrypts private BYOK secrets server-side if needed.
- Uses server OpenRouter key only from VPS environment.
- Never returns secret values to client.

### Admin/ops service

Target behavior:

- Uses service role.
- Can inspect/repair user-state rows.
- Can trigger backfills/rebuilds.
- Can inspect private operational status.
- Stays private and separate from client RLS paths.

## Migration phases

### Phase 0: contract freeze

Status: pending

Checklist:

- [ ] Confirm canonical `media_key` formats.
- [ ] Confirm `media_type` enum values.
- [ ] Confirm rating scale.
- [ ] Confirm watch event types.
- [ ] Confirm watch completion threshold.
- [ ] Confirm profile/member role model.
- [ ] Confirm provider enum values.
- [ ] Confirm AI tier/key-mode semantics.
- [ ] Confirm home feed section model.
- [ ] Confirm what data is snapshot vs canonical.

Completion criteria:

- Schema contract can be implemented without revisiting foundational identity choices.

### Phase 1: Supabase foundation

Status: pending

Checklist:

- [ ] Create Supabase development branch.
- [ ] Create base account/profile/preference/entitlement schema.
- [ ] Create profile membership helper functions.
- [ ] Enable RLS on all new tables.
- [ ] Add account/profile policies.
- [ ] Add initial indexes and constraints.
- [ ] Run Supabase security advisors.
- [ ] Run Supabase performance advisors.
- [ ] Generate TypeScript types.
- [ ] Validate publishable-key access manually.
- [ ] Validate service-role access manually.

Completion criteria:

- Supabase can safely own account/profile identity rows in development.

### Phase 2: media state schema

Status: pending

Checklist:

- [ ] Add `profile_media_state`.
- [ ] Add `watch_events`.
- [ ] Add `watch_history`.
- [ ] Add `continue_watching_items`.
- [ ] Add list/rating tables.
- [ ] Add RLS for profile-owned media rows.
- [ ] Add indexes for feed/list/detail reads.
- [ ] Add uniqueness constraints.
- [ ] Add minimal projection triggers/functions if appropriate.
- [ ] Generate TypeScript types.
- [ ] Run advisors.

Completion criteria:

- Supabase can represent all core watch/list/rating user state.

### Phase 3: read models and recommendation/home schema

Status: pending

Checklist:

- [ ] Add recommendation run/list/item/feedback tables.
- [ ] Add home feed/section/item tables.
- [ ] Add RLS policies.
- [ ] Add ordering/rank indexes.
- [ ] Add expiration/version fields.
- [ ] Generate TypeScript types.
- [ ] Run advisors.

Completion criteria:

- Supabase can serve recommendation and home feed surfaces directly to clients.

### Phase 4: provider and secrets schema

Status: pending

Checklist:

- [ ] Add public provider connection table.
- [ ] Add private provider credentials table.
- [ ] Add provider import job/status tables.
- [ ] Add safe AI settings table.
- [ ] Add private account secrets table.
- [ ] Add service-only policies.
- [ ] Validate clients cannot read private rows.
- [ ] Validate service role can read/write private rows.
- [ ] Generate TypeScript types.
- [ ] Run advisors.

Completion criteria:

- Supabase can store user-related provider and secret data without exposing it to clients.

### Phase 5: backfill design

Status: pending

Checklist:

- [ ] Map old account rows to Supabase accounts.
- [ ] Map old profiles/groups to profiles/members.
- [ ] Map old preferences to Supabase preferences.
- [ ] Map old watch state to `profile_media_state`.
- [ ] Map old history to `watch_history` and/or `watch_events`.
- [ ] Map old watchlist/favorites/ratings.
- [ ] Map old recommendation results.
- [ ] Map old provider connection status.
- [ ] Map encrypted provider tokens/secrets.
- [ ] Define idempotent backfill scripts.
- [ ] Define row-count comparison queries.
- [ ] Define rollback plan.

Completion criteria:

- Backfill can be run repeatedly and verified safely.

### Phase 6: dual-write

Status: pending

Checklist:

- [ ] Dual-write profile changes.
- [ ] Dual-write preferences.
- [ ] Dual-write watch events.
- [ ] Dual-write watchlist/favorites.
- [ ] Dual-write ratings.
- [ ] Dual-write provider import results.
- [ ] Dual-write recommendation outputs.
- [ ] Log dual-write failures.
- [ ] Add reconciliation reports.

Completion criteria:

- Supabase remains in sync with old source of truth for selected domains.

### Phase 7: shadow reads

Status: pending

Checklist:

- [ ] Compare old vs Supabase profile reads.
- [ ] Compare old vs Supabase watchlist reads.
- [ ] Compare old vs Supabase rating reads.
- [ ] Compare old vs Supabase history reads.
- [ ] Compare old vs Supabase continue watching reads.
- [ ] Compare old vs Supabase recommendation reads.
- [ ] Compare old vs Supabase home reads.
- [ ] Track mismatch rates.
- [ ] Fix mismatch causes before client cutover.

Completion criteria:

- Supabase read results match existing production behavior within accepted tolerance.

### Phase 8: client read cutover

Status: pending

Checklist:

- [ ] Move account/profile reads to Supabase.
- [ ] Move preference reads to Supabase.
- [ ] Move watchlist reads to Supabase.
- [ ] Move rating reads to Supabase.
- [ ] Move history reads to Supabase.
- [ ] Move continue watching reads to Supabase.
- [ ] Move recommendation reads to Supabase.
- [ ] Move home reads to Supabase.
- [ ] Keep rollback flags per surface.

Completion criteria:

- Clients can read user state directly from Supabase using publishable key and RLS.

### Phase 9: client write cutover

Status: pending

Checklist:

- [ ] Move safe preference writes to Supabase.
- [ ] Move profile create/update writes to Supabase.
- [ ] Move watchlist/favorite writes to Supabase.
- [ ] Move rating writes to Supabase.
- [ ] Move progress/watch event writes to Supabase.
- [ ] Move mark watched/unwatched writes to Supabase.
- [ ] Move recommendation feedback writes to Supabase.
- [ ] Move provider safe setting writes to Supabase.
- [ ] Add debouncing for progress writes.
- [ ] Monitor write volume and policy performance.

Completion criteria:

- Clients can write normal user state directly to Supabase.

### Phase 10: backend service rewiring

Status: pending

Checklist:

- [ ] Metadata service reads profile access from Supabase when needed.
- [ ] Integration service stores provider credentials in Supabase.
- [ ] Integration service writes imports to Supabase user-state tables.
- [ ] Recommendation service reads signals from Supabase.
- [ ] Recommendation service writes results to Supabase.
- [ ] AI service reads entitlements/settings/secrets from Supabase.
- [ ] Admin service reads/repairs Supabase user state.

Completion criteria:

- Backend services treat Supabase as the user-state source of truth.

### Phase 11: old ownership deprecation

Status: pending

Checklist:

- [ ] Stop old user-state writes.
- [ ] Keep old DB read-only for safety window.
- [ ] Export backups.
- [ ] Remove obsolete endpoints gradually.
- [ ] Remove obsolete local tables only after stable period.
- [ ] Update README/architecture docs.
- [ ] Update OpenAPI contracts where API surfaces change.

Completion criteria:

- Crispy Server no longer owns user-state persistence.

## Supabase MCP workflow

Use Supabase MCP for database work:

1. List current Supabase tables.
2. Create a development branch.
3. Apply small migrations.
4. Run security advisors after RLS changes.
5. Run performance advisors after indexes/query patterns.
6. Generate TypeScript types after stable schema changes.
7. Validate publishable-key access paths.
8. Validate service-role access paths.
9. Merge branch only after policies and advisors are clean or intentionally accepted.

## Indexing principles

Required high-value indexes:

```txt
profile_media_state(profile_id, media_key)
profile_media_state(profile_id, last_watched_at desc)
profile_media_state(profile_id, in_watchlist)
profile_media_state(profile_id, is_favorite)
profile_media_state(profile_id, rating)
watch_history(profile_id, watched_at desc)
watch_events(profile_id, created_at desc)
profile_list_items(profile_id, list_id, rank)
profile_ratings(profile_id, rated_at desc)
recommendation_items(profile_id, list_id, rank)
home_sections(profile_id, rank)
home_items(profile_id, section_id, rank)
provider_connections(profile_id, provider)
```

Required uniqueness constraints:

```txt
profile_media_state(profile_id, media_key)
profile_ratings(profile_id, media_key)
provider_connections(profile_id, provider)
provider_credentials_private(profile_id, provider)
```

## Operational risks

### RLS mistakes

Risk:

- Data leak or blocked legitimate access.

Mitigation:

- Start in Supabase branch.
- Write policy tests.
- Manually test publishable-key access.
- Run security advisors.
- Keep private tables with no client policies.

### Write amplification

Risk:

- Progress writes overwhelm DB or create noisy history.

Mitigation:

- Debounce progress writes.
- Insert meaningful events only.
- Use current-state upserts for progress.
- Batch where appropriate.

### Dual-write inconsistency

Risk:

- Old DB and Supabase diverge.

Mitigation:

- Idempotent writes.
- Reconciliation reports.
- Shadow reads.
- Feature flags.
- Backfill/replay capability.

### Metadata snapshot staleness

Risk:

- Home/history snapshots become outdated.

Mitigation:

- Treat snapshots as cache only.
- Include `generated_at`, `expires_at`, and `metadata_version`.
- Resolve canonical details from metadata server.

### Secret exposure

Risk:

- Provider tokens or AI keys become client-readable.

Mitigation:

- Private tables with no client policies.
- Encrypted values only.
- Backend-only writes for secret values.
- Client sees only safe status booleans.

## Final success criteria

The migration is complete when:

- Clients use only Supabase publishable key and Supabase session for normal user-state reads/writes.
- Supabase is the source of truth for account/profile/watch/list/rating/history/reco/home/provider-status/secret metadata.
- VPS services use service role for privileged user-state access.
- Metadata remains backend-owned and canonical.
- Provider imports write normalized user state into Supabase.
- Recommender reads signals from Supabase and writes results to Supabase.
- AI service reads entitlements/secrets from Supabase and never exposes keys.
- Old local user-state tables are no longer written.
- RLS and advisors are clean or documented.
