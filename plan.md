# Plan: Simplify Recommendation Write APIs to `{ type, tmdbId }`

## Executive summary

Recommendation write APIs currently expose internal write details to recommendation writers: callers provide `purpose`, `writeMode`, input version metadata, `contentId`, explicit `rank`, and optional scoring/reason/metadata fields. This makes the API harder to use and couples recommendation generation to storage/enrichment concerns.

Target state: recommendation writers submit only ordered TMDB content references for each list item:

```json
{ "type": "movie", "tmdbId": 550 }
```

The server derives everything else needed for storage and policy enforcement: source ownership, purpose, write mode, rank, canonical content key, eligibility version, idempotency behavior, audit metadata, and any later read-time/background enrichment. This plan keeps implementation staged, updates docs/tests, and standardizes success/error behavior for the active recommendation write APIs.

> This document is planning only. Do not implement source-code changes as part of this plan-writing task.

---

## Goals

- Simplify active recommendation list write contracts so item payloads contain only `type` and `tmdbId`.
- Remove writer responsibility for enrichment-oriented fields such as `contentId`, `rank`, `score`, `reasonCodes`, `metadata`, and full `media` payloads.
- Remove or server-derive over-specified top-level write fields such as `purpose`, `writeMode`, `input.eligibilityVersion`, `input.signalsVersion`, `modelVersion`, and `algorithm`.
- Keep route ownership, scopes, grants, idempotency, rate limits, and writable-list policy protections intact.
- Move enrichment out of write APIs: write path stores/normalizes identity; read path or background jobs are responsible for resolving display/card metadata.
- Align repository docs with the target API and remove examples that encourage enriched write payloads.
- Improve response consistency for single-list and batch writes, especially HTTP status usage, idempotency semantics, and error body shape.
- Add/update tests so the simplified contract is enforced and legacy over-complex payloads do not regress unnoticed.

## Non-goals

- Do not change recommendation generation algorithms, ranking models, or scoring strategy.
- Do not implement new TMDB/catalog enrichment logic in this migration unless an existing read path requires a small compatibility adapter.
- Do not change authentication, app scopes, grant semantics, or account/profile ownership rules except as needed to keep existing behavior under the simplified contract.
- Do not redesign recommendation run, batch, or backfill lifecycle APIs beyond clarifying how they relate to simplified writes.
- Do not introduce a database migration unless implementation verification proves current storage cannot represent canonical `{ type, tmdbId }` identities.
- Do not modify application source code while creating this plan.

---

## Scope

### In scope

1. **Active recommendation write APIs**
   - `PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey`
   - `POST /internal/apps/v1/recommendations/batch-upsert`

2. **Supporting service/type layers**
   - Service recommendation list request/response types.
   - Service recommendation list validation and normalization.
   - Existing lower-level recommendation list write service integration.

3. **Docs**
   - Internal app/recommender write contract docs.
   - README endpoint summary.
   - Recommendation API docs that currently show enriched recommendation snapshot writes.
   - Recommendation engine contract docs.

4. **Tests**
   - Route tests for simplified payloads and status codes.
   - Service/unit tests for validation, normalization, idempotency, and batch partial failures.
   - Regression tests for legacy-field rejection or migration warnings.

5. **Response consistency**
   - HTTP status policy.
   - Success response shape consistency between single and batch writes.
   - Error code/body consistency.
   - Batch partial-error representation.

### Out of scope unless discovered during implementation

- Public recommendation read API redesign.
- Full OpenAPI generation if the repository still has no OpenAPI documents for these endpoints.
- Client UI changes, except documentation that tells clients/readers to consume enriched read responses rather than write enriched items.

---

## Current state inventory

Line references are from the pre-plan analysis scan and should be rechecked before editing.

