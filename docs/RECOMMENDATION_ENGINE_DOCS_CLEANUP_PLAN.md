# Recommendation Engine Documentation Cleanup Plan

## Status

This is a documentation-only cleanup plan.

Current confirmed product/architecture decision:

- the recommendation engine is a pull-based external service
- the recommendation engine is responsible for calling the API Server to get the data it needs
- the recommendation engine is not a worker in this repository
- the API Server no longer owns submission, polling, or queue lifecycle for recommendation generation as if the engine were a server-side worker
- the only worker runtime owned by this repository is the BullMQ worker used for internal backend jobs

No code changes are part of this plan.

## Why This Cleanup Exists

The repository still contains documentation and contract language from an older async worker design where the API Server submitted generation jobs to a Recommendation Worker and then polled for completion. That language now conflicts with the confirmed active architecture.

The active architecture is simpler at the system boundary:

- Crispy Server owns application data, canonical media identity, stored recommendation snapshots, and user/profile authorization.
- The external recommendation engine owns recommendation-generation behavior and decides when to pull source data from Crispy Server APIs.
- The engine is an external service, not the BullMQ worker runtime and not a module that directly reads this repository's database.
- The engine should use documented API endpoints and service authentication to fetch only the data it is allowed to read.

This cleanup should prevent future implementers from confusing three different concepts:

1. the external recommendation engine/service
2. the old Recommendation Worker contract
3. the internal BullMQ worker process

## Audit Cross-Check

Known active-doc conflicts to resolve or explicitly archive during this cleanup:

| File | Current conflict | Required treatment |
|---|---|---|
| `README.md` | Describes a stateless/server-orchestrated recommendation worker invoked by the API Server. | Replace with external pull-based recommendation engine language; remove local worker/run implications if stale. |
| `DEPLOY.md` | Describes API Server orchestration, payload building, and calls to a stateless recommendation worker. | Separate internal deployment units from external dependencies; clarify the engine pulls data from API Server APIs. |
| `AGENT.md` | States server-orchestrated recommendation generation and lists `show:tvdb:*` / `anime:kitsu:*` as canonical outputs. | Update guardrails to pull-based external engine and TMDB-backed canonical identity. |
| `RECOMMENDATION_ENGINE_CONTRACT.md` | Current pull-based external recommendation engine integration contract. | Keep as the active source of truth. |
| `docs/MEDIA_TYPE_CLASSIFICATION_PLAN.md` | Contains old TVDB/Kitsu provider-authority and first-class anime identity examples. | Treat as historical/obsolete unless rewritten; do not leave it looking like active architecture. |

Do not treat stale search hits inside this cleanup plan, an archived document, or an obsolete-bannered historical plan as failures. The failure condition is stale language in active docs without a warning or replacement.

## Source-of-Truth Architecture

The documentation set should converge on the following source-of-truth statements.

### Runtime ownership

| Area | Owner |
|---|---|
| Account/profile ownership and authorization | API Server |
| Watch history, ratings, watchlist, continue watching, episodic follow | API Server |
| Canonical media identity and metadata projections | API Server |
| Stored recommendation snapshots served to clients | API Server |
| Recommendation model logic and generation strategy | External recommendation engine |
| Pulling eligible source data for generation | External recommendation engine, through API Server APIs |
| Internal queue jobs for this repository | BullMQ worker |

### Data access boundary

The external recommendation engine must not be documented as reading Crispy Server storage directly.

Correct boundary:

- The engine calls API Server endpoints.
- The API Server authenticates and authorizes service requests.
- The API Server returns bounded, canonical, sanitized source data.
- The engine returns or publishes recommendation outputs through the agreed integration surface.

Incorrect boundary to remove from docs:

- API Server builds a full generation payload and pushes it to a worker.
- API Server polls the worker for job status.
- Recommendation Worker owns job IDs for API Server-submitted generation jobs.
- Recommendation Worker directly consumes API Server database tables.

### Identity source of truth

The active backend architecture uses TMDB-only canonical metadata identity.

Documentation should state:

- `mediaKey` remains the public/watch-domain identity.
- Runtime canonical keys are TMDB-backed:
  - `movie:tmdb:{tmdbId}`
  - `show:tmdb:{tmdbId}`
  - `season:tmdb:{showTmdbId}:{seasonNumber}`
  - `episode:tmdb:{showTmdbId}:{seasonNumber}:{episodeNumber}`
  - `person:tmdb:{tmdbId}`
