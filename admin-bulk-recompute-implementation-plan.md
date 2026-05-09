# Admin Bulk Recompute Large-Backend Implementation Plan

## Implementation-phase purpose and scope

Build a durable, DB-backed admin bulk recompute system that can safely trigger recommendation recompute work for:

- Explicit profile/account batches beyond the current request-time max-50 loop.
- All users.
- Tier-wide cohorts: free, pro, and ultra.
- Repeated admin clicks without creating duplicate recompute storms.
- Long-running operations with observable progress, pause, resume, and cancel controls.

This plan assumes the existing per-profile/batch route in `src/http/routes/admin-api.ts` remains supported while the new system is introduced behind explicit admin bulk-job APIs and rollout gates.

## Current constraints and evidence

- Admin recompute is currently synchronous/request-scoped for per-profile or explicit account/profile batches, with a max batch size of 50 in `src/http/routes/admin-api.ts:388-477`.
- The current route loops and enqueues recompute events directly inside the HTTP request in `src/http/routes/admin-api.ts:434-462`.
- Recommendation recompute currently appends individual outbox events in `src/modules/outbox/recommendation-outbox.service.ts:25-40`.
- Tier read/set exists only for one account at a time in `src/http/routes/admin-api.ts:169-190`.
- `service_outbox` currently supports only delivery states `pending`, `processing`, `dispatched`, and `failed` in `src/modules/outbox/service-outbox.repo.ts:4,129-209`.
- Admin diagnostics currently summarize only outbox rows in `src/http/routes/admin-api.ts:118-141`.
- Existing admin routes generate fresh correlation IDs by default in `src/http/routes/admin-api.ts:392,431`, which prevents natural coalescing across repeated clicks.
- Future architecture docs already mention pause/resume/cancel/dedupe in `docs/architecture/recommendation-engine.md:134`.

## Target architecture

### High-level flow

1. Admin creates or previews a bulk recompute job through new admin APIs.
2. API stores a durable `admin_bulk_jobs` record plus an `admin_bulk_job_requests` record for idempotency/audit.
3. An async bulk worker claims jobs and enumerates targets into `admin_bulk_job_targets`.
4. The fanout loop converts eligible targets into recommendation outbox rows in `service_outbox`.
5. Existing outbox dispatcher continues delivering recompute events.
6. Bulk job progress is derived from bulk job tables plus linked outbox rows.
7. Admin can list/detail jobs, inspect events, pause/resume/cancel jobs, and view linked outbox diagnostics.

### Data ownership

- Bulk job framework owns job lifecycle, target enumeration, target fanout, progress snapshots, and control state.
- Existing outbox dispatcher owns delivery of individual recommendation recompute events.
- Recommendation recompute consumers should not need to understand bulk job lifecycle except for optional correlation/idempotency metadata.

### New tables

Add DB-backed bulk job framework tables:

- `admin_bulk_jobs`
- `admin_bulk_job_targets`
- `admin_bulk_job_requests`
- `admin_bulk_job_events`

Extend `service_outbox` with nullable metadata columns:

- `bulk_job_id`
- `bulk_job_target_id`
- `idempotency_key`
- `correlation_id`

## Proposed statuses and state model

### `admin_bulk_jobs.status`

- `queued`: created, waiting for worker.
- `enumerating`: worker is discovering targets.
- `fanout`: worker is appending outbox rows for targets.
- `paused`: admin requested pause; worker should stop enumeration/fanout after current transaction.
- `canceling`: admin requested cancel; worker should stop new work and mark non-terminal targets canceled.
- `canceled`: cancel completed.
- `completed`: all targets reached terminal state and required outbox rows have been created or coalesced.
- `failed`: unrecoverable job-level error.

### `admin_bulk_job_targets.status`

- `queued`: target discovered but no outbox row linked yet.
- `coalesced`: target intentionally skipped because equivalent pending/processing work already exists.
- `outboxed`: outbox row created and linked.
- `dispatched`: linked outbox row dispatched.
- `failed`: target-level fanout or delivery failed.
- `canceled`: target was not fanned out because job was canceled.