| Area | File / lines | Current state | Change needed |
| --- | --- | --- | --- |
| Internal app routes | `src/http/routes/internal-apps.routes.ts:149-185` | Registers service-list discovery, single-list write, and batch write endpoints. | Keep routes, simplify request body passed to service, update response status policy if approved. |
| Single-list write route | `src/http/routes/internal-apps.routes.ts:155-172` | Reads `Idempotency-Key`, checks ownership/rate limit, calls `serviceRecommendationListService.upsertList`, returns `201` for new write or `200` for replay. | Keep auth/ownership/rate-limit behavior. Ensure request body is simplified and response is documented consistently. |
| Batch write route | `src/http/routes/internal-apps.routes.ts:175-184` | Calls `serviceRecommendationListService.batchUpsert`, returns `207` for non-replay and `200` for replay. | Prefer `200 OK` for processed batch responses, with per-profile/per-list statuses in the body; reserve 4xx/5xx for whole-request failures. |
| Service write request types | `src/modules/apps/service-recommendation-list.types.ts:20-31` | Single write requires `purpose`, `input.eligibilityVersion`, `input.signalsVersion`, optional model metadata, `writeMode`, and `items`. | Replace public request type with `items: Array<{ type, tmdbId }>` plus only approved correlation metadata if needed. |
| Batch write request types | `src/modules/apps/service-recommendation-list.types.ts:33-45` | Batch requires `purpose`, optional `runId`/`batchId`, `writeMode`, and each profile supplies `eligibilityVersion`, `signalsVersion`, and list items. | Remove caller-supplied purpose/write mode/input versions; server derives these. Batch still needs profile/list addressing. |
| Batch result types | `src/modules/apps/service-recommendation-list.types.ts:47-68` | Batch returns status, summary, profile results, nested errors, and idempotency. | Keep the useful summary/result pattern; align nested error shape with standard error policy. |
| Single result type | `src/modules/apps/service-recommendation-list.types.ts:70-72` | Extends lower write result and adds eligibility. | Keep or minimally extend; ensure status/idempotency/date behavior is documented. |
| Current item input | `src/modules/recommendations/recommendation-list.types.ts:4-10` | API-facing item type currently contains `contentId`, `rank`, optional `score`, `reasonCodes`, and `metadata`. | Stop exposing this as the service-app write contract. Use it only as normalized internal input if still useful. |
| Lower write input | `src/modules/recommendations/recommendation-list.types.ts:16-34` | Lower layer accepts source, purpose, run/batch IDs, write mode, normalized items, idempotency key, input versions, and actor. | Keep as internal storage/write abstraction if it fits; service layer should populate it from simplified API inputs. |
| Lower write service | `src/modules/recommendations/recommendation-list-write.service.ts:18-41` | Requires idempotency, supports only `replace`, checks idempotency conflict, authorizes policy, validates items, writes version, stores idempotency, audits app write. | No route contract should leak this complexity. Confirm it can accept server-normalized `contentId`/rank with empty optional enrichment fields. |
| Single service implementation | `src/modules/apps/service-recommendation-list.service.ts:30-51` | Rejects caller `source`, requires idempotency/scope, derives source, checks writable list, asserts eligibility, passes caller `purpose`, `writeMode`, `items`, and `inputVersions` to lower write service. | Add simplified body validation/normalization. Derive purpose/writeMode/rank/content key/input versions server-side. |
| Batch service implementation | `src/modules/apps/service-recommendation-list.service.ts:53-107` | Rejects caller `source`, requires idempotency/scope, validates batch limits, loops profiles/lists, uses caller eligibility/signals versions, builds per-list idempotency key, stores batch idempotency, audits summary. | Normalize simplified items per list; derive eligibility version from `assertEligible`; use canonical normalized request hash for idempotency. |
| Batch limits | `src/modules/apps/service-recommendation-list.service.ts:127-134` | Validates non-empty profiles/lists and max profiles/lists. | Keep limits; add item-array and item-reference validation. |
| Caller source rejection | `src/modules/apps/service-recommendation-list.service.ts:136-138` | Explicitly rejects `source` in write request. | Expand legacy-field rejection/migration warning to cover all removed fields. |
| Route tests | `src/http/routes/internal-apps.routes.test.ts:200-209`, `245-259`, `290-300` | Tests still use legacy payload `{ purpose, writeMode, items: [] }`. | Update to simplified payloads and add rejection tests for legacy fields. |
| Retired legacy integration route test | `src/http/routes/internal-apps.routes.test.ts:152-172` | Ensures old `/api/integrations/v1/...` RECO endpoints are absent. | Keep as regression coverage; do not revive retired routes. |
| Docs: public recommendation API | `docs/api/recommendations.md:312-457` | Documents `PUT /v1/profiles/:profileId/recommendations` with full snapshot sections and `media` payloads. | Clarify whether this endpoint remains public/account-write, legacy/admin-only, or out of scope. Do not let it be confused with simplified service-list writes. |
| Docs: status/errors | `docs/api/recommendations.md:470-489` | Documents top-level `{ code, message, details? }` error body. | Reuse or explicitly align internal app write docs with one standard error shape. |
| README endpoint summary | `README.md:360-367` | Lists internal app recommendation endpoints. | Update descriptions to mention simplified `{ type, tmdbId }` item refs and batch status policy. |
| Auth scope list | `src/http/plugins/app-auth.plugin.ts:37-39`; `src/modules/apps/app-principal.types.ts:27-29` | Defines service-list read/write/batch-write scopes. | No expected scope change. Verify docs still mention correct scopes. |
| Rate-limit groups | `src/modules/apps/app-rate-limit.service.ts:95` and route usage in `internal-apps.routes.ts` | Existing route groups for service lists and writes. | No expected route-group change. |
| OpenAPI | `openapi/` | No OpenAPI files found during scan. | If specs are added before implementation, update them; otherwise document this API in Markdown only. |

---

## Target API contracts

### Shared item reference schema

Recommendation writers should submit ordered TMDB references only:

```ts
type RecommendationItemRef = {
  type: "movie" | "tv";
  tmdbId: number;
};
```

Validation rules to implement:

- `items` must be an array.
- Each item must be an object with exactly:
  - `type`: allowed content type.
  - `tmdbId`: positive safe integer.
- Recommended allowed `type` values: `movie` and `tv`, matching TMDB media types.
- Server derives rank from array order, starting at `1`.
- Server derives canonical internal content key from `type` and `tmdbId`, for example `movie:tmdb:550`.
- Server rejects writer-supplied enrichment/storage fields after the compatibility window:
  - Per item: `contentId`, `mediaKey`, `rank`, `score`, `reason`, `reasonCodes`, `metadata`, `media`, `payload`.
  - Top-level: `source`, `purpose`, `writeMode`, `input`, `eligibilityVersion`, `signalsVersion`, `modelVersion`, `algorithm`.
- Empty `items: []` should remain valid and mean “replace this list with an empty list,” unless product explicitly decides clearing must use a separate endpoint.
- Duplicate item policy must be decided before coding. Recommended: reject duplicate `(type, tmdbId)` pairs within the same list with `DUPLICATE_RECOMMENDATION_ITEM`.