- TVDB and Kitsu IDs may remain as import-source bookkeeping, external IDs, or compatibility crosswalk fields where code still uses them.
- TVDB and Kitsu are not canonical runtime identity providers.
- Anime-origin titles are represented as ordinary TMDB `movie` or `show` content.
- There is no first-class backend `anime` media type in the current architecture.

## Terminology Changes

Use this replacement table across README, deployment docs, agent guidance, contracts, and comments in documentation.

| Old term | Preferred term | Notes |
|---|---|---|
| Recommendation Worker | external recommendation engine | Use when describing the external recommendation system. |
| obsolete push/poll integration contract | engine integration contract | Use for service-to-service API boundaries. |
| worker team | recommendation engine team | Avoid implying the service is this repo's BullMQ worker. |
| submit generation job | expose/pull generation source data | Only use submit language if a future push contract is explicitly reintroduced. |
| poll worker status | engine-managed lifecycle | The API Server should not be documented as polling an external worker unless the active contract says so. |
| worker queue | engine-internal scheduling | Do not prescribe the external engine's internal implementation. |
| BullMQ worker | internal BullMQ worker | Use only for the process in this repository that handles backend queue jobs. |

Recommended canonical phrasing:

```text
The recommendation engine is an external pull-based service. It calls authenticated API Server endpoints to retrieve profile, watch, rating, watchlist, and metadata context needed for generation. Crispy Server remains the source of truth for user data and canonical media identity; the engine remains the source of truth for recommendation-generation logic.
```

## Documentation Inventory and Actions

### `architecture.md`

Action: update.

Required changes:

- Add the external recommendation engine to the system boundary as a separate external service.
- Keep `Worker runtime: BullMQ worker`, but clarify that this means the internal BullMQ worker only.
- Under module layout, clarify that `recommendations` owns stored recommendation data, read models, and API integration surfaces, not the recommendation-generation engine itself.
- Add a `Recommendation Model` or similar section stating that recommendation generation is pull-based and external.
- Keep TMDB-only canonical identity language unchanged.
- Ensure no language suggests TVDB/Kitsu provider authority or backend `anime` identity.

Suggested wording:

```text
Recommendation generation is delegated to an external pull-based recommendation engine. The engine calls API Server endpoints to retrieve authorized source data. It is not this repository's BullMQ worker and does not read the application database directly.
```

### `README.md`

Action: update.

Required changes:

- Replace references to a Recommendation Worker with external recommendation engine/service.
- If README lists runtimes, distinguish:
  - API Server: Fastify
  - internal worker: BullMQ
  - recommendation engine: external service, not started by this repository unless explicitly documented elsewhere
- Remove setup instructions that imply a local recommendation worker process exists in this repo if they are stale.
- Ensure any recommendation environment variables match the pull-based architecture.
- Link to the updated integration contract once created or renamed.

### `DEPLOY.md`

Action: update.

Required changes:

- Separate internal deployment units from external dependencies.
- Internal units:
  - API Server
  - BullMQ worker
  - Postgres
  - Redis
- External dependencies:
  - external recommendation engine
  - auth provider
  - metadata/import/AI providers as applicable
- Remove steps that deploy a Recommendation Worker from this repository.
- Add any service-auth, network allowlist, base URL, or callback/publish endpoint requirements needed by the external engine.
- Clarify that scaling the BullMQ worker does not scale recommendation generation.

### `AGENT.md`

Action: update.

Required changes:

- Add a high-priority instruction that recommendation generation is external and pull-based.
- Tell agents not to reintroduce `Recommendation Worker` terminology for the external engine.
- Tell agents not to modify code toward push-based submit/poll semantics unless explicitly requested.
- Tell agents to preserve the distinction between the internal BullMQ worker and the external recommendation engine.
- Add a documentation search checklist for stale worker language.

### `RECOMMENDATION_ENGINE_CONTRACT.md`

Action: keep current.

The obsolete API Server -> Recommendation Worker async push/poll contract has been deleted. Use `RECOMMENDATION_ENGINE_CONTRACT.md` as the active integration contract for the pull-based external recommendation engine.

Required active contract content:

- State that the engine is pull-based.
- Define service authentication for engine-to-API calls.
- Define source-data discovery and retrieval endpoints the engine may call.
- Define output ingestion or publication semantics if the API Server receives recommendation results.
- Define identity constraints using TMDB-backed `mediaKey` values.
- Define rate limits, pagination, profile scoping, and freshness semantics.
- Define idempotency and retry semantics for result ingestion, not for old API Server -> worker generation submission.
- Define sensitive-field and logging restrictions.
- Define what data the engine must not access.
- Define operational endpoints only if they are part of the service boundary.

