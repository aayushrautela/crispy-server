# Recommendation Generation Cutover Plan

This file tracks the migration from the old BullMQ-driven recommendation scheduling path to the new DB-driven scheduler model.

## Goals

- Run recommendation generation on a single contract version: `v3.2.1`
- Remove recommendation dependence on BullMQ
- Make local Postgres job state the source of truth
- Stop fake-success admin behavior
- Keep remaining non-recommendation queue jobs working with Bull-safe job IDs

## Current State

### Done

- Contract hard cut completed in both repos
  - `v3.2.1` only
  - `trackedSeries` only
  - stricter worker response validation on server
- Added migration `migrations/0040_recommendation_generation_scheduler_cutover.sql`
- Replaced recommendation job repo with DB-scheduler model
  - `next_run_at`
  - `trigger_source`
  - `lease_owner`
  - `lease_expires_at`
- Replaced recommendation orchestrator with DB-driven processing model
- Switched dispatcher off Bull enqueue and onto orchestrator job creation/reuse
- Removed recommendation-specific Bull handlers/files
- Removed recommendation-specific Bull queue helpers
- Switched remaining Bull job IDs to safe encoded IDs
- Updated admin start route to return local job state instead of `{ queued: true }`
- Updated admin button messaging away from blind queue wording

### In Progress

- Run migration-aware validation and end-to-end checks

### Not Done Yet

- Run migration-aware validation and end-to-end checks

## Remaining Work

### 1. Completed Cutover Work

Done:

- Fixed all post-cutover tests and typecheck failures
- Updated recommendation trigger callers to pass explicit trigger sources:
  - `watch_event`
  - `heartbeat_flush`
  - `provider_import`
- Updated admin jobs UI from `nextPollAt` to `nextRunAt`
- Removed stale queue wording and recommendation Bull references in `src`
- Confirmed focused admin recommendation tests pass
- Confirmed `npm run typecheck` passes

Validation already completed:

- `npm test -- src/modules/recommendations/recommendation-generation-orchestrator.service.test.ts src/modules/recommendations/recommendation-generation-jobs.repo.test.ts src/modules/recommendations/recommendation-admin.service.test.ts src/http/routes/admin-api-auth.test.ts src/http/routes/internal-admin-recommendations.test.ts`
- `npm run typecheck`
- stale reference search in `src` for old recommendation Bull/UI terms returned no matches

### 2. Validate Migration + Runtime Behavior

What to verify:

- Admin manual trigger creates or reuses a durable local recommendation job
- Jobs page shows the local job immediately
- Worker processes due recommendation jobs from DB without recommendation Bull jobs
- Recommendation engine accepts `v3.2.1`
- Remaining Bull-backed jobs still work with the new encoded job IDs

Suggested checks:

- run server migration locally / on target env
- click admin generate button
- inspect `recommendation_generation_jobs`
- confirm worker logs show DB-driven processing
- confirm no recommendation Bull jobs are being produced
- confirm jobs UI shows `nextRunAt` / updated wording as expected

## Tracking Checklist

- [x] Contract hard cut to `v3.2.1`
- [x] Add recommendation scheduler migration
- [x] Replace recommendation job repo
- [x] Replace recommendation orchestrator
- [x] Move dispatcher off Bull
- [x] Remove recommendation Bull handlers/helpers
- [x] Make Bull job IDs safe for remaining jobs
- [x] Return local job state from admin start route
- [x] Fix tests and typecheck after cutover
- [x] Update trigger callers with explicit trigger sources
- [x] Update admin jobs UI from `nextPollAt` to `nextRunAt`
- [x] Remove remaining stale recommendation Bull references
- [ ] Validate migration and end-to-end runtime behavior

## Commands

Focused checks:

```bash
npm test -- src/modules/recommendations/recommendation-generation-orchestrator.service.test.ts src/modules/recommendations/recommendation-generation-jobs.repo.test.ts src/modules/recommendations/recommendation-admin.service.test.ts src/http/routes/admin-api-auth.test.ts src/http/routes/internal-admin-recommendations.test.ts
```

```bash
npm run typecheck
```

Search for stale old-path references:

```bash
rg "nextPollAt|oldestNextPollAt|generate-recommendations|poll-recommendation-generation|Recommendation generation queued|Queueing recommendation generation" src
```