### Important state rules

- Pause only prevents new enumeration/fanout; it does not recall already-created outbox events.
- Cancel only prevents new enumeration/fanout; already-dispatched recompute events remain best-effort and should not be interrupted.
- Resume moves `paused` jobs back to `queued`, `enumerating`, or `fanout` based on persisted phase/progress.
- Completion must tolerate linked outbox rows finishing after fanout completes.

## Schema and migration checklist

### Migration files

- Add a new migration under `migrations/` for bulk job framework tables.
- Add a second migration or a clearly separated section for `service_outbox` metadata columns and indexes.
- Update any schema snapshots or migration tests if present.

### `admin_bulk_jobs`

Checklist:

- [ ] Primary key: UUID or existing repository ID convention.
- [ ] `operation`: e.g. `recommendation_recompute`.
- [ ] `scope_type`: `explicit_targets`, `all_users`, `tier`.
- [ ] `tier`: nullable, constrained to `free`, `pro`, `ultra` when `scope_type = 'tier'`.
- [ ] `status` with allowed lifecycle values.
- [ ] `requested_by_admin_id` or existing admin actor identifier if available.
- [ ] `request_correlation_id` for API-level tracing.
- [ ] `dedupe_key` for advanced coalescing.
- [ ] `idempotency_key` for client-provided request idempotency.
- [ ] `target_count_estimate` nullable for preview/enumeration estimates.
- [ ] Counters: `targets_total`, `targets_queued`, `targets_coalesced`, `targets_outboxed`, `targets_dispatched`, `targets_failed`, `targets_canceled`.
- [ ] Cursor/checkpoint fields for resumable enumeration.
- [ ] `pause_requested_at`, `resume_requested_at`, `cancel_requested_at`.
- [ ] `started_at`, `enumeration_completed_at`, `fanout_completed_at`, `completed_at`, `failed_at`.
- [ ] `last_error` nullable text/json.
- [ ] `created_at`, `updated_at`.
- [ ] Indexes on `status`, `operation`, `scope_type`, `tier`, `created_at`, and `dedupe_key`.

### `admin_bulk_job_targets`

Checklist:

- [ ] Primary key.
- [ ] `bulk_job_id` foreign key to `admin_bulk_jobs`.
- [ ] Target identity: `account_id`, `profile_id`, and normalized `target_key`.
- [ ] `status` with target lifecycle values.
- [ ] `idempotency_key` unique per equivalent recompute target and reason.
- [ ] `service_outbox_id` nullable foreign key to `service_outbox`.
- [ ] `coalesced_with_outbox_id` nullable for duplicate suppression.
- [ ] `attempt_count`, `last_error`, `locked_at`, `locked_by` if using DB-level worker leases.
- [ ] `created_at`, `updated_at`, `outboxed_at`, `terminal_at`.
- [ ] Unique index on `(bulk_job_id, target_key)`.
- [ ] Index on `(bulk_job_id, status)`.
- [ ] Index on `(idempotency_key)` for dedupe lookup.

### `admin_bulk_job_requests`

Checklist:

- [ ] Primary key.
- [ ] `bulk_job_id` foreign key.
- [ ] `idempotency_key` or request hash.
- [ ] `dedupe_key`.
- [ ] Request body snapshot with explicit target list omitted/truncated if too large, or stored in normalized target table.
- [ ] Actor/admin metadata.
- [ ] `created_at`.
- [ ] Unique index on idempotency key when provided.
- [ ] Index on `dedupe_key` for repeated-click coalescing.

### `admin_bulk_job_events`

Checklist:

- [ ] Primary key.
- [ ] `bulk_job_id` foreign key.
- [ ] Optional `bulk_job_target_id` foreign key.
- [ ] `event_type`: created, previewed, enumeration_started, target_enumerated, fanout_started, target_outboxed, target_coalesced, paused, resumed, cancel_requested, canceled, failed, completed.
- [ ] `message`.
- [ ] `metadata` json/jsonb.
- [ ] `created_at`.
- [ ] Index on `(bulk_job_id, created_at)`.

### `service_outbox` extension

Checklist:

- [ ] Add nullable `bulk_job_id`.
- [ ] Add nullable `bulk_job_target_id`.
- [ ] Add nullable `idempotency_key`.
- [ ] Add nullable `correlation_id`.
- [ ] Add indexes for bulk diagnostics: `(bulk_job_id)`, `(bulk_job_target_id)`, `(idempotency_key)`, `(correlation_id)`.
- [ ] Consider unique partial index for active idempotency keys, e.g. unique where `state in ('pending','processing')` if compatible with existing retry behavior.
- [ ] Avoid changing existing delivery states in the first migration; derive canceled/paused at bulk-job level.
- [ ] Backfill not required for existing rows; metadata columns are nullable.

## File/module plan

### Admin routes

Update or add modules around:

- `src/http/routes/admin-api.ts`
  - Keep existing small batch endpoint behavior initially.
  - Add new bulk-job endpoints or route registrations.
  - Reuse existing admin auth/authorization patterns.
- Optional split if route file is too large:
  - `src/http/routes/admin-bulk-jobs-api.ts`
  - `src/http/routes/admin-bulk-jobs.schemas.ts`

### Bulk job domain module

Create modules such as:

- `src/modules/admin-bulk-jobs/admin-bulk-job.types.ts`
- `src/modules/admin-bulk-jobs/admin-bulk-job.repo.ts`
- `src/modules/admin-bulk-jobs/admin-bulk-job.service.ts`
- `src/modules/admin-bulk-jobs/admin-bulk-job-worker.ts`
- `src/modules/admin-bulk-jobs/admin-bulk-job-progress.service.ts`
- `src/modules/admin-bulk-jobs/admin-bulk-job-dedupe.service.ts`

Responsibilities:

- Repository: SQL reads/writes, row claiming, status transitions, counters.
- Service: API-facing validation, create/preview/list/detail/control operations.
- Worker: enumeration/fanout loops, leases, retryable units of work.
- Progress service: summarize target and outbox state.
- Dedupe service: idempotency keys, request hashes, coalescing decisions.

### Outbox integration

Update:

- `src/modules/outbox/recommendation-outbox.service.ts`
  - Accept optional `bulkJobId`, `bulkJobTargetId`, `idempotencyKey`, and `correlationId`.
  - Generate stable idempotency keys for bulk recompute targets instead of fresh-only correlation IDs.
- `src/modules/outbox/service-outbox.repo.ts`
  - Insert metadata columns.
  - Query linked outbox rows for diagnostics.
  - Preserve existing pending/processing/dispatched/failed handling.

### Worker entrypoints

Options:

- Add `src/bin/admin-bulk-job-worker.ts` for an independent worker process.
- Or register the worker in the existing worker process if `src/bin/worker.ts` already hosts background jobs.

Checklist:

- [ ] Add package script if creating a new bin: `dev:admin-bulk-worker`, `start:admin-bulk-worker`.
- [ ] Add Docker/process manager configuration for production deployment.
- [ ] Add graceful shutdown handling.
- [ ] Add configurable batch sizes and sleep intervals.

## API checklist

### Create bulk recompute job

Endpoint candidate:

- `POST /admin/recommendations/recompute-jobs`

Request fields:

- `scope.type`: `explicit_targets`, `all_users`, or `tier`.
- `scope.tier`: required for tier scope.
- `targets`: account/profile pairs for explicit scope.
- `mode`: `enqueue` or `preview` if preview is not a separate endpoint.
- `reason`: admin-visible reason.
- `idempotencyKey`: optional client-provided key.
- `dedupeWindowSeconds`: optional, bounded by server config.
- `correlationId`: optional; server generates one only when not provided.