### Single-list write

Endpoint:

```http
PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey
Idempotency-Key: <required unique key>
Content-Type: application/json
```

Target request body:

```json
{
  "items": [
    { "type": "movie", "tmdbId": 550 },
    { "type": "tv", "tmdbId": 1399 }
  ]
}
```

Target empty-list request body:

```json
{
  "items": []
}
```

Server-derived values:

| Derived value | Source |
| --- | --- |
| `accountId`, `profileId`, `listKey` | Path parameters. |
| `source` | Authenticated app principal owned source. |
| `purpose` | Constant `recommendation-generation`. |
| `writeMode` | Constant `replace`. |
| `rank` | 1-indexed array position. |
| `contentId` / media key | Canonical key built from `{ type, tmdbId }`, e.g. `movie:tmdb:550`. |
| `eligibilityVersion` | Result from `profileEligibilityService.assertEligible(...)`. |
| `signalsVersion`, `modelVersion`, `algorithm` | Not caller-supplied. Omit unless a server-owned source can populate them reliably. |
| Audit actor | Authenticated app principal. |

Target success response for a new write:

```json
{
  "accountId": "acc_123",
  "profileId": "prof_456",
  "listKey": "for-you",
  "source": "official-recommender",
  "version": 12,
  "status": "written",
  "itemCount": 2,
  "idempotency": {
    "key": "reco-write-2026-05-04-001",
    "replayed": false
  },
  "createdAt": "2026-05-04T12:00:00.000Z",
  "eligibility": {
    "checkedAt": "2026-05-04T12:00:00.000Z",
    "eligible": true,
    "eligibilityVersion": 42
  }
}
```

Target success response for idempotent replay:

```json
{
  "accountId": "acc_123",
  "profileId": "prof_456",
  "listKey": "for-you",
  "source": "official-recommender",
  "version": 12,
  "status": "idempotent_replay",
  "itemCount": 2,
  "idempotency": {
    "key": "reco-write-2026-05-04-001",
    "replayed": true
  },
  "createdAt": "2026-05-04T12:00:00.000Z",
  "eligibility": {
    "checkedAt": "2026-05-04T12:00:00.000Z",
    "eligible": true,
    "eligibilityVersion": 42
  }
}
```

### Batch write

Endpoint:

```http
POST /internal/apps/v1/recommendations/batch-upsert
Idempotency-Key: <required unique key>
Content-Type: application/json
```

Target request body:

```json
{
  "profiles": [
    {
      "accountId": "acc_123",
      "profileId": "prof_456",
      "lists": [
        {
          "listKey": "for-you",
          "items": [
            { "type": "movie", "tmdbId": 550 },
            { "type": "tv", "tmdbId": 1399 }
          ]
        },
        {
          "listKey": "because-you-watched",
          "items": [
            { "type": "movie", "tmdbId": 603 }
          ]
        }
      ]
    },
    {
      "accountId": "acc_789",
      "profileId": "prof_012",
      "lists": [
        {
          "listKey": "for-you",
          "items": []
        }
      ]
    }
  ]
}
```

Batch server-derived values:

| Derived value | Source |
| --- | --- |
| `purpose` | Constant `recommendation-generation`. |
| `writeMode` | Constant `replace`. |
| `source` | Authenticated app principal owned source. |
| `rank` and canonical content key | Derived per list item. |
| `eligibilityVersion` | Computed per profile via eligibility service. |
| Per-list idempotency key | Derived from batch idempotency key + account/profile/list identifiers, as today. |
| `runId` / `batchId` audit correlation | Decision needed. Prefer dedicated run/batch endpoints or server context over requiring these in write body. |

Target batch response:

```json
{
  "status": "completed_with_errors",
  "summary": {
    "profilesReceived": 2,
    "profilesWritten": 1,
    "profilesRejected": 1,
    "listsWritten": 2,
    "itemsWritten": 3
  },
  "results": [
    {
      "accountId": "acc_123",
      "profileId": "prof_456",
      "status": "written",
      "lists": [
        {
          "listKey": "for-you",
          "source": "official-recommender",
          "version": 12,
          "itemCount": 2
        },
        {
          "listKey": "because-you-watched",
          "source": "official-recommender",
          "version": 7,
          "itemCount": 1
        }
      ]
    },
    {
      "accountId": "acc_789",
      "profileId": "prof_012",
      "status": "rejected",
      "error": {
        "code": "PROFILE_NOT_ELIGIBLE",
        "message": "Profile is not eligible for recommendation generation.",
        "details": {
          "accountId": "acc_789",
          "profileId": "prof_012"
        }
      }
    }
  ],
  "idempotency": {
    "key": "reco-batch-2026-05-04-001",
    "replayed": false
  }
}
```

---

## Response and error consistency policy

### Success HTTP statuses

| Endpoint | New write | Idempotent replay | Partial per-item/profile errors |
| --- | --- | --- | --- |
| Single-list `PUT` | `201 Created` | `200 OK` | Not applicable; single write fails as a whole. |
| Batch `POST` | `200 OK` recommended | `200 OK` | `200 OK` with `status: completed_with_errors` or `failed` in body. |

Recommended change: stop using `207 Multi-Status` for batch responses. It is uncommon for JSON APIs, complicates clients, and the response body already has structured per-profile results.

### Success body rules

