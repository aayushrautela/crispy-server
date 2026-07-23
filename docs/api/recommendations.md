# Recommendation home API guide

This guide defines the home section contract used by external recommendation engines. Exact paths, auth, status codes, and error envelopes are owned by OpenAPI:

- Internal app recommendation writes: `openapi/internal-services.v1.yaml`
- Public profile home reads/writes: `openapi/public-app.v1.yaml`
- MAIN-to-RECO event ingestion: `openapi/internal-recommender.v1.yaml`
- Admin recompute and diagnostics: `openapi/admin-ops.v1.yaml`

## Home ingest pipeline

The home ingest endpoint (`PUT /internal/apps/v1/accounts/:accountId/profiles/:profileId/recommendations/lists/:listKey`) is the unified write contract for **all** home producers, not just the reco engine. Producers authenticate differently depending on whether they're owned by us (reco, fallback) or custom per-user:

- `reco` (reco engine, system-wide): Bearer token, hash matched against `RECOMMENDER_TO_MAIN_SERVICE_TOKEN_HASH`. Principal resolved from `app_registry.app_id='reco'`.
- `fallback` (internal, in-process): Not authenticated via HTTP. The fallback service is an in-process module the resolver and seed worker call directly. It invokes the same `writeHome` service used by the push path, with `source='fallback'` and a service actor (`app:system:system`). No HTTP endpoint exists for fallback.
- `custom` (per-user, PAT-authenticated): Bearer `cp_pat_...` carrying `recommendations:write`, with URL `:accountId` matching the PAT owner's `appUserId`. Principal synthesized from the user actor with `appId='custom'`. **PAT/API-key validation happens at the HTTP edge, not in the ingester.** The ingester just consumes the already-authenticated actor.

All three producers share the same write shape and the same canonicalize → policy → persist path. `/home` reads only from what the pipeline wrote. See `docs/architecture/recommendation-engine.md` → "Home ingest pipeline" for the in-process fallback contract, atomic whole-snapshot write semantics, retention policy, and single-source resolution rule.

## Home section model

A profile home screen is an ordered array of sections. Every section has:

- `listKey`: stable section key, for example `category-tabs`, `hero-carousel`, `content-rails`, or `collection-rails`
- `title`: required display title
- `subtitle`: nullable display subtitle
- `sectionType`: one of `categoryTabs`, `heroCarousel`, `contentRail`, `collectionRail`
- `items`: ordered content identities from the writer; UI-ready cards in public reads
- `meta`: server-owned/client-safe metadata

Section types:

| `sectionType` | Use |
| --- | --- |
| `categoryTabs` | Top category/tab pills that route the client to a named recommendation list. |
| `heroCarousel` | Large featured carousel for promoted movies/shows with optional item reasons/subtext. |
| `contentRail` | Standard horizontal content rail with title/subtitle and ordered movies/shows. |
| `collectionRail` | Horizontal rail of curated collections/folders; current write items are provider-resolved content identities. |

## Internal RECO writes

RECO writes section metadata plus ordered provider identities. MAIN derives rank from array order, resolves provider refs to canonical internal item identity, applies policy/idempotency, persists versions, and enriches public client responses at read time.

A single-list write body is a single rail of the snapshot:

```json
{
  "title": "Because you watched The Matrix",
  "subtitle": "Mind-bending sci-fi picks",
  "sectionType": "contentRail",
  "items": [
    {
      "type": "movie",
      "providerRefs": [{ "provider": "tmdb", "providerId": "603" }]
    }
  ],
  "model": {
    "runId": "rec-run-123",
    "algorithmVersion": "home-v3",
    "modelVersion": "ranker-2026-05"
  },
  "context": {}
}
```

Contract rules (what a producer **must** send and what the ingester **requires**):

- `sectionType` replaces the old `layout` field. Allowed values: `categoryTabs`, `heroCarousel`, `contentRail`, `collectionRail`.
- Item identity is `type` plus `providerRefs`; producers must not send Crispy `itemId`, `contentId`, `mediaKey`, `rank`, or nested identity wrappers.
- Provider refs may be TMDB, TVDB, IMDb, or Kitsu when supported by MAIN.
- Rank is array order. Producers must not send `rank`.
- `model` is required only for `source='reco'`. Pass `null` for `source='custom'` and `source='fallback'` (no model tracking).

Currently tolerated but ignored fields (still accepted by the OpenAPI schema for backward compatibility; produced artifacts no longer carry them once PR 3 lands):

- `score` — array order is the only ordering signal.
- `reason` — folding into per-item `subtitle` override; producers that want per-card subtitle text send it as `subtitle` in the items.json blob.
- `reasonCodes` — no downstream consumer in the home response; only useful for `reco` engine's own analytics, which producers should track on their own side.
- `metadata` — open bag with no contract; not surfaced for `reco`/`fallback` producers.

Producers must not send enriched card payloads, posters, backdrops, logos, descriptions, storage IDs, media keys, or client DTOs. The ingester canonicalizes identifiers at write time and TMDB enrichment happens at read time.

## Public home reads

`GET /v1/profiles/:profileId/home` returns the standard envelope `{ data: <ProfileHomeResponse>, meta: { requestId } }` where `data` contains `profileId`, `generatedAt`, `expiresAt`, `sections`, `mode`, and `source`. Public section items are UI-ready cards with `itemId`, `mediaType`, title, artwork, lightweight metadata, `trailerUrl`, and progress. Public responses do not expose provider refs, model scores, reason codes, storage `contentId`, media keys, or RECO internals.

`mode` is the profile's current home mode (`recommended` or `custom`); `source` is which producer's snapshot is currently serving the home screen (`custom`, `reco`, `fallback`, or `empty`). A response always carries rails from exactly one `source` — sources are never concatenated.

## Generation lifecycle

1. MAIN emits durable `recommendation.recompute_requested` events through `service_outbox_events`.
2. MAIN posts those envelopes to RECO's `POST /internal/recommender/v1/events` endpoint with service auth.
3. RECO reads bounded machine inputs from `/internal/apps/v1` endpoints.
4. RECO publishes final home sections back through internal app recommendation write endpoints.

AI-assisted generation is owned by RECO: it uses its own server-funded key to call the OpenAI-compatible vendor directly and falls back to deterministic TMDB lists when AI is disabled or errors. RECO must not receive, cache, log, or forward raw account BYOK keys.
