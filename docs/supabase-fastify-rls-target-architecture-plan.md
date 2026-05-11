# Supabase + Fastify RLS Target Architecture Migration Spec

Status: canonical target architecture and implementation plan. This file supersedes the deleted historical Supabase planning files:

- `docs/supabase-watch-read-cutover-plan.md`
- `docs/supabase-history-hydration-plan.md`
- `docs/supabase-user-infra-current-phase-plan.md`
- `docs/supabase-user-infra-long-term-plan.md`

Audience: LLM implementation agents. Optimize for correctness, explicit constraints, and safe execution over human readability.

## 0. One-sentence architecture decision

Use Supabase Auth directly from clients for login/session, keep Fastify as the only default application data API, and have Fastify call Supabase Postgres/RPC/Data API with the end user's Supabase access token so Supabase RLS enforces user/profile authorization; use `service_role` only inside audited trusted backend jobs/admin/import/recommendation paths that cannot have a user JWT.

## 1. Non-negotiable invariants

1. Clients may call Supabase Auth directly.
2. Clients must not receive `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, database URLs, provider tokens, AI keys, or server-to-server credentials.
3. Default client data path is always `Client -> Fastify -> Supabase user-scoped RPC/Data API -> RLS`.
4. No browser/mobile direct Supabase table/RPC data access is allowed by default, even if RLS exists.
5. A future direct client-to-Supabase data path is allowed only as a narrow, documented exception after RLS tests, API contract review, rate-limit/abuse review, and architecture approval.
6. Public/user Fastify routes that operate on user/profile data must pass the original Supabase access token to Supabase user-scoped clients/RPCs whenever available.
7. User-scoped Supabase clients use `SUPABASE_PUBLISHABLE_KEY` plus `Authorization: Bearer <user access token>`.
8. User-scoped Supabase calls must rely on RLS and/or invoker-safe RPCs, not backend-only trust.
9. `service_role` bypasses RLS. Treat any `service_role` usage as privileged root access.
10. `service_role` is allowed only for trusted server contexts: provider imports/backfills, metadata snapshot writers, admin repair jobs, account deletion against Auth admin APIs, recommendation/background source-data jobs where no user JWT exists, and controlled migrations/tests.
11. `service_role` must never be used merely to avoid writing RLS policies for normal user routes.
12. RLS, grants, helper functions, and RPC definitions are schema code. They must be versioned, reviewed, tested, and deployed through migrations.
13. Supabase project schema must be reproducible from checked-in files. Dashboard-only schema/RLS edits are not acceptable as the durable source of truth.
14. Fastify remains responsible for API shape, request validation, response shaping, logging, observability, rate limits, compatibility, backend orchestration, provider integrations, AI/vendor calls, admin APIs, queues, and recommendation integration.
15. Supabase owns the target user interaction state persistence and authorization substrate for watch/list/rating/history/playback/provider-import interaction facts.
16. Metadata authority remains the backend metadata system. Supabase user tables store stable media keys and optional disposable read snapshots, not full canonical metadata authority.
17. Recommendation generation reads clean user interaction signals through Fastify-controlled internal APIs or audited trusted backend readers. The external recommendation engine must not read Supabase directly unless a future explicit service contract says so.
18. Local Postgres migrations under `migrations/` remain local Crispy Postgres migrations unless explicitly moved. Supabase migrations must live in a clearly separate location such as `supabase/migrations/`.
19. Do not rewrite historical migrations. Add forward migrations.
20. Do not silently accept failed Supabase writes in public routes unless the endpoint is explicitly documented as best-effort and emits observable failure telemetry.

## 2. Glossary

- Client: web/mobile/desktop app.
- Fastify/API server/Main/Crispy Server: this repository's HTTP API and internal backend runtime.
- Supabase Auth: identity provider issuing JWTs and sessions.
- Supabase Postgres: managed Postgres used for target user interaction state.
- Supabase Data API/RPC: PostgREST/RPC access using publishable key or service role.
- User JWT: Supabase access token for the signed-in account.
- Publishable key: client-safe Supabase key used with RLS and user JWT.
- Service role: server-only Supabase key that bypasses RLS.
- RLS: Postgres Row Level Security policies in Supabase.
- User path: request initiated by an authenticated end user through Fastify public `/v1/**` APIs.
- Trusted backend path: jobs/admin/import/reco/internal path authenticated by server credentials, not an end-user session.
- Profile: persona under an account; profiles are not separate auth actors.
- `mediaKey`: canonical public user-state media identity.

## 3. Target request flows

### 3.1 Login/session flow

1. Client uses Supabase Auth SDK or Supabase Auth HTTP endpoints to sign in/sign out/refresh session.
2. Client stores Supabase session using client-platform-safe storage.
3. Client calls Fastify APIs with `Authorization: Bearer <supabase access token>`.
4. Fastify verifies JWT using Supabase JWKS/issuer/audience fallback logic.
5. Fastify stores the original access token in request auth context for downstream user-scoped Supabase calls.

Current code anchors:

- `src/lib/jwks.ts` verifies Supabase JWTs.
- `src/http/plugins/auth.ts` stores `request.auth.accessToken` for bearer sessions.
- `src/config/env.ts` parses Supabase URL, publishable key, and optional admin key.

### 3.2 Normal user data flow

```text
Client
  -> Fastify /v1/** with Supabase bearer token
  -> Fastify validates route params/body/profile target
  -> Fastify creates Supabase user client with publishable key + original JWT
  -> Fastify calls RLS-backed RPC/Data API
  -> Supabase evaluates auth.uid(), grants, RLS, helper functions
  -> Fastify maps result/error to stable API response
  -> Client receives Fastify response only
```

Rules:

- The client does not call Supabase data APIs directly.
- Fastify must not swap the user JWT for service role on this path.
- Route `profileId` is untrusted input until Fastify and/or Supabase RLS confirms membership.
- Supabase RPCs must independently validate profile membership using `auth.uid()`/RLS helpers.
- Public route success should mean the Supabase operation succeeded unless documented otherwise.

Current code anchors needing hardening:

- `src/lib/supabase.ts` already has `createSupabaseUserClient(accessToken)`.
- `src/http/routes/watch.ts` passes `request.auth.accessToken` into `SupabaseUserWatchService` for most watch routes.
- `src/modules/integrations/supabase-user-watch.service.ts` calls user-scoped RPCs.
- Some mutation errors currently become `{ success: false }` but public routes still return accepted success. Fix this.

### 3.3 Trusted backend flow

```text
Internal job/admin/import/reco path
  -> Fastify/internal worker authenticates the trusted caller or job
  -> Fastify explicitly authorizes operation scope
  -> Fastify uses service-role client only in a narrow module
  -> Supabase privileged RPC/table operation runs
  -> Fastify logs/audits result without leaking secrets
```

Allowed examples:

- Supabase Auth admin user deletion.
- Provider import history replacement from Trakt/Simkl import worker.
- Metadata card snapshot upsert/backfill.
- Admin repair/backfill jobs.
- Recommendation source-data/background jobs where no user JWT exists and the path is service-authenticated.

Forbidden examples:

- Public watchlist/rating/history/playback mutation using service role to bypass RLS.
- Client-provided account/profile IDs passed to service-role RPC without Fastify authorization.
- Any service-role key in browser code, mobile code, logs, OpenAPI examples, generated docs, or responses.

Current code anchors:

- `src/lib/supabase.ts` has `getSupabaseServiceRoleClient()`.
- `src/modules/auth/external-auth-admin.service.ts` uses Supabase admin key for auth deletion.
- `src/modules/integrations/provider-import.service.ts` uses service role for provider import history when configured.
- `src/modules/integrations/supabase-provider-history-writer.ts` writes provider import history through service-role RPC.
- `src/modules/integrations/supabase-watch-writer.ts` contains service-role-style writers and must not become the normal public user write path.

## 4. Ownership matrix

| Domain | Target owner | Access pattern | Notes |
| --- | --- | --- | --- |
| User identity/session | Supabase Auth | Client direct Auth, Fastify JWT verify | Auth only direct client integration is allowed. |
| Account/profile membership needed for RLS | Supabase Postgres, mirrored/backfilled from current model during transition | User JWT + RLS; service role for bootstrap/backfill | `auth.uid()` is account root. Profiles are personas. |
| Public API shape | Fastify | Client calls Fastify | OpenAPI remains HTTP contract source. |
| Watch playback state | Supabase Postgres | Fastify user JWT -> RPC/RLS | No service role in public route. |
| Continue watching | Supabase Postgres | Fastify user JWT -> RPC/RLS | API may hydrate metadata through Fastify. |
| Watch history | Supabase Postgres | Fastify user JWT -> RPC/RLS; service role for provider imports | Lean facts by `mediaKey`. |
| Watchlist/favorites/custom list facts | Supabase Postgres | Fastify user JWT -> RPC/RLS | Use canonical `mediaKey`. |
| Ratings | Supabase Postgres | Fastify user JWT -> RPC/RLS | User/profile-scoped. |
| Provider import interaction facts | Supabase Postgres | Service role from trusted import worker | Imported history facts, batch metadata, non-secret summaries. |
| Provider OAuth tokens/refresh calls | Fastify/backend | Server-only local secret handling | Do not expose to Supabase client path. |
| AI/BYOK/server-funded keys | Fastify/backend | Server-only | Never to RECO/client/Supabase public tables. |
| Metadata authority/cache | Fastify/backend local Postgres/cache | Fastify APIs/workers | Supabase can store disposable card snapshots only. |
| Recommendation generation | External RECO + Fastify contract | RECO calls Fastify internal APIs | RECO must not read DB/Supabase directly by default. |
| Recommendation stored outputs | Fastify API-owned contract; storage can be phased | Internal writes through Fastify | If moved to Supabase, add separate RLS/RPC plan. |
| Admin/ops | Fastify/backend | Admin UI/API + service role where required | Audited privileged path. |
| Queues/jobs/outbox | Fastify/backend local Postgres/Redis/BullMQ | Server-only | Supabase does not replace queues by default. |

## 5. Current known deltas from target

These were observed in the repo and must be resolved during migration.

1. `README.md`, `architecture.md`, and `AGENT.md` historically said Supabase is auth-only. That is no longer the target and also conflicts with current watch Supabase code.
2. Checked-in `/migrations` appear to be local Crispy Postgres migrations, not Supabase schema/RLS migrations.
3. No durable checked-in Supabase RLS/RPC migration set was found for current Supabase user-media tables.
4. `src/http/routes/watch.ts` mostly uses `SupabaseUserWatchService`, but `mark-watched`/`unmark-watched` still use local `WatchEventIngestService`.
5. Some `SupabaseUserWatchService` mutation methods convert RPC errors into `{ success: false }`; route handlers ignore that and return accepted/success.
6. PAT auth sets `request.auth.accessToken = null`, so PAT requests cannot use user-scoped Supabase RLS paths unless a new trusted relay design is implemented.
7. `src/modules/integrations/supabase-watch-writer.ts` contains service-role direct table writers and must be audited/retired or constrained to trusted jobs only.
8. Recommendation docs say Crispy API owns all watch/rating data. Target wording should be Fastify owns API/business access; Supabase owns persistence for user interaction signals where cut over.

## 6. Target repository documentation state

Required docs after this cleanup:

1. Keep this file as the detailed migration spec.
2. `architecture.md` must say the target/transition architecture is Supabase Auth + Supabase user-state persistence behind Fastify, not auth-only.
3. `README.md` must state the same high-level stack.
4. `AGENT.md` must instruct future agents not to regress to auth-only language.
5. `docs/architecture/recommendation-engine.md` must say RECO goes through Fastify and does not read Supabase directly.
6. Do not recreate old phase-specific Supabase docs unless the new doc is narrowly scoped and references this file as canonical.

## 7. Supabase schema source-of-truth requirements

Create a dedicated Supabase schema area before making further Supabase DDL changes.

Recommended layout:

```text
supabase/
  migrations/
    YYYYMMDDHHMMSS_user_state_foundation.sql
    YYYYMMDDHHMMSS_user_watch_rpc.sql
    YYYYMMDDHHMMSS_provider_import_rpc.sql
  tests/
    rls-user-isolation.sql
    rls-profile-membership.sql
    rpc-user-watch.sql
  README.md
```

Rules:

- `supabase/migrations/` defines Supabase project DDL, RLS, functions, grants, policies, indexes, and RPCs.
- `migrations/` remains local Crispy Postgres DDL unless a future explicit migration moves it.
- Every table reachable by authenticated users must have RLS enabled before exposing it.
- Every RLS helper must have a fixed `search_path`.
- Prefer `security invoker` for user-visible RPCs unless a `security definer` helper is required to avoid recursive RLS. If `security definer` is used, lock down `search_path`, grants, and input validation.
- Revoke broad direct table writes from authenticated users unless direct table access is deliberately part of the contract.
- Prefer RPCs for write operations because they centralize validation, derived fields, idempotency, and event semantics.
- Use grants explicitly. Do not rely on accidental default privileges.
- Run Supabase security and performance advisors after schema changes.

## 8. Minimum Supabase data model contract

Exact DDL can differ, but the model must satisfy these contracts.

### 8.1 Identity and profile membership

Need enough Supabase-side data for RLS to answer: does `auth.uid()` own or have access to `profile_id`?

Minimum conceptual tables:

- `accounts`
  - `id uuid primary key` equal to Supabase `auth.users.id`.
  - optional `legacy_app_user_id uuid unique` during migration.
  - timestamps.
- `profiles`
  - `id uuid primary key` stable across migration if possible.
  - `account_id uuid not null references accounts(id)`.
  - display fields needed by product.
  - optional `legacy_profile_group_id` during migration.
- `profile_members`
  - `profile_id uuid`.
  - `account_id uuid`.
  - role/status fields if needed.
  - unique `(profile_id, account_id)`.

Minimum helper:

- `private.is_profile_member(p_profile_id uuid) returns boolean`
  - checks membership for `(select auth.uid())`.
  - safe under RLS recursion.
  - indexed paths.

Policy requirement:

- Authenticated users can see/mutate rows for profiles where `private.is_profile_member(profile_id)` is true.
- Service role retains admin/backfill access.

### 8.2 Media identity

All user-state rows use canonical `media_key`.

Canonical shapes:

```text
movie:tmdb:{tmdb_id}
show:tmdb:{tmdb_id}
season:tmdb:{show_tmdb_id}:{season_number}
episode:tmdb:{show_tmdb_id}:{season_number}:{episode_number}
person:tmdb:{tmdb_id}
```

Rules:

- `media_type` is derived or validated from `media_key`.
- Do not make provider-specific IDs canonical in user-state tables.
- `contentId`, Trakt IDs, Simkl IDs, TVDB IDs, Kitsu IDs, and IMDb IDs are compatibility/import metadata only.

### 8.3 User interaction tables

Minimum conceptual tables:

- `profile_media_state`
  - one current state row per `(profile_id, media_key)`.
  - playback position, duration, progress, completed/watched flags, updated timestamps.
- `continue_watching_items`
  - current continue-watching projection/fact per `(profile_id, media_key)` or generated row id.
  - dismiss state.
  - cursor fields.
- `watch_history`
  - append/import facts for watched media.
  - `profile_id`, `media_key`, `media_type`, `watched_at`, `source_kind`, optional `import_batch_id`.
- `profile_list_items`
  - watchlist/favorites/custom list facts.
  - `profile_id`, `media_key`, `list_kind`, timestamps.
- `profile_ratings`
  - `profile_id`, `media_key`, rating value, timestamps.
- `provider_import_batches`
  - import metadata/status for trusted import jobs, no raw provider secrets.
- `media_card_snapshots`
  - optional disposable read snapshot table for card display fields.
  - not canonical metadata authority.

### 8.4 RPC contract

User-scoped RPCs must be callable with publishable key + user JWT and enforce membership internally/RLS.

Required conceptual user RPCs:

- `record_playback_state(p_profile_id, p_media_key, p_position_seconds, p_duration_seconds, p_event_timestamp, ...)`
- `dismiss_continue_watching(p_profile_id, p_item_id or p_media_key)`
- `set_profile_list_item(p_profile_id, p_media_key, p_list_kind, ...)`
- `delete_profile_list_item(p_profile_id, p_media_key, p_list_kind)`
- `set_profile_rating(p_profile_id, p_media_key, p_rating, ...)`
- `delete_profile_rating(p_profile_id, p_media_key)`
- `get_profile_watch_state(p_profile_id, p_media_keys[])`
- `list_continue_watching_page(p_profile_id, p_limit, p_cursor)`
- `list_watch_history_page(p_profile_id, p_limit, p_cursor)`
- `list_profile_list_items_page(p_profile_id, p_list_kind, p_limit, p_cursor)`
- `list_profile_ratings_page(p_profile_id, p_limit, p_cursor)`

Required conceptual service-role RPCs:

- `replace_provider_import_history(p_profile_id, p_source, p_batch, p_rows)`
- snapshot/card upsert RPCs if direct table upsert is too broad.
- admin repair/backfill RPCs, each with explicit scope and logging.

RPC rules:

- Every user RPC must fail if `auth.uid()` is null.
- Every user RPC must fail if the profile is not accessible to `auth.uid()`.
- Every mutation RPC must validate `media_key` format and list/rating enum values.
- Every list RPC must have bounded `limit` and stable cursor semantics.
- RPC errors must be mapped in Fastify to clear 4xx/5xx responses.
- Do not return secret/provider/private columns from RPCs.

## 9. Fastify implementation plan

### 9.1 Auth plugin

Current anchor: `src/http/plugins/auth.ts`.

Tasks:

1. Keep Supabase JWT verification.
2. Preserve original `accessToken` for bearer user sessions.
3. Make route-level requirements explicit:
   - user-session-required routes need non-null `accessToken` if they call Supabase user RPCs.
   - PAT-auth routes must not enter user-JWT Supabase paths unless a new trusted relay is explicitly implemented.
4. Add a small helper or assertion for routes: `requireSupabaseUserAccessToken(request)`.
5. Error behavior for PAT/no-access-token on Supabase-backed user routes should be deterministic, documented, and tested.

### 9.2 Supabase client library

Current anchor: `src/lib/supabase.ts`.

Tasks:

1. Keep `createSupabaseUserClient(accessToken)` with publishable key and bearer authorization.
2. Ensure it cannot be constructed with empty/null token.
3. Keep `getSupabaseServiceRoleClient()` server-only.
4. Add naming/documentation in code via function names, not comments, to make user vs service role paths hard to confuse.
5. Consider module split if needed:
   - `supabase-user-client.ts`
   - `supabase-service-role-client.ts`
6. Never log tokens.

### 9.3 Watch routes

Current anchor: `src/http/routes/watch.ts`.

Tasks:

1. All normal watch/list/rating/history/state routes must use `SupabaseUserWatchService` with user access token.
2. Convert `mark-watched` and `unmark-watched` off local `WatchEventIngestService` or explicitly keep them as temporary dual-write with documented migration flag.
3. Public mutation route success must require Supabase RPC success.
4. If `SupabaseUserWatchService` returns `{ success: false }`, route must return an error or documented partial-failure status, not unconditional `{ accepted: true }`.
5. Ensure profile ID from path is passed to Supabase RPC and also validated by RLS.
6. Ensure OpenAPI response semantics match route behavior after changes.

### 9.4 Supabase user watch service

Current anchor: `src/modules/integrations/supabase-user-watch.service.ts`.

Tasks:

1. Change mutation methods to throw typed errors on RPC failure unless endpoint is explicitly best-effort.
2. Normalize Supabase errors into internal error types:
   - unauthenticated/token issue -> 401.
   - RLS/profile denied -> 403 or 404 depending current API convention.
   - bad input -> 400.
   - missing RPC/schema/config -> 502/500 operational error.
3. Ensure read methods and mutation methods have consistent error behavior.
4. Validate limits/cursors before RPC calls.
5. Add tests for success, RLS denial, RPC error, missing access token, and invalid profile.

### 9.5 Provider imports

Current anchors:

- `src/modules/integrations/provider-import.service.ts`
- `src/modules/integrations/supabase-provider-history-writer.ts`

Tasks:

1. Keep provider OAuth/API calls server-side.
2. Keep provider tokens outside client-accessible Supabase tables.
3. Provider import history writes may use service role because the job is trusted backend work.
4. Service-role RPC must accept explicit account/profile/import scope and validate what it can.
5. Import results should produce Supabase interaction facts in the same canonical `mediaKey` format as user actions.
6. Ensure provider import failures are observable and not silently dropped.

### 9.6 Service-role writer audit

Current anchor: `src/modules/integrations/supabase-watch-writer.ts`.

Tasks:

1. Search all instantiations/imports before using or deleting.
2. If unused, delete it or mark retired through existing retired-module guard conventions.
3. If needed, restrict it to trusted backend job modules only.
4. Never call it from public `/v1/**` user route handlers.
5. Prefer service-role RPC wrappers over direct broad table writes.

### 9.7 Local watch module migration

Current anchors:

- `src/modules/watch/**`
- local Postgres watch projection tables in `migrations/`.

Tasks:

1. Identify all callers still reading/writing local watch state.
2. Classify each as:
   - public user route to migrate to Supabase user RPC.
   - internal backend/reco route to migrate to trusted Supabase reader or Fastify facade.
   - deprecated dead code to delete.
   - temporary dual-write/backfill code.
3. Do not delete local tables until:
   - Supabase backfill complete.
   - shadow reads/parity checks pass.
   - production route traffic uses Supabase path.
   - rollback plan exists.
4. After cutover, add forward local migrations to drop/retire obsolete tables.

### 9.8 Recommendation integration

Current anchors:

- `docs/architecture/recommendation-engine.md`
- `src/modules/recommendations/**`
- `src/modules/outbox/**`
- `openapi/internal-services.v1.yaml`

Tasks:

1. Keep RECO interacting with Fastify only.
2. RECO must not get Supabase keys or direct Supabase URLs as part of the default contract.
3. Fastify internal source-data endpoints may read user signals from Supabase using trusted backend/service-role readers because service-to-service calls do not have user JWTs.
4. Those trusted readers must enforce account/profile scope in Fastify before service-role access.
5. Recommendation recompute event reasons remain tied to watch/rating/watchlist/progress changes regardless of storage location.
6. If recommendation stored outputs move to Supabase later, create a separate Supabase RLS/RPC plan and update OpenAPI/docs.

### 9.9 Metadata hydration

Tasks:

1. Keep TMDB metadata authority in Fastify/backend.
2. Supabase user facts should store `mediaKey` and small derived fields only.
3. `media_card_snapshots` may exist in Supabase as disposable read-model cache.
4. Snapshot writes are trusted backend/service-role operations.
5. Missing snapshots must not corrupt user facts; Fastify can hydrate fallback metadata.
6. Do not store full TMDB cache or provider secrets in client-accessible Supabase tables.

## 10. PAT policy

Current behavior: PAT auth has no Supabase user JWT.

Target default:

1. PATs are not accepted for Supabase user-RLS-backed public user-state routes unless route explicitly supports a trusted relay mode.
2. If a PAT calls a route that requires user JWT/RLS, return a deterministic auth error.
3. Document this in OpenAPI if PAT is otherwise accepted for nearby endpoints.
4. Future trusted relay option, if needed:
   - Fastify authenticates PAT locally.
   - Fastify resolves account/profile authorization locally.
   - Fastify calls a service-role RPC specifically designed for PAT relay.
   - RPC name and code path must make bypass explicit.
   - Add tests proving PAT cannot access other profiles/accounts.

Do not silently fall back from user JWT path to service role just because `request.auth.accessToken` is null.

## 11. API error and success semantics

Rules for public route behavior:

1. `2xx` means the intended user operation committed or read succeeded.
2. `202 Accepted` is allowed only for truly async accepted work with durable enqueue/telemetry.
3. Supabase RPC failure must not be hidden behind `{ accepted: true }`.
4. RLS denial should map to the existing API convention for inaccessible profile/resource.
5. Missing Supabase config should fail startup or route with operational error, not produce fake success.
6. Log operational failures with correlation IDs but without tokens/secrets.
7. Add tests around negative paths, not only success.

## 12. Security test matrix

Minimum tests before enabling any new user-state route on Supabase:

### 12.1 RLS SQL tests

Scenarios:

1. User A can read own account/profile rows.
2. User A cannot read User B account/profile rows.
3. User A cannot call RPC with User B `profile_id`.
4. User A cannot insert/update/delete direct rows for inaccessible profile.
5. Anonymous/no JWT cannot read or mutate user tables/RPCs.
6. Authenticated user cannot access private provider secret tables.
7. Service role can perform intended backfill/import operations.
8. Direct table grants do not accidentally allow writes when writes are intended to go through RPC.
9. Helper functions do not bypass membership incorrectly.
10. Policies use indexed membership paths and do not cause advisor performance warnings.

### 12.2 Fastify integration tests

Scenarios:

1. Valid user JWT + own profile + Supabase RPC success -> 2xx.
2. Valid user JWT + other profile -> 403/404.
3. PAT/no Supabase JWT to user-RLS route -> deterministic auth error.
4. Supabase RPC returns RLS denial -> Fastify error, not success.
5. Supabase RPC unavailable/missing -> operational error, not success.
6. Mutation RPC error -> no `{ accepted: true }`.
7. Provider import service-role path cannot be triggered by public user route.
8. Service-role client module is not imported by public route modules except via explicitly allowed trusted services.

### 12.3 Advisor checks

Run after every Supabase DDL/RLS migration:

- Supabase security advisors.
- Supabase performance advisors.

Fix or document every new warning before rollout.

## 13. Rollout plan

### Phase 0: docs and source-of-truth reset

1. Delete obsolete Supabase phase docs.
2. Add this canonical plan.
3. Update README/architecture/AGENT/recommendation docs to stop saying Supabase auth-only.
4. Leave unrelated plans such as admin bulk recompute alone unless separately requested.

### Phase 1: create Supabase migration source tree

1. Add `supabase/migrations/`.
2. Dump/reconstruct current Supabase schema if it already exists in dashboard.
3. Add migrations for existing tables/RPCs/policies or baseline them explicitly.
4. Add README explaining Supabase migration workflow.
5. Do not proceed with more runtime reliance until current RLS/RPC state is reproducible.

### Phase 2: RLS/profile foundation verification

1. Ensure Supabase has account/profile membership model sufficient for RLS.
2. Add/verify helper functions.
3. Add/verify policies.
4. Add negative isolation tests.
5. Run advisors.

### Phase 3: harden existing Supabase watch route behavior

1. Fix write failure swallowing in `SupabaseUserWatchService` and `watch.ts`.
2. Enforce user-session token requirement for Supabase user routes.
3. Decide and implement PAT behavior.
4. Add integration tests.
5. Update OpenAPI if status/error semantics change.

### Phase 4: remove mixed watch source-of-truth

1. Move `mark-watched`/`unmark-watched` to Supabase user RPC path or mark them deprecated and remove.
2. Audit all remaining local watch read/write callers.
3. Route public watch/list/rating/history/state through one Supabase-backed path.
4. Keep local fallback only behind explicit temporary flag with logs.

### Phase 5: provider import and history alignment

1. Ensure provider imports write canonical Supabase history facts.
2. Ensure imported history and user playback history converge on same read models.
3. Add idempotent batch replacement semantics.
4. Verify service-role paths are only in import/admin modules.

### Phase 6: recommendation source-data alignment

1. Update Fastify internal source-data endpoints to read Supabase user signals through trusted backend readers where needed.
2. Keep RECO API contract unchanged unless OpenAPI changes are required.
3. Ensure recompute triggers still fire after Supabase-backed user mutations.
4. Verify source data parity for RECO.

### Phase 7: local table retirement

1. Confirm Supabase is source of truth for target user interaction domains.
2. Run parity/backfill checks.
3. Remove dead local services and repositories.
4. Add forward migrations to drop/retire obsolete local tables.
5. Update docs/OpenAPI/tests.

### Phase 8: future direct client Supabase exceptions, optional

Only if necessary:

1. Write a separate exception spec.
2. Explain why Fastify path is insufficient.
3. Identify exact table/RPC and client call.
4. Prove RLS and rate-limit/abuse controls.
5. Update OpenAPI/client docs if Fastify no longer owns that surface.
6. Add security/advisor tests.

## 14. LLM execution protocol

Before editing code:

1. Read this file.
2. Read `architecture.md`.
3. Read `AGENT.md`.
4. Read exact target files before editing.
5. Search for existing patterns; do not assume libraries.
6. Determine if path is user-scoped or trusted backend.
7. If user-scoped, use user JWT/RLS.
8. If trusted backend, prove why service role is needed and keep it isolated.

When changing Supabase user state:

1. Add or update Supabase migration files first if schema/RLS/RPC changes are needed.
2. Add RLS tests.
3. Add Fastify tests.
4. Update OpenAPI if HTTP behavior changes.
5. Run typecheck/tests and relevant contract checks.
6. Run Supabase advisors when DDL/RLS changed.

Never do these:

1. Do not put service role in client, docs examples for clients, generated OpenAPI examples, or logs.
2. Do not replace RLS with service role for normal user route convenience.
3. Do not bypass Fastify API from client for app data by default.
4. Do not reintroduce auth-only Supabase wording.
5. Do not claim local Postgres owns all watch/list/rating/history state after the cutover.
6. Do not move provider/AI secrets into client-accessible Supabase tables.
7. Do not let a route return success after a failed Supabase mutation.
8. Do not delete local tables before parity/backfill/rollback criteria are met.

## 15. Detailed remaining implementation plan

This section is intentionally LLM-oriented and explicit. Execute in order unless a step says it can run in parallel. The live Supabase project was inspected through Supabase MCP on 2026-05-11; do not assume the live state is reproducible until the migration baseline is committed under `supabase/migrations/`.

### 15.1 Supabase SQL migrations, RLS, RPCs, and tests

#### Current live Supabase state to baseline

Live migration versions currently reported by Supabase:

1. `20260510154106_create_user_infra_foundation`
2. `20260510154236_secure_user_infra_rls`
3. `20260510154309_bootstrap_user_infra_accounts`
4. `20260510154338_harden_bootstrap_current_account_rpc`
5. `20260510154500_add_profiles_created_by_account_index`
6. `20260510155757_create_watch_history_provider_imports`
7. `20260510185111_lean_provider_import_history`
8. `20260510185212_grant_lean_watch_history_columns`
9. `20260510185309_rewrite_watch_history_compact`
10. `20260510192129_create_media_card_snapshots_and_history_view`
11. `20260511135021_create_user_media_provider_state`
12. `20260511141532_harden_user_media_state_user_rpcs`
13. `20260511142920_create_watch_read_models`
14. `20260511142935_create_watch_state_read_rpc`

Live public tables observed with RLS enabled:

- `accounts`
- `profiles`
- `profile_members`
- `account_preferences`
- `profile_preferences`
- `account_entitlements`
- `provider_connections`
- `provider_oauth_states`
- `provider_import_batches`
- `watch_history`
- `media_card_snapshots`
- `profile_media_state`
- `continue_watching_items`
- `profile_list_items`
- `profile_ratings`

Important live user-state table shape to preserve:

- `profile_media_state`: PK `(profile_id, media_key)`, includes `account_id`, `title_media_key`, `media_type`, playback position/duration/progress, `watch_state`, `play_count`, watched/completed/activity/dismiss timestamps, source fields, actor fields.
- `continue_watching_items`: PK `(profile_id, title_media_key)`, includes playable/title keys, progress, last activity, dismiss/source fields.
- `watch_history`: append/replace history facts with `account_id`, `profile_id`, `import_batch_id`, `media_key`, `media_type`, `watched_at`, `source_kind`.
- `profile_list_items`: PK `(profile_id, list_kind, media_key)`, supports at least `watchlist` and `favorites`.
- `profile_ratings`: PK `(profile_id, media_key)`, rating range 1-10.

#### Required repository migration baseline

Create a reproducible Supabase schema source of truth before further behavioral cutover:

1. Populate `supabase/migrations/` with either:
   - exact historical migration files matching the live versions above, if recoverable from Supabase/SQL history, or
   - one explicit baseline migration named like `20260511150000_baseline_live_user_infra.sql` plus a `supabase/migrations/README` note that it reflects live schema as of 2026-05-11 and does not rewrite already-applied production history.
2. The baseline must include schemas, extensions used by the user-infra tables, tables, views, indexes, constraints, helper functions, RPC functions, RLS enablement, RLS policies, grants, and comments documenting intentionally exposed RPCs.
3. Do not treat local `migrations/*.sql` as Supabase migrations. Local migrations remain for the Fastify/local Postgres database only.
4. Add every future Supabase DDL/RLS/RPC change as a forward migration under `supabase/migrations/`; never apply dashboard-only SQL without committing equivalent SQL.
5. After baseline, use `supabase_apply_migration` for DDL against the live project and mirror the exact SQL into the repo migration file, or create the repo migration first and apply that exact SQL.

#### Required hardening migration

After baseline is committed, add a forward hardening migration with these minimum changes:

1. Revoke anonymous execution from user RPCs:
   - `revoke execute on function public.get_profile_watch_state(uuid, text[]) from anon;`
   - `revoke execute on function public.list_continue_watching_page(uuid, integer, timestamptz, text) from anon;`
   - `revoke execute on function public.list_profile_list_items_page(uuid, text, integer, timestamptz, text) from anon;`
   - `revoke execute on function public.list_profile_ratings_page(uuid, integer, timestamptz, text) from anon;`
   - `revoke execute on function public.list_watch_history_page(uuid, integer, timestamptz, uuid) from anon;`
   - `revoke execute on function public.record_playback_state(uuid, text, text, text, integer, integer, smallint, text) from anon;`
   - include all write RPCs: `dismiss_continue_watching`, `set_profile_list_item`, `delete_profile_list_item`, `set_profile_rating`, `delete_profile_rating`, plus new mark/unmark RPCs.
2. Revoke execution on `public.rls_auto_enable()` from `anon` and `authenticated`; if still needed, move to `private` or service-role-only operations.
3. Grant authenticated execution only for exact user RPCs called by Fastify with a user JWT. Do not grant direct table write access to `authenticated` unless a deliberate direct-client exception exists.
4. Grant service-role execution only for trusted backend RPCs:
   - `replace_provider_import_history`
   - `replace_provider_import_list_items`
   - `replace_provider_import_ratings`
   - any new provider playback/progress/import RPCs.
5. Set fixed `search_path` on every SECURITY DEFINER function, especially:
   - `public.list_profile_list_items_page`
   - `public.list_continue_watching_page`
   - `public.list_profile_ratings_page`
   - `public.list_watch_history_page`
   - `private.can_write_profile_media`
   - `private.profile_owner_account_id`
   - `public.replace_provider_import_list_items`
   - `public.replace_provider_import_ratings`
   Prefer `set search_path = ''` and fully qualify all table/function references. If a function cannot use empty search path immediately, use the narrowest fixed path and create a follow-up task.
6. Harden broad table privileges:
   - `revoke all on all tables in schema public from anon;`
   - revoke unexpected `TRIGGER`, `TRUNCATE`, `REFERENCES`, and table write privileges from `authenticated` on user-state tables unless explicitly required and tested.
   - grant only selected read privileges needed for RLS-backed RPC internals or Data API reads if intentionally exposed.
7. Add covering indexes for unindexed FK advisor warnings unless a specific FK is proven cold and documented:
   - `continue_watching_items(last_actor_account_id)`
   - `profile_list_items(last_actor_account_id)`
   - `profile_media_state(last_actor_account_id)`
   - `profile_ratings(last_actor_account_id)`
   - `provider_oauth_states(account_id)`
   - `provider_oauth_states(profile_id)`
8. Do not remove `unused_index` advisor-reported indexes yet. They may be unused because the schema is new. Revisit after traffic and query stats.
9. Auth leaked password protection is an Auth project setting, not schema SQL. Track separately as an ops/security setting.

#### Required mark/unmark RPC design

Add one of these RPC designs. Prefer single RPC for simpler Fastify mapping:

Option 1, preferred:

- `public.set_profile_watched_state(p_profile_id uuid, p_media_key text, p_title_media_key text, p_media_type text, p_watch_state text, p_occurred_at timestamptz default now()) returns void`
- Allowed `p_watch_state`: `watched`, `unwatched`.
- Requires `auth.uid()` not null.
- Verifies `private.can_write_profile_media(p_profile_id)`.
- Resolves owning account from profile membership/helpers, not from caller-supplied account id.
- For `watched`:
  - upsert `profile_media_state` with `watch_state='watched'`, `watched_at=p_occurred_at`, `last_activity_at=p_occurred_at`, increment or preserve `play_count` according to chosen semantics.
  - insert or upsert a local-source `watch_history` fact if history should include explicit mark-watched actions.
  - remove or update `continue_watching_items` so completed/watched media no longer appears incorrectly.
- For `unwatched`:
  - upsert/update `profile_media_state` with `watch_state='unwatched'`, clear watched/completed fields according to selected semantics.
  - remove local-source `watch_history` facts for that profile/media if unmark semantics require deletion.
  - ensure continue-watching is dismissed/removed if previous state would conflict.
- Sets `source_kind='local'`, `source_provider=null`, `last_actor_account_id=auth.uid()`.
- Must be SECURITY DEFINER only if required; if SECURITY DEFINER, fixed `search_path`, explicit grants, and tests are mandatory.

Option 2:

- `public.mark_profile_watched(...) returns void`
- `public.unmark_profile_watched(...) returns void`
- Same authorization, side effects, grants, and tests as Option 1.

#### Required Supabase test tree

Add SQL tests under `supabase/tests/` before or with each DDL migration. Minimum files:

1. `supabase/tests/001_rls_profile_isolation.sql`
   - Create or reference two accounts and profiles.
   - As account A, prove account A can read/write only profile A rows/RPCs.
   - As account A, prove reads/writes/RPCs against profile B fail or return empty.
   - As anon/no JWT, prove user RPC execute is denied.
2. `supabase/tests/002_watch_rpc_contract.sql`
   - Exercise `record_playback_state`, `set_profile_watched_state` or mark/unmark RPCs, `get_profile_watch_state`, list history, continue watching, list/rating RPCs.
   - Assert table state, read model state, and pagination cursor behavior.
   - Assert invalid media type, invalid rating, invalid list kind, and invalid profile id fail deterministically.
3. `supabase/tests/003_provider_import_service_role.sql`
   - As service_role, call provider replacement RPCs and assert idempotent replacement by provider/job/batch semantics.
   - As authenticated, prove service-role import RPCs are not executable.
   - As anon, prove service-role import RPCs are not executable.
4. `supabase/tests/004_grants_and_function_hardening.sql`
   - Query `information_schema.routine_privileges`, `pg_proc.proconfig`, and `pg_roles` grants.
   - Fail if anon can execute any user-state SECURITY DEFINER RPC.
   - Fail if target functions lack fixed `search_path`.
   - Fail if `authenticated` has unexpected table write privileges.
5. `supabase/tests/005_reco_reader_contract.sql`
   - Verify trusted backend/service-role reader functions or queries return only the intended profile/account data after Fastify-side local authorization.
   - If no SQL reader RPC exists, document that Fastify uses service-role table reads after local profile ownership checks and test that query shape separately in Fastify tests.

Test execution requirement:

- The tests must run against a disposable Supabase branch or local Supabase project, not production.
- The test runner must simulate JWT claims for `anon`, `authenticated account A`, `authenticated account B`, and `service_role`.
- If using psql directly, wrap each test in a transaction and reset role/JWT claims after each scenario.
- If using pgTAP, add the extension in the test environment only unless production requires it.

#### Supabase acceptance checks

This workstream is complete only when:

1. `supabase/migrations/` can recreate the live user-infra schema on a clean Supabase branch.
2. `supabase/tests/` proves profile isolation, anon denial, user RPC behavior, service-role-only import RPCs, and grant/function hardening.
3. Supabase security advisor has no unhandled `anon_security_definer_function_executable` findings for user-state RPCs.
4. `function_search_path_mutable` findings are eliminated for the watch/list/read RPCs.
5. Remaining `authenticated_security_definer_function_executable` findings are either removed or explicitly documented as intentional user RPC exposure through Fastify's user JWT path.
6. Performance advisor unindexed FK items are fixed or explicitly deferred with reason.

### 15.2 Remove local `mark-watched`/`unmark-watched` as source of truth

#### Current local exception

`src/http/routes/watch.ts` still routes:

- `POST /v1/profiles/:profileId/watch/mark-watched`
- `POST /v1/profiles/:profileId/watch/unmark-watched`

to `WatchEventIngestService` using `app.requireUserActor(request)`. This allows the local watch module to remain source of truth for these two mutations and may allow PAT actors. This must end.

#### Required Fastify changes

1. Add methods to `src/modules/integrations/supabase-user-watch.service.ts`:
   - `markWatched(params: { accessToken: string; profileId: string; mediaKey: string; titleMediaKey?: string; mediaType: string; occurredAt?: string; })`
   - `unmarkWatched(params: { accessToken: string; profileId: string; mediaKey: string; titleMediaKey?: string; mediaType: string; occurredAt?: string; })`
   or one `setWatchedState(...)` method matching the chosen RPC.
2. Methods must use `createSupabaseUserClient(accessToken)` and `rpcMutation`, never service role.
3. Update `src/http/routes/watch.ts`:
   - remove `WatchEventIngestService` construction if no remaining route uses it.
   - change mark/unmark routes to `app.requireUserSessionActor(request)`.
   - call `requireSupabaseAccessToken(actor)`.
   - call Supabase user service methods.
   - return success only after RPC success.
   - preserve response body compatibility: `{ accepted: true, mode: 'synchronous' }` unless OpenAPI intentionally changes.
4. Keep request body mapping compatible with existing `mapMutationBody`; ensure `mediaKey`, `mediaType`, `titleMediaKey`, and `occurredAt` are passed correctly.
5. Add Fastify tests in `src/http/routes/watch.test.ts`:
   - mark-watched passes user access token to Supabase service.
   - unmark-watched passes user access token to Supabase service.
   - no access token returns wrapped error with status 403 and message `Supabase user session required.`.
   - Supabase RPC failure propagates 502 and does not return accepted.
   - PAT actor is rejected.

#### Required side-effect replacement

The local `WatchEventIngestService` currently performs non-DB side effects after local writes. Moving source of truth to Supabase must not silently lose these effects.

Create one backend side-effect bridge after successful Supabase user mutations, for example `SupabaseWatchMutationSideEffectsService`, with methods:

- `afterPlaybackStateChanged(accountId, profileId, mediaKey, reason)`
- `afterWatchedStateChanged(accountId, profileId, mediaKey, reason)`
- `afterWatchlistChanged(accountId, profileId, mediaKey, reason)`
- `afterRatingChanged(accountId, profileId, mediaKey, reason)`
- `afterContinueWatchingDismissed(accountId, profileId, mediaKey, reason)`

Minimum side effects to preserve from `WatchEventIngestService`:

1. Calendar invalidation for history mutations.
2. Profile input signal cache invalidation:
   - history mutations -> family `history`, reason `watch_history_mutated`.
   - ratings -> family `ratings`, reason `rating_changed`.
   - watchlist -> family `watchlist`, reason `watchlist_changed`.
   - playback/continue -> family `continue`, reason `playback_progress_changed` or equivalent.
3. Recommendation recompute outbox events using existing reasons:
   - `watch_history_changed`
   - `rating_changed`
   - `watchlist_changed`
   - `playback_progress_changed`
4. Integration outbox equivalent if downstream workers still consume `watch_history.upserted`.
5. Metadata refresh for mutated `mediaKey` where current local code does it.

Implementation rule:

- Supabase mutation first, side effects second.
- If Supabase mutation fails, return 502 and do not emit side effects.
- If side effects fail after Supabase success, return policy must be explicit:
  - preferred: log error, return accepted, enqueue retryable side-effect repair/outbox if available.
  - stricter alternative: return 202 accepted with warning only if API schema supports it.
- Never compensate by writing local watch state as fallback.

#### Local watch retirement audit

After mark/unmark routes move:

1. Grep for `WatchEventIngestService` instantiation and direct public-route usage.
2. Identify remaining local watch services that are still used for reads or recommendations:
   - `WatchExportService`
   - `WatchMediaCardCacheService`
   - `PersonalMediaService` continue-watching reads
   - local watch repositories.
3. Mark each as one of:
   - still required for temporary parity/shadow mode,
   - internal metadata/cache helper only,
   - dead and removable after recommendation cutover.
4. Add TODOs only in tracking docs/issues, not inline code comments unless the user explicitly asks.

### 15.3 Align provider imports with Supabase user interaction data

#### Current gap

`ProviderImportService` currently sends only `importedHistoryEntries` to `SupabaseProviderHistoryWriter.replaceImportedHistory(...)`. The normalized provider payload also contains `importedEvents` for watchlist, ratings, playback progress/completion, and removals. Those facts must converge into the same Supabase tables/read models as user actions.

#### Required provider import data contract

Define one normalized import contract from provider imports to Supabase:

```ts
type SupabaseProviderImportPayload = {
  accountId: string;
  profileId: string;
  provider: 'trakt' | 'simkl' | string;
  providerSessionId: string;
  importJobId: string;
  historyGeneration: number;
  importedAt: string;
  history: Array<{ mediaKey: string; mediaType: string; watchedAt: string; sourceKind: string; }>;
  listItems: Array<{ listKind: 'watchlist' | 'favorites'; mediaKey: string; mediaType: string; addedAt: string; removed?: boolean; }>;
  ratings: Array<{ mediaKey: string; mediaType: string; rating: number; ratedAt: string; removed?: boolean; }>;
  playbackStates: Array<{ mediaKey: string; titleMediaKey?: string; mediaType: string; positionSeconds?: number; durationSeconds?: number; progressBps?: number; eventKind: string; occurredAt: string; }>;
};
```

This type can be adjusted to existing naming, but all provider facts must be accounted for.

#### Required Supabase service-role RPCs

Provider import writes are trusted backend writes and may use service_role. They must be isolated to provider/admin modules.

Existing live service-role RPCs:

- `replace_provider_import_history`
- `replace_provider_import_list_items`
- `replace_provider_import_ratings`

Add or verify equivalent RPC(s) for provider playback/progress facts if imported playback should affect `profile_media_state` or `continue_watching_items`:

- `replace_provider_import_playback_states` or a broader `replace_provider_import_media_state`.

RPC behavior requirements:

1. Idempotent per `(account_id, profile_id, provider, provider_session_id, import_job_id or history_generation)`.
2. Replaces provider-owned facts without deleting user-local facts.
3. Provider facts use `source_kind='provider_import'` and `source_provider=<provider>`.
4. User-local facts use `source_kind='local'` and are never overwritten by provider replacement unless an explicit merge policy says so.
5. RPCs resolve/validate account/profile relationship server-side.
6. RPCs are executable by `service_role` only.
7. RPCs have fixed `search_path`.
8. RPCs return inserted/updated/deleted counts per fact family.

#### Required Fastify/service changes

1. Expand `src/modules/integrations/supabase-provider-history-writer.ts` or replace it with `SupabaseProviderInteractionWriter`.
2. The writer should expose one high-level method, e.g. `replaceImportedInteractions(payload)`, and internally call all required RPCs.
3. Update `src/modules/integrations/provider-import.service.ts`:
   - build history/list/rating/playback arrays from normalized import output.
   - call the Supabase writer once per completed import.
   - include per-family counts in job summary.
   - include skipped/failure status in structured logs.
4. Decide failure policy:
   - preferred for canonical user-state cutover: Supabase sync failure makes provider import job fail or retry, because Supabase is source of truth.
   - temporary migration mode: provider import may succeed with `supabaseSyncSkipped=true`, but must emit a retryable repair job and visible warning metric.
5. Audit `src/modules/integrations/supabase-watch-writer.ts`:
   - if unused, remove it after provider writer replacement.
   - if reused, restrict constructor/export so it cannot be used by public user routes.
   - remove direct service-role table writes where a service-role RPC exists.

#### Provider import tests

Add/update tests in `src/modules/integrations/provider-import.service.test.ts` and writer-specific tests:

1. Trakt watched history writes history RPC payload.
2. Trakt watchlist writes list item RPC payload.
3. Trakt ratings write rating RPC payload.
4. Trakt playback/progress writes playback/media-state RPC payload if supported.
5. Simkl watchlist/ratings map to the same Supabase payload shape.
6. Supabase writer is not constructed when admin key is absent; behavior follows chosen failure policy.
7. Supabase RPC error causes retry/failure according to chosen policy, not silent success unless explicitly in temporary mode.
8. Service-role key is never logged.

### 15.4 Align recommendations to Supabase interaction data

#### Current gap

Recommendation input currently reads local watch/list/rating/continue state through `RecommendationDataService`, `WatchExportService`, `PersonalMediaService`, and local caches. After Supabase becomes canonical for user interaction state, RECO input must derive from Supabase-backed data behind Fastify.

#### Target data path

- Public clients still call Fastify.
- RECO service still calls Fastify/internal API, not Supabase directly.
- Fastify recommendation source-data builders read Supabase user interaction data through trusted backend code after local/internal authorization checks.
- Supabase remains the source of truth for history, ratings, watchlist, and continue-watching.

#### Required trusted reader design

Add a backend-only reader such as `SupabaseRecommendationSignalReader` or extend `SupabaseUserWatchService` with service-side read methods.

Preferred design:

1. Fastify/internal recommendation path receives `accountId` and `profileId` from trusted local context.
2. Before service-role Supabase reads, Fastify verifies local account/profile ownership or membership using existing local profile/account repositories. Do not rely only on service-role reads for authorization.
3. Reader uses service_role only inside backend recommendation modules, or uses a Supabase user JWT only if the request is directly tied to a current user session and the token is available.
4. Reader returns normalized signal payloads matching existing recommendation input contracts:
   - history items
   - ratings
   - watchlist
   - continue-watching
   - optional tracked series if/when Supabase schema supports it.
5. Hydration of media cards remains through existing metadata/card services unless `media_card_snapshots` is declared canonical and tested.
6. RECO API contract remains unchanged unless explicitly versioned.

#### Required code migration

1. In `src/modules/recommendations/profile-input-signal.facade.ts`, add a source switch or replace live fetchers so these families come from Supabase-backed reader:
   - `history`
   - `ratings`
   - `watchlist`
   - `continue`
2. In `src/modules/recommendations/recommendation-data.service.ts`, stop using local `WatchExportService` for those families once Supabase reader parity is proven.
3. Keep `trackedSeries` local temporarily if no Supabase table/RPC exists for episodic follow state. Document this as a remaining exception.
4. Preserve `ProfileInputSignalCacheRefreshService` behavior; it should not need to know whether source data came from local Postgres or Supabase.
5. Ensure every Supabase-backed user mutation/import that changes recommendations emits or schedules recompute through `RecommendationOutboxService`.

#### Parity and rollout

Use a shadow-read rollout before deleting local sources:

1. For a sampled set of profiles, read signals from local current services and Supabase reader.
2. Compare counts, media keys, ratings, watchlist keys, continue-watching keys, and latest timestamps.
3. Log structured diffs without logging secrets or full user tokens.
4. Fix import/backfill/RPC mismatches.
5. Gate cutover behind a config flag only if needed.
6. After parity is acceptable, switch live recommendation inputs to Supabase.
7. Keep local fallback disabled by default; if retained temporarily, log every fallback.

#### Recommendation tests

Add/update tests for:

1. Supabase reader maps history rows to existing recommendation history shape.
2. Supabase reader maps ratings/list/continue rows to existing shapes.
3. Local profile authorization is checked before service-role read.
4. RECO never receives Supabase credentials.
5. Mutation side-effect bridge appends recompute events after watch history, rating, watchlist, and playback changes.
6. Provider import sync appends recompute events for affected profiles.

### 15.5 Define PAT behavior

#### Default policy

Personal access tokens do not carry a Supabase Auth user JWT. Therefore PATs are not valid for user-RLS-backed Supabase routes by default.

Default behavior for all Supabase user-state endpoints:

1. Supabase-backed user-state routes must use `app.requireUserSessionActor(request)` or equivalent session-only guard.
2. They must call `requireSupabaseAccessToken(actor)` before Supabase user RPCs.
3. If caller is unauthenticated, return existing wrapped 401 missing bearer token behavior.
4. If caller is authenticated by PAT but has no Supabase access token, return 403 with deterministic application error equivalent to `Supabase user session required.`.
5. Never fall back to service_role for PAT on normal user routes.
6. Never mint or exchange a Supabase JWT from a PAT unless a separate explicit trusted-relay design is written and approved.

Routes covered by this policy:

- `POST /v1/profiles/:profileId/watch/events`
- `GET /v1/profiles/:profileId/watch/continue-watching`
- `DELETE /v1/profiles/:profileId/watch/continue-watching/:id`
- `GET /v1/profiles/:profileId/watch/history`
- `GET /v1/profiles/:profileId/watch/watchlist`
- `GET /v1/profiles/:profileId/watch/ratings`
- `GET /v1/profiles/:profileId/watch/state`
- `POST /v1/profiles/:profileId/watch/states`
- `POST /v1/profiles/:profileId/watch/mark-watched`
- `POST /v1/profiles/:profileId/watch/unmark-watched`
- watchlist/rating PUT/DELETE routes.

#### Optional future PAT relay

Only design a PAT relay if there is a real API client requirement. If implemented, it must:

1. Keep clients on Fastify only.
2. Use local PAT authorization and local profile membership checks.
3. Call dedicated service-role RPCs that re-check account/profile ids supplied by Fastify.
4. Never expose generic service-role table access.
5. Have separate audit logs and rate limits.
6. Have tests proving PAT cannot access another profile/account.
7. Have OpenAPI docs explicitly marking which PAT routes are supported.

#### Required docs/tests

1. Update `docs/api/README.md` and OpenAPI route descriptions if PAT behavior changes externally.
2. Add route tests for PAT rejection on every Supabase-backed route family, at least one representative per family.
3. Add auth plugin tests proving PAT sets `accessToken=null` and session JWT preserves raw token.
4. Contract tests must match the wrapped error body shape.

### 15.6 Fix DB-backed full-test failures

#### Current failure

Full `npm test` currently fails in account deletion tests with `connect ECONNREFUSED 127.0.0.1:5432`. The tests stub repositories/services but `AccountDeletionService.deleteAccount` calls imported global `withTransaction`, which opens the real local Postgres connection.

#### Required fix

1. Update `src/modules/users/account-deletion.service.ts` to inject a transaction runner dependency.
2. Default the dependency to existing `withTransaction` for production.
3. In tests, pass a fake transaction runner that invokes the callback with a dummy transaction/client object.
4. Do not require local Postgres for unit tests that only verify account deletion orchestration.
5. Keep real DB coverage in explicit integration tests only.

Suggested shape:

```ts
type TransactionRunner = <T>(callback: (client: unknown) => Promise<T>) => Promise<T>;

class AccountDeletionService {
  constructor(
    deps..., 
    private readonly transactionRunner: TransactionRunner = withTransaction,
  ) {}
}
```

Adapt exact transaction client type to existing `withTransaction` signature.

#### Required tests

Update `src/modules/users/account-deletion.service.test.ts`:

1. Define `const runTransaction = async <T>(callback: (client: never) => Promise<T>) => callback(undefined as never);` or a correctly typed fake client.
2. Pass fake runner to `AccountDeletionService` constructor.
3. Assert deletion order and rollback behavior at service level without opening DB.
4. Add one test proving external Supabase Auth admin deletion behavior remains unchanged.

#### Broader test hygiene

1. Audit any remaining unit test that opens real `DATABASE_URL` unintentionally.
2. Split scripts if needed:
   - `test:unit` for no external DB/Redis.
   - `test:integration` for local Postgres/Redis/Supabase branch.
   - keep `npm test` as unit-only unless CI provisions dependencies.
3. If keeping `npm test` as all-tests, CI/dev docs must state required local Postgres/Redis startup.
4. Do not hide real failures by catching database connection errors inside tests.

#### Verification commands for this workstream

Run after code changes:

1. `node --import tsx --test "src/modules/users/account-deletion.service.test.ts"`
2. `node --import tsx --test "src/http/routes/watch.test.ts"`
3. `npm run typecheck`
4. `npm run build`
5. `npm test`
6. If OpenAPI changes: `npm run contract:check`
7. If Supabase SQL changes: run Supabase tests against a disposable branch/local Supabase and run Supabase security/performance advisors.

### 15.7 Overall execution order

1. Commit or otherwise preserve current working tree state before starting destructive refactors.
2. Baseline live Supabase schema into `supabase/migrations/`.
3. Add Supabase RLS/RPC/grant tests.
4. Apply hardening migration and verify advisors.
5. Add mark/unmark Supabase RPC(s).
6. Update `SupabaseUserWatchService` and `watch.ts` mark/unmark routes.
7. Add side-effect bridge for Supabase-backed mutations.
8. Define and test PAT rejection for all user-RLS-backed routes.
9. Expand provider import Supabase writer and service-role RPC coverage.
10. Add recommendation Supabase reader in shadow mode.
11. Cut recommendation live reads to Supabase after parity.
12. Retire local watch source services/tables only after parity and rollback criteria are satisfied.
13. Fix AccountDeletionService transaction injection so full unit suite is not DB-dependent.
14. Run full verification commands.

## 16. Completion criteria

The migration is complete when all are true:

1. Supabase Auth is the user session authority.
2. Fastify is the default client data API.
3. User watch/list/rating/history/playback routes use Supabase user JWT + RLS-backed RPC/Data API.
4. Supabase migrations/RLS/RPCs are checked in and reproducible.
5. RLS tests prove user/profile isolation.
6. Supabase advisors have no unhandled new security/performance issues.
7. Public route mutation failures propagate correctly.
8. PAT behavior is explicit and tested.
9. Provider imports use trusted service-role paths only.
10. RECO gets source data through Fastify, not direct Supabase access.
11. Docs no longer conflict on Supabase ownership.
12. Dead local watch-state services/tables are removed or marked temporary with tracked retirement tasks.