- Keep the current top-level response style for internal app APIs unless a project-wide API envelope already exists.
- Always include `idempotency.key` and `idempotency.replayed` for write endpoints.
- Use `status` consistently:
  - Single: `written` for new writes, `idempotent_replay` for replay if preserving the existing lower-level result type.
  - Batch: `completed`, `completed_with_errors`, or `failed`.
  - Batch profile result: `written` or `rejected`.
- Dates on the wire must be ISO-8601 strings.
- Do not return enriched media/card data from write endpoints.
- Do not return caller-supplied deprecated fields back in responses.

### Whole-request error body

Use one standard top-level error shape for active recommendation write APIs:

```json
{
  "code": "INVALID_RECOMMENDATION_ITEM",
  "message": "items[0].tmdbId must be a positive integer.",
  "details": {
    "field": "items[0].tmdbId"
  }
}
```

This aligns with the documented `{ code, message, details? }` style in `docs/api/recommendations.md:481-489`.

Recommended error code style for internal app write APIs: explicit uppercase machine codes already used by services, for example `IDEMPOTENCY_KEY_REQUIRED` and `IDEMPOTENCY_CONFLICT`. Avoid mixing generated lowercase message-derived codes in these endpoints.

### Error status policy

| Condition | HTTP status | Code |
| --- | --- | --- |
| Missing `Idempotency-Key` | `400` | `IDEMPOTENCY_KEY_REQUIRED` |
| Reused idempotency key with different normalized request | `409` | `IDEMPOTENCY_CONFLICT` |
| Body is not an object | `400` | `INVALID_REQUEST_BODY` |
| `items` missing or not array | `400` | `INVALID_RECOMMENDATION_ITEMS` |
| Item has invalid `type` | `400` | `INVALID_RECOMMENDATION_ITEM_TYPE` |
| Item has invalid `tmdbId` | `400` | `INVALID_RECOMMENDATION_TMDB_ID` |
| Duplicate item in a list, if rejecting duplicates | `400` | `DUPLICATE_RECOMMENDATION_ITEM` |
| Removed field after compatibility window | `400` | `UNSUPPORTED_RECOMMENDATION_WRITE_FIELD` |
| Missing scope | `403` | Existing auth/scope code |
| App does not own source/list | `403` | Existing ownership/list code |
| Profile not found/inaccessible | `404` | Existing profile access code |
| Profile not eligible in single write | Existing eligibility status, usually `403` or `400` | Existing eligibility code |
| Profile not eligible in batch | `200` for processed batch; nested result `rejected` | Nested eligibility code |
| Rate limited | `429` | Existing rate-limit code |

### Batch nested errors

Batch should distinguish:

- **Whole-request errors**: invalid JSON/body shape, missing idempotency key, too many profiles/lists. Return 4xx and do not process.
- **Per-profile/per-list errors**: ineligible profile, profile not accessible, list not owned, list validation failure. Keep processing other profiles where safe and return `results[].status = "rejected"` with nested error object.

Nested errors should use the same field names as whole-request errors:

```json
{
  "code": "LIST_NOT_OWNED",
  "message": "App does not own recommendation list.",
  "details": {
    "accountId": "acc_123",
    "profileId": "prof_456",
    "listKey": "for-you"
  }
}
```

---

## Phased implementation plan

### Phase 0 — Decisions and contract sign-off

- [ ] Decide allowed item `type` values.
  - Recommendation: accept `movie` and `tv` because they match TMDB media types.
  - Decide whether to accept `series` as an alias for `tv` during compatibility.
- [ ] Decide `tmdbId` representation.
  - Recommendation: require JSON number, positive safe integer.
  - Optional migration behavior: accept numeric strings temporarily and normalize to number with a warning.
- [ ] Decide duplicate behavior within a list.
  - Recommendation: reject duplicates to surface model/output bugs.
- [ ] Decide whether empty `items: []` clears/replaces the list.
  - Recommendation: allow it; current tests already exercise empty writes.
- [ ] Decide run/batch audit correlation.
  - Recommendation: do not require `runId`/`batchId` in simplified write bodies. If correlation is required, prefer dedicated run/batch endpoints or server-derived context.
- [ ] Decide migration mode.
  - If no production writers depend on legacy fields: make a clean breaking contract change.
  - If production writers exist: dual-accept legacy and simplified payloads for one release with deprecation warnings.
- [ ] Approve batch HTTP status change from `207` to `200`, or explicitly retain `207` and document why.
- [ ] Approve error code casing policy for internal app write APIs.

### Phase 1 — Type and validation design

- [ ] Add a public/service-layer item ref type, for example `ServiceRecommendationItemRef`:
  - `type: 'movie' | 'tv'`
  - `tmdbId: number`
- [ ] Replace API-facing `UpsertServiceRecommendationListRequest` with:
  - `items: ServiceRecommendationItemRef[]`
  - Optional correlation fields only if approved in Phase 0.
- [ ] Replace API-facing `BatchUpsertServiceRecommendationListsRequest` with:
  - `profiles[].accountId`
  - `profiles[].profileId`
  - `profiles[].lists[].listKey`
  - `profiles[].lists[].items: ServiceRecommendationItemRef[]`
  - Optional correlation fields only if approved in Phase 0.
- [ ] Keep lower-level `RecommendationListItemInput` internal if it remains the storage-facing normalized shape.
- [ ] Create a normalization helper in the service layer:
  - Input: `ServiceRecommendationItemRef[]`.
  - Output: `RecommendationListItemInput[]` with canonical `contentId`, derived `rank`, and no enrichment fields.