Response fields:

- `jobId`.
- `status`.
- `scope`.
- `dedupeKey`.
- `idempotencyKey`.
- `created` vs `coalescedWithExistingJob`.
- Initial counters/estimate.

Checklist:

- [ ] Validate tier against known account tiers.
- [ ] Validate explicit targets are below a safe API payload limit, even though async fanout handles large work.
- [ ] Normalize duplicate explicit targets before storing.
- [ ] Return existing active job when request dedupes/coalesces.
- [ ] Record request in `admin_bulk_job_requests`.
- [ ] Record `created` or `coalesced` event.

### Preview job

Endpoint candidate:

- `POST /admin/recommendations/recompute-jobs/preview`

Checklist:

- [ ] For explicit targets, return normalized target count and invalid target count.
- [ ] For tier/all-users, return an estimate using indexed account/profile queries.
- [ ] Do not enqueue outbox rows.
- [ ] Optionally create a request/event record only if audit requires previews.

### List jobs

Endpoint candidate:

- `GET /admin/recommendations/recompute-jobs`

Filters:

- status
- scope type
- tier
- created time range
- requested admin
- operation

Checklist:

- [ ] Paginate by cursor or limit/offset matching existing API style.
- [ ] Include counters and percentage progress.
- [ ] Include latest event summary.

### Job detail

Endpoint candidate:

- `GET /admin/recommendations/recompute-jobs/:jobId`

Checklist:

- [ ] Return full job metadata and counters.
- [ ] Return phase/checkpoint information.
- [ ] Return linked outbox summary by state.
- [ ] Return recent events or event pagination link.

### Job events

Endpoint candidate:

- `GET /admin/recommendations/recompute-jobs/:jobId/events`

Checklist:

- [ ] Paginate events by `created_at` and event ID.
- [ ] Allow filtering by event type.
- [ ] Include target ID when relevant.

### Pause/resume/cancel

Endpoint candidates:

- `POST /admin/recommendations/recompute-jobs/:jobId/pause`
- `POST /admin/recommendations/recompute-jobs/:jobId/resume`
- `POST /admin/recommendations/recompute-jobs/:jobId/cancel`

Checklist:

- [ ] Pause allowed only from `queued`, `enumerating`, or `fanout`.
- [ ] Resume allowed only from `paused`.
- [ ] Cancel allowed from `queued`, `enumerating`, `fanout`, or `paused`.
- [ ] Make controls idempotent.
- [ ] Record control events.
- [ ] Do not mutate already dispatched outbox rows.

### Outbox diagnostics

Endpoint candidate:

- `GET /admin/recommendations/recompute-jobs/:jobId/outbox`

Checklist:

- [ ] Summarize linked `service_outbox` rows by delivery state.
- [ ] Include failed row sample with error metadata if available.
- [ ] Include pending/processing age buckets.
- [ ] Link target status counts to outbox state counts.
- [ ] Extend existing diagnostics in `src/http/routes/admin-api.ts:118-141` or add a dedicated bulk diagnostics endpoint.

## Worker algorithm checklist

### Claim loop

- [ ] Poll for `queued`, `enumerating`, `fanout`, and resumable jobs.
- [ ] Claim using DB transaction and `FOR UPDATE SKIP LOCKED` or existing repository lease pattern.
- [ ] Set `locked_at`/`locked_by` if lease columns are used.
- [ ] Refresh job status before each batch.
- [ ] Stop quickly on shutdown signal.

### Enumeration loop

For `all_users`:

- [ ] Page through active accounts/profiles using stable cursor order.
- [ ] Store cursor/checkpoint after each batch.
- [ ] Insert targets with `ON CONFLICT DO NOTHING` on `(bulk_job_id, target_key)`.
- [ ] Increment counters based on inserted rows.

For `tier`:

- [ ] Page through accounts/profiles filtered by account tier.
- [ ] Reuse existing tier source of truth used by `src/http/routes/admin-api.ts:169-190`.
- [ ] Decide whether tier is evaluated at job creation time or enumeration time; document behavior in API response.

For explicit targets:

- [ ] Normalize and validate target identities.
- [ ] Insert targets directly from request payload.
- [ ] Mark enumeration complete immediately after normalized target insertion.

Control checks:

- [ ] If paused, persist checkpoint and stop enumeration.
- [ ] If canceling, mark undiscovered/queued targets canceled where applicable and stop enumeration.
- [ ] Record enumeration started/completed events.

### Fanout loop

- [ ] Claim queued targets in batches.
- [ ] Generate stable target idempotency key from operation, account ID, profile ID, recompute reason/version, and dedupe window.
- [ ] Check active equivalent outbox rows by `idempotency_key`.
- [ ] If active equivalent exists, mark target `coalesced` and link `coalesced_with_outbox_id`.
- [ ] Otherwise append recommendation recompute outbox row with bulk metadata.
- [ ] Mark target `outboxed` and link `service_outbox_id` in the same transaction when possible.
- [ ] Update job counters incrementally.
- [ ] Respect pause/cancel between batches.
- [ ] Record fanout started/completed events.

### Progress reconciliation loop

- [ ] Periodically update target `dispatched` for linked outbox rows in `dispatched` state.
- [ ] Mark target `failed` for terminal outbox failures if retry policy is exhausted.
- [ ] Recompute job counters from targets when incremental counters drift.
- [ ] Mark job `completed` only when enumeration and fanout are complete and all targets are terminal enough for the product definition.
- [ ] Record completion/failure events exactly once.

### Retry and failure handling

- [ ] Retry transient DB errors with bounded backoff.
- [ ] Mark target-level failures without failing the whole job unless failure ratio crosses a configured threshold.
- [ ] Mark job `failed` for schema/configuration/programming errors that prevent safe continuation.
- [ ] Store sanitized errors in `last_error`.

## Dedupe and coalescing plan

### Request-level idempotency

- [ ] If admin supplies `idempotencyKey`, return the same job for identical retried requests.
- [ ] Reject conflicting request payloads with the same idempotency key.
- [ ] Store normalized request hash in `admin_bulk_job_requests`.

### Job-level coalescing

- [ ] Build `dedupe_key` from operation, scope, tier/target set hash where applicable, reason/recompute mode, and dedupe window bucket.
- [ ] If an active compatible job exists, return it instead of creating another job.
- [ ] Define active statuses as `queued`, `enumerating`, `fanout`, and `paused` unless canceling jobs should also coalesce.
- [ ] Record coalesced requests for audit.

### Target/outbox-level coalescing

- [ ] Generate stable `idempotency_key` per recompute target.
- [ ] Avoid inserting duplicate pending/processing outbox rows for the same target.
- [ ] Decide whether failed outbox rows should be reused, retried, or bypassed with a new row.
- [ ] Preserve existing outbox dispatcher behavior.

## Tests checklist

### Repository tests

- [ ] Migration creates all new tables, columns, constraints, and indexes.
- [ ] Job create/list/detail queries work with filters and pagination.
- [ ] Worker claim queries do not double-claim jobs or targets.
- [ ] Target insertion is idempotent under duplicate explicit targets.
- [ ] Progress counters reconcile correctly from target rows and outbox rows.

### Service tests

- [ ] Create explicit-target job stores normalized targets and request audit row.
- [ ] Create all-users job stores scope and does not enumerate in request.
- [ ] Create tier jobs for free/pro/ultra validate tier and store scope.
- [ ] Preview returns estimates without creating outbox rows.
- [ ] Pause/resume/cancel transitions are valid and idempotent.
- [ ] Invalid transitions return appropriate admin API errors.
- [ ] Request idempotency returns same job on retry.
- [ ] Conflicting idempotency key returns conflict.
- [ ] Repeated admin clicks coalesce according to dedupe window.

