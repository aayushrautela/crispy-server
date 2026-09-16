# AI Search & Insights Revamp

## Executive Summary

AI search and insights endpoints are too slow under load, retry on failure (doubling provider cost), and do not scale to concurrent users. This plan revamps both features to be **fast** (pure-read cache hits), **scalable** (worker-based generation with coalescing), and **time-bound** (no retries, bounded wait, 504 on timeout). Work is phased: insights hardening (done), then rate limits and pruning.

AI search is **not** moved to a worker or a durable cache. Natural-language queries are effectively unique per user — no two users phrase a search the same — so a permanent (Postgres) cache would never be re-hit and is pure write overhead. But a **temporary short-lived cache is still valuable**: the same user re-invokes / retries / double-taps within minutes, and concurrent identical requests in a burst must coalesce. So search keeps an **in-process, few-minute-TTL cache** (the existing coalescer, TTL raised from 10s), and its LLM call already satisfies the no-retry/time-bound spec (single `fetch`, 90s `AbortSignal` deadline).

---

## Root Causes

### Insights
1. **No in-flight coalescing.** N cold requests for the same title spawn N independent LLM calls and N TMDB image fetches.
2. **TMDB image fetch on every cache hit.** `TmdbClient.request('/images')` runs on every request regardless of cache state (5s timeout, 2 retries with backoff, process-global 40ms min-interval).
3. **No retry guard.** Provider failures were retried by `AiRequestExecutor` (inherent in HTTP retries) and by application logic, doubling cost and adding latency without recovering.

### Search
4. **Cache must be temporary — not durable, but not absent.** Natural-language queries are unique per user, so a permanent (Postgres) cache keyed on the query would never be re-hit. But a **few-minute, in-process cache** still pays off: the same user re-invokes/retries within minutes, and bursts of identical concurrent requests must coalesce into one LLM call. The existing `ShortLivedRequestCoalescer` does exactly this — its 10s TTL is simply too short.
5. **Search already meets no-retry/time-bound.** `OpenAiCompatibleClient.sendChatCompletion` performs a **single** `fetch` (no retries, `src/modules/ai/openai-compatible.client.ts:106`), and `AiRequestExecutor` bounds it with `AbortSignal.timeout(90s)`. No worker is required; the remaining search work is the temp-cache TTL bump (Phase 3) plus rate limiting (Phase 4).

---

## Design Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cold miss behavior | **Bounded sync wait** (POST contract unchanged) | Keeps client simple; timeout → 504 |
| Search cache storage | **Temp (in-process coalescer, TTL raised to few minutes)** | Unique natural-language queries defeat a durable cache; a few minutes covers re-invokes/retries |
| Scope | **Full** (pure-read hits, coalescing, worker generation, rate limits, pruning) | Prevents repeated tuning |

---

## No-Retry / Time-Bound Spec

Every AI job (insights + search) must be time-bound and never retry on failure.

### BullMQ Guarantees

```
attempts: 1           // no retry on failure
removeOnComplete: true // free the jobId for future re-enqueue
removeOnFail: true     // prevent permanent poisoning (retained failed job blocks same jobId)
maxStalledCount: 0     // fail on first stall, never re-run
```