If the old file remains temporarily, add this banner at the top:

```markdown
> Archived contract. This document describes an obsolete API Server -> Recommendation Worker async push/poll design. The active architecture is a pull-based external recommendation engine that calls API Server endpoints for source data. Do not implement new code from this contract.
```

### Existing planning docs under `docs/`

Action: no immediate changes unless they mention recommendation-worker behavior.

Rules:

- Preserve archived planning docs as historical context.
- Do not revive TVDB/Kitsu provider-authority plans.
- If a planning doc contains stale recommendation-worker assumptions, add an archive warning rather than rewriting the whole historical plan.

## Contract Cleanup Plan

The old contract is push-based:

```text
API Server -> POST /v1/generations -> Recommendation Worker
API Server -> GET /v1/generations/:jobId -> Recommendation Worker
```

The current architecture is pull-based:

```text
External recommendation engine -> authenticated API Server data endpoints
External recommendation engine -> result publication path, if applicable
API Server -> serves stored recommendation snapshots to clients
```

The updated contract should answer these questions before implementation changes are made:

1. How does the external engine authenticate to Crispy Server?
2. Which profiles or accounts is the engine allowed to inspect?
3. How does the engine discover work to do?
4. Which API endpoints return source data for generation?
5. Are source-data endpoints snapshot-based, cursor-based, or page-based?
6. How are generated recommendation outputs returned to the API Server?
7. Does the engine push results back, or does the API Server pull finished outputs from the engine?
8. What are the canonical identity requirements for returned recommendation items?
9. What freshness, idempotency, and retry semantics are required?
10. Which fields are sensitive and must never be logged?

Do not retain old submit/poll job lifecycle language unless the active architecture explicitly reintroduces that behavior for result delivery. If result delivery uses a push callback from the engine to the API Server, describe it as result ingestion/publication rather than as API Server-submitted generation jobs.

## Active vs Historical Documentation Rules

Use these rules when deciding whether to rewrite, archive, or leave a document unchanged:

- Active docs (`README.md`, `DEPLOY.md`, `AGENT.md`, `architecture.md`, current contracts, and environment setup docs) must be updated to the confirmed pull-based architecture.
- Historical plans may keep obsolete details only when they are clearly marked as historical/obsolete at the top.
- If a stale plan is not clearly archived and its title/placement makes it look actionable, add an obsolete banner rather than fully rewriting the historical content.
- Search hits inside `docs/archive/` or obsolete-bannered plans are acceptable if the banner prevents implementation from those details.
- Search hits in `.env.example`, deployment templates, or secret-manager examples should be treated as active operational guidance and verified before removal or optionalization.

Suggested banner for obsolete provider-authority plans:

```markdown
> Archived/historical plan. This document predates the current TMDB-only canonical identity architecture and may mention TVDB/Kitsu provider authority or first-class anime identity. Do not implement new code from those assumptions; use `architecture.md` and the current recommendation engine contract instead.
```

## TVDB/Kitsu Canonical Identity Cleanup

The current source-of-truth architecture says canonical metadata identity is TMDB-only. Documentation cleanup should remove or archive language that says otherwise.

### Remove from active docs

- `show -> TVDB` authority rules.
- `anime -> Kitsu` authority rules.
- First-class backend `anime` media type claims.
- Search routing that says `anime` fans out to Kitsu as a canonical backend bucket.
- Recommendation identity examples that allow `show:tvdb:*` or `anime:kitsu:*` as active canonical output.
- Any claim that TVDB/Kitsu provider IDs are required for recommendation identity.

### Keep only as historical or compatibility context

- TVDB may appear as an external ID/crosswalk when TMDB or imports expose it.
- TVDB/Kitsu IDs may remain active import mappings or source-system identifiers when needed to reconcile imported data.
- Kitsu may appear in old archived plans, but not as active runtime architecture.
- Import-source bookkeeping may mention original provider identifiers, but canonical runtime identity remains TMDB-backed.

### Recommendation output rule

Recommendation result items should use canonical TMDB-backed media keys unless a future architecture document changes this rule.

Allowed active examples:

```text
movie:tmdb:550
show:tmdb:1396
episode:tmdb:1396:5:14
```

Disallowed active examples:

```text
show:tvdb:81189
anime:kitsu:1
episode:kitsu:1:24
```

## Environment Variable Cleanup

Documentation should distinguish active environment variables from stale provider-authority variables.

### `TVDB_API_KEY`