- [ ] Centralize validation so single and batch paths share identical item rules.
- [ ] Add removed-field detection for top-level and per-item legacy fields.
- [ ] Make validation errors include a precise field path, e.g. `profiles[0].lists[1].items[2].tmdbId`.

### Phase 2 — Service write behavior

- [ ] Update `DefaultServiceRecommendationListService.upsertList` to consume simplified request data.
- [ ] Continue rejecting caller-supplied `source`; expand to all removed legacy fields after migration.
- [ ] Keep requiring `Idempotency-Key`.
- [ ] Keep requiring `recommendations:service-lists:write` for single writes.
- [ ] Keep deriving source from `principal.ownedSources`.
- [ ] Keep `requireWritableList(...)` grant/list ownership checks.
- [ ] Keep `profileEligibilityService.assertEligible(...)` at write time.
- [ ] Use returned eligibility to populate response eligibility and internal `inputVersions.eligibilityVersion` if retaining that internal field.
- [ ] Set internal `purpose = 'recommendation-generation'`.
- [ ] Set internal `writeMode = 'replace'`.
- [ ] Normalize each `{ type, tmdbId }` to canonical `contentId` / media key and derived rank.
- [ ] Pass normalized internal items to `recommendationListWriteService.writeList(...)`.
- [ ] Do not enrich or fetch TMDB/catalog details during the write.
- [ ] Ensure audit metadata contains counts/list identity, not enriched item payloads.

### Phase 3 — Batch write behavior

- [ ] Update `DefaultServiceRecommendationListService.batchUpsert` to consume simplified batch request data.
- [ ] Keep requiring `Idempotency-Key`.
- [ ] Keep requiring `recommendations:service-lists:batch-write`.
- [ ] Keep profile/list count limits.
- [ ] Add item validation and per-list item count limits if not already covered by lower-level policy.
- [ ] Normalize batch request into a canonical form before hashing for batch idempotency.
- [ ] Use canonical normalized request hash for both new simplified payloads and legacy payloads during compatibility, so semantically identical requests replay instead of conflict.
- [ ] For each profile:
  - [ ] Assert eligibility server-side.
  - [ ] For each list, require writable list ownership.
  - [ ] Normalize items and write list with derived per-list idempotency key.
  - [ ] Record written list result with `listKey`, `source`, `version`, and `itemCount`.
- [ ] On per-profile/list errors, record `rejected` result and continue other profiles where safe.
- [ ] Preserve batch summary counters.
- [ ] Save batch idempotency result after processing.
- [ ] Audit batch summary as today, excluding enriched item data.

### Phase 4 — Route and response consistency

- [ ] Update route handlers only as needed to reflect service type changes.
- [ ] Keep single-write status behavior: `201` for new write, `200` for replay.
- [ ] Change batch non-replay response from `207` to `200` if approved.
- [ ] Ensure route tests assert the final status policy.
- [ ] Ensure error responses from validation use the standard `{ code, message, details? }` shape.
- [ ] Ensure legacy-field migration warnings, if used, are exposed consistently:
  - Response body `warnings?: Array<{ code, message, field? }>`; and/or
  - HTTP headers `Deprecation: true` and `Sunset: <date>`.

### Phase 5 — Enrichment boundary

- [ ] Confirm write path stores only canonical identity and derived rank.
- [ ] Confirm read path can render recommendations when stored items have only identity plus rank.
- [ ] If read path currently expects stored `score`, `reasonCodes`, `metadata`, or enriched `media`, add a read-side fallback plan before coding.
- [ ] Define enrichment failure behavior:
  - Recommended: read path should return the item identity and omit/empty optional enriched fields rather than failing the entire list.
- [ ] Ensure docs state that writers are not responsible for media/card enrichment.

### Phase 6 — Tests

- [ ] Update existing route tests from legacy payloads to simplified payloads.
- [ ] Add service-level tests for validation and normalization.
- [ ] Add idempotency tests for simplified requests.
- [ ] Add batch partial-failure tests.
- [ ] Add legacy compatibility/rejection tests depending on the migration decision.
- [ ] Run targeted route tests, service tests, type checking, and full test suite.

### Phase 7 — Documentation and release

- [ ] Update docs before enabling final simplified-only behavior.
- [ ] Publish migration notes for recommendation writers.
- [ ] If dual-accepting legacy payloads, include sunset date and telemetry/monitoring plan.
- [ ] After migration window, remove legacy parser/types/tests and update docs to simplified-only.

---

## Per-file change plan

### `src/http/routes/internal-apps.routes.ts`

- Keep route paths unchanged.
- Keep authentication, ownership checks, and rate-limit calls unchanged.
- Single write:
  - Continue extracting `Idempotency-Key`.
  - Pass simplified request body to service.
  - Keep `201` new / `200` replay status policy.
- Batch write:
  - Continue extracting `Idempotency-Key`.
  - Pass simplified request body to service.
  - Change `207` to `200` for processed non-replay batch responses if approved.
- Avoid adding route-local business validation unless project conventions prefer route schemas; service-level validation should remain reusable by tests.

### `src/modules/apps/service-recommendation-list.types.ts`

- Add:

```ts
export interface ServiceRecommendationItemRef {
  type: 'movie' | 'tv';
  tmdbId: number;
}
```

- Replace single request shape with:

```ts
export interface UpsertServiceRecommendationListRequest {
  items: ServiceRecommendationItemRef[];
}
```

- Replace batch request shape with:

```ts
export interface BatchUpsertServiceRecommendationListsRequest {
  profiles: Array<{
    accountId: string;
    profileId: string;
    lists: Array<{
      listKey: string;
      items: ServiceRecommendationItemRef[];
    }>;
  }>;
}
```

- If Phase 0 keeps correlation fields, add only those fields explicitly and document that they are not content/enrichment fields.
- Update nested batch error type to include optional `details?: unknown` if using the standard error shape.

### `src/modules/apps/service-recommendation-list.service.ts`

- Add shared body validation helpers:
  - `validateSingleRequest(...)`
  - `validateBatchRequest(...)`
  - `validateItemRef(...)`
  - `normalizeItemRefs(...)`
  - `buildCanonicalContentId(type, tmdbId)`
- Expand legacy-field rejection beyond `source`.
- For single writes:
  - Use simplified `request.items` only.
  - Derive `purpose`, `writeMode`, rank, content key, source, actor, and eligibility input version.
- For batch writes:
  - Remove dependence on caller-supplied `eligibilityVersion` and `signalsVersion`.
  - Derive eligibility per profile.
  - Hash canonical normalized request for idempotency.
  - Keep existing per-list idempotency key strategy unless a better canonical key is approved.
- Preserve app audit events and summary counters.

### `src/modules/recommendations/recommendation-list.types.ts`

- Treat `RecommendationListItemInput` as internal normalized storage input, not as an API-facing contract.
- Consider adding comments or renaming in a later cleanup to reduce accidental re-exposure.
- No required schema change if existing `contentId` can store canonical `movie:tmdb:<id>` / `tv:tmdb:<id>` keys.

### `src/modules/recommendations/recommendation-list-write.service.ts`

- Prefer no public-contract changes.
- Verify idempotency hashing receives normalized internal input with derived ranks.
- Verify validation accepts server-derived canonical content IDs and does not require optional enrichment fields.
- If needed, adjust validation error details so service-level callers can expose consistent field paths.

### `src/modules/recommendations/recommendation-list-policy.ts`

- Verify max item limits still apply after normalization.
- Ensure policy validation does not require caller-provided rank beyond normalized internal rank.
- Keep source/list ownership policy unchanged.

### `src/modules/recommendations/recommendation-list.repo.ts`

- Expected: no migration needed.
- Verify stored item columns accept empty/null `score`, `reasonCodes`, and `metadata`.
- Verify `contentId` length/format accepts canonical TMDB media keys.
- If repository persists item rank, confirm derived ranks are stored correctly.

### `src/http/routes/internal-apps.routes.test.ts`

- Update existing write payloads at the referenced tests to use:

```json
{ "items": [] }
```

or non-empty simplified examples.
- Add tests for:
  - Single write accepts `{ items: [{ type: 'movie', tmdbId: 101 }] }`.
  - Official recommender cross-account write still succeeds with simplified body.
  - Normal app cross-account write still fails before/without simplified body changing ownership semantics.
  - Missing idempotency key still returns `400`.
  - Batch route returns the approved HTTP status.
  - Legacy fields are warned or rejected depending on migration phase.

### New or existing service tests for `DefaultServiceRecommendationListService`

- If no service test file exists, add one near `src/modules/apps/service-recommendation-list.service.test.ts` during implementation.
- Cover validation, normalization, idempotency replay/conflict, batch summary counters, and per-profile rejection.

### `README.md`

- Update internal app endpoint descriptions around `README.md:360-367`.
- Add concise request examples for single and batch writes.
- Mention `Idempotency-Key` is required.
- Mention writers submit TMDB refs only; source/rank/enrichment are server-derived.

### `docs/api/recommendations.md`

- Decide whether this doc is for public account APIs only or also internal service-app APIs.
- If public-only, add a clear note that service recommendation writes use the internal app contract and do not write enriched snapshots.
- Revisit the `PUT /v1/profiles/:profileId/recommendations` section at `docs/api/recommendations.md:312-457`:
  - Mark as legacy/admin/internal if appropriate; or
  - Remove enriched write examples if this endpoint should no longer be promoted; or
  - Split it from service-list writes so writers are not instructed to send full `sections[].items[].media` payloads.
- Ensure status/error section matches the chosen error policy.

### `RECOMMENDATION_ENGINE_CONTRACT.md`

- Update writer output contract so the recommendation engine emits ordered arrays of `{ type, tmdbId }`.
- State that ranking is array order.
- State that enrichment and display fields are not part of write output.
- Include batch example matching this plan.

### `architecture.md`

- Update any write-path diagrams or prose to show:
  - Generator emits identity refs.
  - Internal app write validates/normalizes.
  - Storage persists canonical IDs/rank.
  - Read/enrichment layer resolves display data.

### `CLIENT_SERVER_MEDIA_STATE_CONTRACT.md`

- Update only if it currently defines recommendation write item identity differently.
- Ensure media identity terminology is consistent with canonical `type` + `tmdbId` / media-key mapping.

### `openapi/`

- No files were found during the pre-plan scan.
- If an OpenAPI spec is introduced before implementation, add request/response schemas from this plan.

---

## Testing plan

### Unit/service tests

Add or update service tests for `DefaultServiceRecommendationListService`:

- [ ] Accepts single simplified request:

```json
{ "items": [{ "type": "movie", "tmdbId": 550 }] }
```

- [ ] Normalizes item to internal `contentId = "movie:tmdb:550"` and `rank = 1`.
- [ ] Derives `writeMode = "replace"` and `purpose = "recommendation-generation"`.
- [ ] Does not require caller-supplied `input.eligibilityVersion` or `input.signalsVersion`.
- [ ] Uses eligibility service result for response eligibility and internal input version.
- [ ] Allows `items: []` if empty-list replacement is approved.
- [ ] Rejects invalid `type` with `INVALID_RECOMMENDATION_ITEM_TYPE`.
- [ ] Rejects invalid `tmdbId` with `INVALID_RECOMMENDATION_TMDB_ID`.
- [ ] Rejects duplicate item refs if approved.
- [ ] Rejects or warns on removed fields depending on migration phase.
- [ ] Preserves idempotent replay for identical normalized request.
- [ ] Returns `409 IDEMPOTENCY_CONFLICT` for same idempotency key with different normalized request.
- [ ] Batch computes correct summary counts for all-success, partial-failure, and all-failure cases.
- [ ] Batch per-profile rejection does not prevent later profiles from being attempted where safe.
- [ ] Batch idempotency replay returns stored result with `idempotency.replayed = true`.

### Route tests

Update `src/http/routes/internal-apps.routes.test.ts`:

- [ ] Replace legacy payloads in ownership/cross-account tests with simplified payloads.
- [ ] Assert single write success still returns `201` for new write.
- [ ] Assert single replay returns `200` if route-level replay test exists or is added.
- [ ] Assert missing/inaccessible profile behavior remains unchanged.
- [ ] Assert official recommender cross-account write remains allowed with `accounts:all:write`.
- [ ] Assert normal app cross-account write remains denied.
- [ ] Add batch route happy-path test for simplified batch payload.
- [ ] Assert batch processed response uses approved status, preferably `200`.
- [ ] Assert legacy `/api/integrations/v1/...` routes remain absent.

### Documentation tests / static checks

- [ ] Search docs for removed fields in recommendation write examples:
  - `contentId`
  - `writeMode`
  - `eligibilityVersion`
  - `signalsVersion`
  - `score`
  - `reasonCodes`
  - enriched `media` in write examples
- [ ] Keep those terms only where explicitly describing internal storage, read responses, or deprecated legacy behavior.

### Verification commands

Run targeted checks first, then full repo checks:

```bash
npm test -- src/http/routes/internal-apps.routes.test.ts
npm test -- src/modules/apps/service-recommendation-list.service.test.ts
npm run typecheck
npm run build
npm test
```

If any script name differs in `package.json`, use the repository’s equivalent command and update this plan or implementation PR notes accordingly.

---

## Documentation update plan

### Writer-facing docs must say

- Writers submit ordered TMDB references only.
- Each item is `{ "type": "movie" | "tv", "tmdbId": <positive integer> }`.
- Array order is ranking; do not send `rank`.
- Do not send `contentId`, `score`, reasons, metadata, source, purpose, write mode, eligibility version, signal version, or enriched media/card payloads.
- Server derives source, rank, canonical key, write mode, purpose, eligibility, audit actor, and idempotency behavior.
- Write responses acknowledge storage only; they do not include enriched media.
- Enriched/card-ready recommendation data belongs in read responses or background-enriched projections.

### Docs to update

- [ ] `README.md`
  - Endpoint list and quick examples for single/batch writes.
- [ ] `docs/api/recommendations.md`
  - Clarify public vs internal recommendation write APIs.
  - Remove or clearly mark enriched snapshot write examples as not the service recommender write contract.
  - Align error examples with chosen code casing.
- [ ] `RECOMMENDATION_ENGINE_CONTRACT.md`
  - Main contract for recommendation writer output.
- [ ] `architecture.md`
  - Update write/read enrichment boundary.
- [ ] Any generated/API docs added later under `openapi/`.

### Example documentation snippet to use

```md
Recommendation writers do not send enriched media objects. Submit only ordered TMDB references:

```json
{
  "items": [
    { "type": "movie", "tmdbId": 550 },
    { "type": "tv", "tmdbId": 1399 }
  ]
}
```

The server treats array order as rank and derives internal media keys such as `movie:tmdb:550`. Enrichment for titles, posters, card views, reasons, and display metadata happens outside the write API.
```

---

## Migration and backward compatibility strategy

### Preferred strategy if production writers exist

1. **Release N: dual-accept**
   - Accept simplified payloads.
   - Accept legacy payloads temporarily.
   - Normalize both to the same internal representation.
   - Return deprecation signal for legacy payloads:
     - `Deprecation: true`
     - `Sunset: <date>`
     - Optional response warning with `LEGACY_RECOMMENDATION_WRITE_CONTRACT`.
   - Log/audit legacy-field usage by app ID and endpoint.

2. **Release N monitoring**
   - Track legacy usage until it reaches zero or approved threshold.
   - Contact remaining writer owners.
   - Confirm no idempotency conflict spikes from migration.

3. **Release N+1: reject legacy fields**
   - Reject removed top-level/per-item fields with `400 UNSUPPORTED_RECOMMENDATION_WRITE_FIELD`.
   - Keep docs simplified-only.
   - Keep tests for rejection.

4. **Release N+2: cleanup**
   - Remove legacy parser/compatibility code.
   - Remove compatibility tests, leaving only rejection tests if useful.
   - Remove telemetry specific to migration.