- **Dedup via deterministic jobId:** `buildJobId('ai:insights', contentId, locale, generationVersion)` (base64url-joined). While a job exists in any state, BullMQ ignores re-adds (coalescing). Removed jobs don't count as duplicates, so `removeOnComplete/removeOnFail: true` is load-bearing: it frees the id so a later miss can re-enqueue.
- **Primary deadline:** `AbortSignal.timeout(90s)` in `AiRequestExecutor` (`src/modules/ai/ai-request-executor.ts:6`). BullMQ 5.71 has **no per-job `timeout` JobsOption** (typecheck error confirmed).
- **Worker deadline:** `maxStalledCount: 0` — stalled job is failed immediately, never recovered or re-run.
- **BullMQ 5.71 caveat:** `waitUntilFinished` with `removeOnComplete: true` can hang if the completion event is missed (issue #85). Our service wraps the wait in try/catch and always re-reads the cache (the Postgres row is the source of truth, not the event stream).

### Time Budgets

| Component | Budget | Mechanism |
|-----------|--------|-----------|
| LLM call | 90s | `AbortSignal.timeout(90s)` in executor |
| Request → response | 55s | `waitForInsights(handle, env.aiRequestWaitMs)` |
| TMDB image fetch (worker) | 5s | `TmdbClient` timeout |
| TMDB resolve candidates (worker) | 5s | `TitleSearchService` timeout |

If the wait expires or rejects, the service re-reads the cache. If the row exists → serve. If missing → 504.

---

## Current State

### Phase 0–1: Pure-Read Cache Hits + Instrumentation (Done)

**Files modified/created:**
- `migrations/0071_ai_insights_backdrop_paths.sql` — `ALTER TABLE ai_insights_cache ADD COLUMN backdrop_paths text[]`
- `src/modules/ai/ai-insights-cache.repo.ts` — `findByKey` returns `{ payload, backdropPaths }`; `upsert` writes `backdrop_paths`; new `updateBackdropPaths` for legacy self-heal
- `src/modules/ai/ai-insights.service.ts` — cache hits serve with zero TMDB/LLM calls; legacy rows self-heal by fetching backdrops once and writing back; `cacheHit`/`backdropBackfilled` instrumentation

**Behavior:**
- Cache hit → pure DB read → serve. No TMDB, no LLM.
- Legacy row (no `backdrop_paths`) → fetch once via `fetchBackdropPaths`, write back, serve.

### Phase 2: Worker Generation with Coalescing (Done)

**Files created/modified:**
- `src/lib/queue.ts` — `aiGenerationQueueName = 'ai-generation'`, `AiInsightsJob` type, `enqueueAiInsightsJob` (deterministic jobId, `attempts: 1`, `removeOnComplete: true`, `removeOnFail: true`), `getAiGenerationQueue`/`getAiGenerationQueueEvents` singletons
- `src/modules/ai/ai-insights-generation.ts` — extracted worker-side `generateInsightsIntoCache` + relocated helpers (`fetchBackdropPaths`, `buildTitleInsightsContext`, `normalizeInsightsPayload`)
- `src/modules/ai/ai-generation.gateway.ts` — `AiGenerationGateway` interface + `BullMqAiGenerationGateway` (`enqueueInsights` → `{ jobId }`, `waitForInsights` → `Job.fromId` early-return-if-missing + `waitUntilReady()` + `waitUntilFinished`)
- `src/modules/ai/ai-insights.service.ts` — cold path: readCache → miss → enqueue → bounded wait (try/catch) → re-read → 504; gateway injected as 10th constructor param
- `src/worker/ai-generation.worker.ts` — `concurrency: env.aiWorkerConcurrency` (default 4), `maxStalledCount: 0`
- `src/worker/jobs/ai-insights.job.ts` — thin wrapper calling `generateInsightsIntoCache`
- `src/bin/worker.ts` — starts both projection + ai-generation workers, SIGTERM closes both
- `src/config/env.ts` — `AI_WORKER_CONCURRENCY` (default 4), `AI_REQUEST_WAIT_MS` (default 55000)

**Tests:**
- `src/modules/ai/ai-insights.service.test.ts` — 6 tests: hit=0 enqueues, legacy backfill, miss→generate→serve, concurrent coalescing (2 misses → 1 generation), wait-rejects-but-row-served, 504 on no-write
- `src/modules/ai/ai-insights-generation.test.ts` — 3 tests: normalizeInsightsPayload, buildTitleInsightsContext, fetchBackdropPaths

**Cold path flow (insights):**
```
readCache(contentId, locale, generationVersion)
  → hit?  → serveFromCache (pure DB read)
  → miss? → enqueueInsights(params)
           → waitForInsights(handle, 55s) [try/catch]
           → readCache again
           → found? → serveFromCache
           → missing? → 504
```

---

## Remaining Work

### Phase 3: AI Search — Temporary Few-Minute Cache (Bump TTL)

**Conclusion:** AI search keeps a **temporary, in-process cache** — the existing coalescer — but its TTL is raised from 10s to a few minutes. **No** durable Postgres cache, **no** worker job, **no** gateway extension.

**Why not durable (Postgres):**
- Natural-language queries are effectively unique per user — no two users phrase a search the same way. A durable query-keyed table would have a hit rate near zero and is pure write overhead.

**Why a temp few-minute cache is still worth it:**
- The same user re-invokes / double-taps / retries the same query within minutes — a few-minute TTL serves those from memory with zero LLM cost.
- Bursts of identical concurrent requests still coalesce into a single in-flight LLM call (`ShortLivedRequestCoalescer` dedups in-flight + caches the result for TTL).
- In-process is fine: reuse is per-user, and the key already includes `userId | profileId` (`ai-search.service.ts:58`), so even Multi-instance overlap is limited to a single user's retries.

**No-retry/time-bound is already satisfied** on the request path:
- `OpenAiCompatibleClient.sendChatCompletion` does a single `fetch` — no retries (`src/modules/ai/openai-compatible.client.ts:106`).
- `AiRequestExecutor` wraps the call in `AbortSignal.timeout(90s)` and maps timeout → 504 (`src/modules/ai/ai-request-executor.ts:22`).

#### 3.1 Change: `src/modules/ai/ai-search.service.ts`

- Raise `AI_SEARCH_CACHE_TTL_MS` from `10_000` to `300_000` (5 min).
- Instantiate the coalescer with the higher TTL (constructor already injects it, so tests can override).

#### 3.2 Change: `src/config/env.ts`

- New env var `AI_SEARCH_CACHE_TTL_MS` (default `300000`) so the TTL is tunable without a redeploy. Service uses `env.aiSearchCacheTtlMs` if present, else the constant.

#### 3.3 Tests

- Extend `src/modules/ai/ai-search.service.test.ts`: assert a second call for the same `(userId, profileId, query, locale)` within TTL does **not** hit the executor (cache serves it).
- Assert a different query (or different user) bypasses the cache and hits the executor.

**What stays:**
- No migration, no `ai_search_cache` table, no `ai-search-cache.repo.ts`, no `ai-search-generation.ts`, no `ai-search.job.ts`. The worker and gateway are untouched.

---

### Phase 4: Rate Limits + Queue Depth Guard

**Goal:** Prevent abuse (per-user rate limits) and provider overload (queue depth guard). Redis-backed for multi-process safety.

#### 4.1 Redis-Backed Rate Limiter: `src/modules/ai/ai-rate-limit.service.ts`

New service using `ioredis` (already available via BullMQ dependency):
- `checkAndConsume(userId, feature)` → `{ allowed: boolean, retryAfterSeconds?: number, remaining?: number }`
- Key: `ai-rate:{userId}:{feature}:{windowStart}`
- Sliding window: Redis `INCR` + `EXPIRE` (60s window)
- Env vars: `AI_RATE_LIMIT_SEARCH_PER_MINUTE` (default 20), `AI_RATE_LIMIT_INSIGHTS_PER_MINUTE` (default 30)

#### 4.2 Queue Depth Guard

Before enqueue, check queue depth:
```typescript
const counts = await queue.getJobCounts('waiting', 'delayed');
const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
if (depth > env.aiQueueDepthLimit) {
  throw new HttpError(503, 'AI generation queue is full. Please try again later.');
}
```

Env var: `AI_QUEUE_DEPTH_LIMIT` (default 100).

#### 4.3 Wire into Routes: `src/http/routes/ai.ts`

- Inject `AiRateLimitService` into route deps
- Check rate limit before calling `aiSearchService.search` / `aiInsightsService.getInsights`
- Return `429` with `Retry-After` header when exceeded
- Check queue depth before enqueue (inside service cold path)

#### 4.4 Tests

- `src/modules/ai/ai-rate-limit.service.test.ts` — allowed within limit, rejected over limit, remaining count accurate, window reset
- Queue depth guard test: depth > limit → 503

---

### Phase 5: Orphan Pruning + Admin Diagnostics

**Goal:** Clean up old `generation_version` rows (provider/model upgrades leave orphans) and expose operational visibility.

#### 5.1 Janitor Job: `src/worker/jobs/ai-cache-prune.job.ts`

Periodic job (daily or on-demand via admin), **insights cache only** (search has no durable cache):

```sql
DELETE FROM ai_insights_cache
WHERE generation_version NOT LIKE 'v6:%';
```

Current version prefix is hardcoded (`v6`). When `GENERATION_VERSION` bumps, the janitor prunes all rows from older versions.

#### 5.2 Register in Worker: `src/worker/index.ts` or `src/worker/ai-generation.worker.ts`

Add `case 'ai-cache-prune':` calling `runAiCachePruneJob()`.

#### 5.3 Admin Diagnostics Endpoint: `src/http/routes/admin-ai.routes.ts`

`GET /v1/admin/ai/diagnostics` (admin-only):
- Queue depths: `getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed')` for both queues
- Insights cache row counts per `generation_version`
- Orphan count (rows where `generation_version NOT LIKE 'v6:%'`)

#### 5.4 Env Var for Janitor Schedule

`AI_PRUNE_CRON` (default `'0 3 * * *'` — daily at 3am). If using BullMQ repeat jobs, configure the repeat interval. Alternatively, manual trigger via admin endpoint.

#### 5.5 Tests

- Janitor test: insert rows with old version, run pruner, verify deleted and current rows preserved
- Diagnostics test: mock queue + DB, verify response shape

---

## File Inventory

### Existing (Modified)
| File | Changes |
|------|---------|
| `src/modules/ai/ai-insights.service.ts` | Cold path rewrite, try/catch wait, 504 |
| `src/modules/ai/ai-insights-cache.repo.ts` | `findByKey` returns backdropPaths, `updateBackdropPaths` |
| `src/modules/ai/ai-insights-generation.ts` | Extracted worker-side generation |
| `src/modules/ai/ai-generation.gateway.ts` | `AiGenerationGateway` + `BullMqAiGenerationGateway`, waitUntilReady |
| `src/lib/queue.ts` | `ai-generation` queue, job types, enqueue functions |
| `src/config/env.ts` | `AI_WORKER_CONCURRENCY`, `AI_REQUEST_WAIT_MS` |
| `src/worker/ai-generation.worker.ts` | `concurrency`, `maxStalledCount: 0` |
| `src/bin/worker.ts` | Starts both workers, SIGTERM closes both |
| `migrations/0071_ai_insights_backdrop_paths.sql` | `backdrop_paths text[]` |
| `src/modules/ai/ai-search.service.ts` | Phase 3: TTL 10s → 5 min (temp cache) |
| `src/config/env.ts` | Phase 3: add `AI_SEARCH_CACHE_TTL_MS` |

### New (Phase 4–5)
| File | Purpose |
|------|---------|
| `src/modules/ai/ai-rate-limit.service.ts` | Redis-backed per-user rate limiter |
| `src/worker/jobs/ai-cache-prune.job.ts` | Janitor: prune old `generation_version` rows (insights) |
| `src/http/routes/admin-ai.routes.ts` | Admin diagnostics endpoint |

### Tests (New/Modified)
| File | Coverage |
|------|----------|
| `src/modules/ai/ai-insights.service.test.ts` | 6 tests (done) |
| `src/modules/ai/ai-insights-generation.test.ts` | 3 tests (done) |
| `src/modules/ai/ai-search.service.test.ts` | Phase 3: same-key serves from cache, different key bypasses |
| `src/modules/ai/ai-rate-limit.service.test.ts` | Phase 4 |

---

## Verification Gates

Run after each phase:
```bash
npm run typecheck          # TypeScript strict, zero errors
npm run contract:lint      # Contract specs (6 specs, zero errors)
npm test                   # Full suite (20 pre-existing env-dependent failures, zero regressions)
npm run contract:drift     # Baseline fails on admin routes (known, pre-existing)
```

---

## Migration Numbering

- `0071` — `ai_insights_backdrop_paths` (done)
- `0072` — `retire_lite_pricing_tier` (pre-existing, not ours)
- `0073` — reserved; **not needed** for search (temp in-process cache needs no schema). No further AI schema changes are planned unless Phase 4/5 requires them.