### Worker tests

- [ ] Enumeration resumes from checkpoint after interruption.
- [ ] Fanout creates outbox rows with `bulk_job_id`, `bulk_job_target_id`, `idempotency_key`, and `correlation_id`.
- [ ] Fanout coalesces when active equivalent outbox row exists.
- [ ] Pause stops new target/outbox creation after current batch.
- [ ] Resume continues from checkpoint.
- [ ] Cancel marks remaining queued targets canceled and stops new outbox creation.
- [ ] Completion waits for target/outbox terminal states according to defined completion semantics.
- [ ] Worker handles concurrent instances safely.

### Route/API tests

- [ ] Admin auth applies to all new endpoints.
- [ ] Create/list/detail/preview/control/events/outbox diagnostics response schemas are stable.
- [ ] Pagination and filters work.
- [ ] Error responses match existing admin API style.

### Regression tests

- [ ] Existing per-profile recompute endpoint still appends outbox events.
- [ ] Existing explicit max-50 behavior remains unchanged until intentionally migrated.
- [ ] Existing outbox dispatcher continues processing rows with null bulk metadata.
- [ ] Existing diagnostics continue working for non-bulk rows.

## Rollout checklist

### Phase 1: Schema foundation

- [ ] Add migrations for bulk tables and nullable outbox metadata.
- [ ] Deploy with no behavior changes.
- [ ] Verify existing outbox dispatcher handles new nullable columns.
- [ ] Add repository/service skeleton behind no public route or disabled route flag.

### Phase 2: Async explicit profile/account jobs

- [ ] Add create/list/detail APIs for explicit target jobs.
- [ ] Add worker fanout for explicit targets only.
- [ ] Keep existing max-50 endpoint as the default operational path.
- [ ] Run canary jobs with small explicit target lists.
- [ ] Compare linked outbox diagnostics to existing route behavior.

### Phase 3: All-users and tier enumeration

- [ ] Add preview endpoint for all-users and tier scopes.
- [ ] Add enumeration loop for all users.
- [ ] Add enumeration loop for free/pro/ultra tiers.
- [ ] Add rate/batch controls per environment.
- [ ] Canary on smallest tier or limited internal cohort if available.

### Phase 4: Progress, pause, resume, cancel

- [ ] Add job events endpoint.
- [ ] Add pause/resume/cancel APIs.
- [ ] Add progress reconciliation loop.
- [ ] Add outbox diagnostics endpoint.
- [ ] Exercise controls during canary jobs.

### Phase 5: Advanced dedupe/coalescing

- [ ] Add request-level idempotency handling.
- [ ] Add job-level dedupe keys and active job coalescing.
- [ ] Add target/outbox idempotency keys.
- [ ] Add unique/partial indexes only after validating behavior with production-like data.
- [ ] Emit audit events for coalesced clicks.

### Phase 6: Production hardening

- [ ] Add worker metrics, alerts, and dashboards.
- [ ] Add config for max concurrent jobs, batch size, dedupe window, and pause polling interval.
- [ ] Add retention job for old bulk metadata.
- [ ] Document runbooks for stuck jobs, failed targets, and outbox backlog.
- [ ] Decide when or whether to migrate existing max-50 admin endpoint onto the bulk framework.

## Cleanup and retention checklist

- [ ] Define retention period for `admin_bulk_job_events`.
- [ ] Define retention period for completed/canceled/failed jobs and targets.
- [ ] Keep enough metadata to audit who triggered all-users or tier-wide recomputes.
- [ ] Avoid deleting bulk job rows that are still referenced by retained `service_outbox` rows unless foreign keys are nullable/on-delete-safe.
- [ ] Add cleanup script or scheduled worker task.
- [ ] Archive or summarize large event streams before deletion if audit requires it.
- [ ] Ensure cleanup does not break diagnostics for recent outbox failures.

## Observability checklist