Action: remove from active required env documentation unless code still requires it for a compatibility crosswalk.

If still present in code for compatibility, document it as optional and non-canonical:

```text
TVDB_API_KEY is optional and may be used only for compatibility lookups/crosswalk enrichment. It does not make TVDB a canonical metadata authority.
```

### `TVDB_PIN`

Action: remove from active required env documentation unless there is verified runtime usage.

If no active runtime use remains, mark for deletion from:

- README environment setup
- deployment examples
- secret manager templates
- `.env.example` or equivalent files
- hosting-provider variable lists

### Kitsu-related variables

Action: remove from active required env documentation unless there is verified runtime usage.

If mentioned only by archived provider-authority plans, leave those references archived and clearly historical.

### Recommendation engine variables

Action: verify and document the active pull-based variables.

Potential categories:

- API base URL that the engine calls
- service authentication key or token
- allowed service ID/audience
- result ingestion endpoint secret, if results are pushed back
- webhook/callback secret, if callbacks exist

Do not reuse old worker variable names if they imply this repository starts or owns the engine process.

## BullMQ Worker vs External Recommendation Engine

Active docs should include this distinction wherever deployment or architecture is discussed.

| Concept | Lives in this repo | Purpose | Scaling impact |
|---|---:|---|---|
| Internal BullMQ worker | Yes | Runs backend queue jobs owned by Crispy Server | Scaling affects internal async jobs only |
| External recommendation engine | No | Generates recommendations using data pulled from API Server | Scaling affects recommendation generation |

Rules:

- Do not call the external recommendation engine the BullMQ worker.
- Do not call the BullMQ worker the recommendation engine.
- Do not document recommendation generation as a BullMQ job unless code and architecture are explicitly changed to that model.
- If BullMQ is used for internal bookkeeping around recommendations, document it as API Server orchestration/bookkeeping, not generation ownership.

## Validation and Search Checklist

Run these searches during cleanup and inspect each active-doc hit.

### Worker terminology

Search terms:

```text
Recommendation Worker
recommendation worker
server-orchestrated
stateless recommendation worker
obsolete push/poll integration contract
Worker team
/v1/generations
idempotency-key
pollAfterSeconds
queued
running
```

Expected outcome:

- Active docs should not describe API Server -> Recommendation Worker submit/poll architecture.
- Archived docs may retain old terms only with a clear obsolete banner.

### Pull-based architecture terms

Search terms:

```text
recommendation engine
external recommendation service
pull-based
service auth
source data
```

Expected outcome:

- Active architecture, README/deploy docs, and the current contract should consistently describe the pull-based engine.

### TVDB/Kitsu authority cleanup

Search terms:

```text
show -> TVDB
anime -> Kitsu
anime:kitsu
show:tvdb
TVDB authority
Kitsu authority
provider authority
first-class anime
mediaType: anime
```

Expected outcome:

- Active docs should not present TVDB/Kitsu as canonical authorities.
- Archived docs should be clearly marked historical.

### Environment cleanup

Search terms:

```text
TVDB_API_KEY
TVDB_PIN
KITSU
RECOMMENDATION_WORKER
RECOMMENDATION_ENGINE
WORKER_URL
RECOMMENDATION_SERVICE
```

Expected outcome:

- Required environment variable lists should match active runtime behavior.
- Old worker URL/API key names should be renamed or removed if they imply push-based worker ownership.

### Identity examples

Search terms:

```text
movie:tmdb
show:tmdb
episode:tmdb
show:tvdb
anime:kitsu
```

Expected outcome:

- Current contracts use only TMDB-backed canonical output identities.
- Non-TMDB examples appear only in archived historical plans.

## Phased Cleanup Order

### Phase 1: Mark obsolete docs

Goal: stop readers from implementing the wrong architecture.

Actions:

1. Confirm the obsolete Recommendation Worker contract file has been deleted.
2. Keep `RECOMMENDATION_ENGINE_CONTRACT.md` as the active source of truth.
3. Add obsolete banners to any non-archived planning docs that still present TVDB/Kitsu provider authority as actionable, such as `docs/MEDIA_TYPE_CLASSIFICATION_PLAN.md` if it remains in active docs.
4. Do not rewrite old contracts or historical plans in place without clearly preserving that they described old designs.

### Phase 2: Update source-of-truth architecture

Goal: make `architecture.md` the authoritative active statement.

Actions:

1. Add external pull-based recommendation engine language.
2. Clarify internal BullMQ worker language.
3. Confirm TMDB-only identity remains explicit.
4. Confirm recommendations module scope is storage/API integration, not external engine implementation.