### Acceptable strategy if no production writers depend on legacy fields

- Make a single breaking change.
- Update tests and docs in the same PR.
- Include release notes that legacy fields are no longer accepted.

### Idempotency migration notes

- Use normalized canonical request hashing so simplified and legacy payloads that represent the same list contents can replay safely during dual-accept.
- Do not include raw deprecated fields in the hash once normalized.
- Same idempotency key with different normalized item order or content must return `409 IDEMPOTENCY_CONFLICT`.
- Communicate that clients should not reuse idempotency keys across different recommendation outputs.

### Data/storage compatibility

- Existing list versions can continue to store `contentId` and rank.
- New writes should store canonical keys derived from `{ type, tmdbId }`.
- Existing optional item fields should remain null/empty/default for simplified writes.
- Read paths should tolerate old and new rows during migration.

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Existing writers still send legacy payloads. | Breaking writer jobs. | Dual-accept with deprecation telemetry, or coordinate breaking release. |
| `type` naming mismatch (`tv` vs `series`). | Invalid writes or inconsistent media keys. | Decide canonical external values before coding; optionally support alias during migration. |
| Current read path expects enriched item metadata. | Recommendations render poorly or fail after simplified writes. | Verify read path before release; add read-side fallback/enrichment behavior. |
| Batch status change from `207` to `200` surprises clients. | Client monitoring or retry behavior changes. | Document clearly; dual behavior only if needed; assert body status is authoritative. |
| Idempotency hash changes cause conflicts. | Retries fail after deployment. | Hash normalized canonical request; document key reuse rules. |
| Duplicate item behavior not agreed. | Writers and server disagree on expected output. | Decide in Phase 0 and test it. |
| Empty list semantics ambiguous. | Accidental clearing or inability to clear. | Explicitly document `items: []` behavior. |
| Enrichment moved out but not owned by any component. | Stored recommendations lack display data indefinitely. | Assign read-time/background enrichment owner before coding. |
| Docs remain inconsistent with active API. | Writers copy old full-snapshot examples. | Update docs in same PR as implementation; add docs search checklist. |

---

## Open questions and decisions needed before coding

1. **Allowed `type` values**
   - Should external writers use `movie`/`tv`, `movie`/`series`, or accept both `tv` and `series`?

2. **`tmdbId` type**
   - Strict JSON number only, or also accept numeric strings during migration?

3. **Duplicate handling**
   - Reject duplicates, dedupe preserving first occurrence, or allow duplicates?

4. **Empty list behavior**
   - Confirm `items: []` means replace with empty active list.

5. **Run/batch correlation**
   - Should simplified write bodies keep optional `runId`/`batchId`, move correlation to headers, infer from run/batch endpoints, or drop write-time correlation?

6. **Batch HTTP status**
   - Approve replacing `207 Multi-Status` with `200 OK` for all processed batch responses?

7. **Response envelope**
   - Keep current top-level response objects for internal app APIs, or introduce `{ data, meta }`? Recommendation: keep current top-level style to minimize churn.

8. **Legacy compatibility window**
   - Is a dual-accept migration required? If yes, what sunset date?

9. **Enrichment owner**
   - Which service/module owns resolving `{ type, tmdbId }` to card-ready media data for reads?

10. **Public `PUT /v1/profiles/:profileId/recommendations`**
    - Is the full-snapshot public/account write endpoint still active, legacy, admin-only, or slated for deprecation? Docs must make this clear.

---

## Acceptance criteria / definition of done

Implementation is done when all of the following are true:

- [ ] Single-list write accepts the simplified body with item refs only.
- [ ] Batch write accepts simplified profile/list structures with item refs only.
- [ ] Writers no longer need to send `purpose`, `writeMode`, `input`, `eligibilityVersion`, `signalsVersion`, `contentId`, `rank`, `score`, `reasonCodes`, `metadata`, or enriched `media`.
- [ ] Server derives source, purpose, write mode, rank, canonical content key, eligibility version, actor, and audit metadata.
- [ ] Write path performs no media/card enrichment.
- [ ] Existing auth, scopes, grants, ownership, profile eligibility, and rate limits still apply.
- [ ] Single-write idempotency behavior is preserved: `201` new, `200` replay, `409` conflict for different normalized request.
- [ ] Batch idempotency behavior is preserved and documented.
- [ ] Batch response uses the approved HTTP status policy and body `status`/`summary`/`results` fields consistently.
- [ ] Whole-request and nested batch errors use the agreed `{ code, message, details? }` shape.
- [ ] Legacy payload fields are either dual-accepted with deprecation signals or rejected with documented errors, depending on the approved migration strategy.
- [ ] Tests cover simplified single and batch writes, validation failures, idempotency replay/conflict, batch partial failure, and legacy-field behavior.
- [ ] Documentation no longer presents enriched write payloads as the recommendation writer contract.
- [ ] Verification commands pass in CI or local equivalent.
- [ ] Release/migration notes are available to writer owners.

---

## Implementation checklist summary

- [ ] Phase 0 decisions completed.
- [ ] Types updated.
- [ ] Validation/normalization helper added.
- [ ] Single write service updated.
- [ ] Batch write service updated.
- [ ] Route status policy updated.
- [ ] Enrichment boundary verified.
- [ ] Tests updated/added.
- [ ] Docs updated.
- [ ] Migration/release notes prepared.