- [ ] Log job lifecycle transitions with `jobId`, `scope`, `tier`, `correlationId`, and worker ID.
- [ ] Log target fanout failures with sanitized account/profile identifiers per existing privacy policy.
- [ ] Emit metrics for jobs by status.
- [ ] Emit metrics for targets enumerated/outboxed/coalesced/failed/canceled.
- [ ] Emit worker loop latency and batch sizes.
- [ ] Emit outbox backlog by bulk job and age bucket.
- [ ] Alert on stuck `enumerating`/`fanout` jobs beyond expected duration.
- [ ] Alert on high target failure ratio.
- [ ] Alert when outbox pending/processing age exceeds operational threshold.

## Security and safety checklist

- [ ] Require existing admin authorization for all endpoints.
- [ ] Add extra authorization or confirmation flow for all-users jobs if the product requires it.
- [ ] Store admin actor and reason for every job.
- [ ] Redact sensitive data from events and errors.
- [ ] Bound preview and list endpoints to avoid expensive unindexed scans.
- [ ] Enforce server-side max explicit target payload size.
- [ ] Add rate limits or dedupe windows to prevent repeated-click storms.
- [ ] Ensure pause/cancel controls are audit logged.

## Acceptance criteria

- [ ] Admin can create an explicit-target recompute job and receive a job ID immediately without waiting for all outbox rows to be appended.
- [ ] Admin can create all-users, free-tier, pro-tier, and ultra-tier recompute jobs through durable async flow.
- [ ] Jobs survive API/worker restarts and continue from persisted checkpoints.
- [ ] Admin can list jobs and view detail/progress/events.
- [ ] Admin can pause, resume, and cancel jobs with idempotent controls.
- [ ] Repeated identical admin clicks within the dedupe window do not create unbounded duplicate jobs or outbox rows.
- [ ] Existing outbox dispatcher continues to deliver recompute events without a rewrite.
- [ ] Existing non-bulk recompute behavior remains compatible.
- [ ] Diagnostics can explain job progress using bulk tables and linked outbox rows.
- [ ] Tests cover repository, service, worker, route, and regression behavior.

## Risks and open questions

- What is the canonical account/profile source for all-users enumeration, and should inactive/deleted/suspended profiles be excluded?
- Should tier membership be captured at job creation time or evaluated dynamically during enumeration?
- What exact recompute target identity is required: account-level, profile-level, or both?
- How should failed outbox rows interact with idempotency keys: retry same row, create a new row, or mark target failed?
- Should job completion mean outbox rows were created, dispatched, or fully consumed by downstream recompute handlers?
- What retention/audit requirements apply to all-users recompute operations?
- Should all-users jobs require a second admin confirmation or elevated permission?
- How should workers be deployed: separate process, existing worker, or queue framework integration?
- What maximum fanout rate is safe for recommender downstream dependencies?
- Is Redis/BullMQ already operationally preferred, or should this framework remain purely Postgres-backed?

## Implementation order

1. Confirm target identity and enumeration source of truth.
2. Add schema migrations for bulk tables and outbox metadata.
3. Implement bulk job repository with create/list/detail/events/control primitives.
4. Implement explicit-target job creation and preview service methods.
5. Add create/list/detail/preview routes behind admin auth.
6. Extend recommendation outbox service/repository to accept bulk metadata.
7. Implement worker claim loop and explicit-target fanout.
8. Add repository/service/worker tests for explicit jobs and existing outbox compatibility.
9. Add all-users enumeration with checkpoints.
10. Add tier enumeration for free/pro/ultra with checkpoints.
11. Add progress reconciliation and linked outbox diagnostics.
12. Add pause/resume/cancel controls and tests.
13. Add request-level idempotency, job-level dedupe, and target/outbox coalescing.
14. Add production hardening: metrics, alerts, config, runbooks, retention cleanup.
15. Decide whether to route the old max-50 admin recompute endpoint through the bulk framework or keep it as a lightweight synchronous shortcut.