### Phase 3: Create current engine contract

Goal: replace worker submit/poll semantics with the active pull-based integration contract.

Actions:

1. Create `RECOMMENDATION_ENGINE_CONTRACT.md` or `docs/RECOMMENDATION_ENGINE_CONTRACT.md`.
2. Define engine-to-API authentication.
3. Define source-data discovery and retrieval endpoints.
4. Define pagination, filtering, freshness, and rate limits.
5. Define recommendation result ingestion semantics, including whether the engine pushes results to the API Server or another confirmed integration surface is used.
6. Define canonical identity requirements.
7. Define error handling and retry expectations.
8. Define sensitive-field and logging restrictions.

### Phase 4: Update README and deployment docs

Goal: align onboarding and operations docs.

Actions:

1. Update architecture overview in `README.md`.
2. Update local development instructions if they mention running a recommendation worker.
3. Update `DEPLOY.md` deployment units and environment variables.
4. Remove stale required `TVDB_API_KEY`/`TVDB_PIN` documentation if no longer active.
5. Document active service-auth variables for the external engine.

### Phase 5: Update agent guidance

Goal: prevent future automated edits from reintroducing stale assumptions.

Actions:

1. Update `AGENT.md` with recommendation architecture guardrails.
2. Add a warning against push/poll worker terminology.
3. Add canonical TMDB identity reminders.
4. Add search terms agents should check before touching recommendation docs.

### Phase 6: Final consistency pass

Goal: remove contradictions after primary docs are updated.

Actions:

1. Run the validation searches listed above.
2. Inspect every active-doc hit.
3. Add archive banners to historical docs instead of rewriting old plans as if still active.
4. Confirm all active docs agree with `architecture.md`.
5. Confirm no active docs require stale `TVDB_API_KEY`/`TVDB_PIN` env variables.
6. Confirm TVDB/Kitsu import mapping references are preserved only as non-canonical compatibility/source-ID context.
7. Confirm stale terms remain only in this cleanup plan, archives, or obsolete-bannered historical docs.

## Risks

### Accidental architecture regression

Risk: cleanup may accidentally reintroduce the old API Server -> worker push/poll model.

Mitigation:

- Use `architecture.md` as the source of truth.
- Archive the old contract before writing replacement details.
- Avoid endpoint examples such as `POST /v1/generations` unless they are explicitly part of the new active contract.

### Confusing internal worker and external engine

Risk: deployment docs may make operators think scaling BullMQ scales recommendation generation.

Mitigation:

- Always qualify BullMQ as the internal BullMQ worker.
- Always qualify the recommendation system as the external recommendation engine/service.

### Removing env docs before code cleanup

Risk: documentation may remove `TVDB_API_KEY` or `TVDB_PIN` before code or deployments are actually independent of them.

Mitigation:

- Search code and deployment templates before removing env variables from active setup docs.
- If variables are still used only for compatibility, document them as optional and non-canonical.

### Breaking external team expectations

Risk: the recommendation engine team may still reference the old obsolete push/poll integration contract.

Mitigation:

- Archive, do not silently delete, the old contract until all consumers confirm migration.
- Put a clear obsolete banner and link to the new contract.

### Incomplete result-ingestion design

Risk: pull-based source-data retrieval is confirmed, but result delivery may still need a precise contract.

Mitigation:

- Treat source-data pull as locked.
- Document result delivery as an explicit open contract area if not yet finalized.
- Do not invent code behavior in docs without product/architecture confirmation.

## Non-Goals

This documentation cleanup does not:

- modify application code
- change database schema
- add or remove runtime endpoints
- implement recommendation generation
- change BullMQ worker behavior
- change canonical media identity away from TMDB
- reintroduce TVDB/Kitsu provider authority
- add a first-class backend `anime` media type
- define recommendation ranking algorithms
- decide whether result delivery is push-based, pull-based, or shared-storage-based unless already confirmed elsewhere

## Definition of Done

The cleanup is complete when:

- active docs consistently call the system an external recommendation engine/service
- active docs state that the engine is pull-based and calls API Server APIs for source data
- old Recommendation Worker push/poll contract language is archived or replaced
- README, DEPLOY, AGENT, architecture, and recommendation contract docs agree
- BullMQ worker documentation is clearly limited to internal backend jobs
- active docs do not present TVDB/Kitsu as canonical identity authorities
- active env docs do not require stale `TVDB_API_KEY`/`TVDB_PIN` values unless verified active usage remains
- validation searches show stale terminology only in clearly archived historical docs
