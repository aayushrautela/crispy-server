# Recommendation home API guide

This guide defines the home section contract used by external recommendation engines. Exact paths, auth, status codes, and error envelopes are owned by OpenAPI:

- Internal app recommendation writes: `openapi/internal-services.v1.yaml`
- Public profile home reads/writes: `openapi/public-app.v1.yaml`
- MAIN-to-RECO event ingestion: `openapi/internal-recommender.v1.yaml`
- Admin recompute and diagnostics: `openapi/admin-ops.v1.yaml`

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

Single-list write body:

```json
{
  "title": "Because you watched The Matrix",
  "subtitle": "Mind-bending sci-fi picks",
  "sectionType": "contentRail",
  "items": [
    {
      "type": "movie",
      "providerRefs": [{ "provider": "tmdb", "providerId": "603" }],
      "score": 0.98,
      "reason": "Similar tone and themes",
      "reasonCodes": ["similar_history"],
      "metadata": {}
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

Rules:

- `sectionType` replaces the old `layout` field.
- Allowed `sectionType` values are only `categoryTabs`, `heroCarousel`, `contentRail`, and `collectionRail`.
- Item identity is `type` plus `providerRefs`; RECO must not send Crispy `itemId`, `contentId`, `mediaKey`, rank, or nested identity wrappers.
- Provider refs may be TMDB, TVDB, IMDb, or Kitsu when supported by MAIN.
- Rank is array order.
- RECO may send bounded `score`, `reason`, `reasonCodes`, and `metadata` for diagnostics/explainability.
- RECO must not send enriched card payloads, posters, backdrops, logos, descriptions, storage IDs, media keys, or client DTOs.

## Public home reads

`GET /v1/profiles/:profileId/home` returns `{ data: { recommendations }, meta: { requestId } }`.

`recommendations` is either `null` or a home response containing `profileId`, `generatedAt`, `expiresAt`, and `sections`. Public section items are UI-ready cards with `itemId`, `mediaType`, title, artwork, lightweight metadata, and progress. Public responses do not expose provider refs, model scores, reason codes, storage `contentId`, media keys, or RECO internals.

## Generation lifecycle

1. MAIN emits durable `recommendation.recompute_requested` events through `service_outbox_events`.
2. MAIN posts those envelopes to RECO's `POST /internal/recommender/v1/events` endpoint with service auth.
3. RECO reads bounded machine inputs from `/internal/apps/v1` endpoints.
4. RECO publishes final home sections back through internal app recommendation write endpoints.

AI-assisted generation is owned by RECO: it uses its own server-funded key to call the OpenAI-compatible vendor directly and falls back to deterministic TMDB lists when AI is disabled or errors. RECO must not receive, cache, log, or forward raw account BYOK keys.
