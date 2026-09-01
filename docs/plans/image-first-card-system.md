# Image-First Card System - Implementation Plan

## Current State

- Summary records exist in `tmdb_titles` but often lack images in `tmdb_images`
- `tmdb_images` has no TTL (permanent)
- Detail page (`getTitle`) incorrectly serves summary records with images instead of full detail
- Search/discover early-return cached summaries without fetching images
- `searchSuggestions` endpoint exists but is "API abuse"

## Target State

- Every card response includes logo + backdrop
- Detail page always serves full detail records (credits, reviews, similar, translations)
- Summary records are internal cache tier only, never served to clients without images
- TTL: movies 15d, shows 15d, seasons 6h, images follow parent title TTL

---

## 1. TTL Configuration

**Current (`config/app-config.json`):**
```json
{
  "cache": {
    "tmdb": {
      "movieTtlHours": 168,
      "showTtlHours": 12,
      "seasonTtlHours": 12
    }
  }
}
```

**New:**
```json
{
  "cache": {
    "tmdb": {
      "movieTtlHours": 360,
      "showTtlHours": 360,
      "seasonTtlHours": 6
    }
  }
}
```

**Reasoning:**
- Movies: 15d (posters/logos rarely change for movies)
- Shows: 15d (logos stable, backdrops update occasionally)
- Seasons: 6h (new episodes air frequently, need fresh data)

---

## 2. Image TTL in Database

### Migration

```sql
ALTER TABLE tmdb_images ADD COLUMN expires_at timestamptz;

-- Backfill existing images with parent title TTL
UPDATE tmdb_images i
SET expires_at = t.expires_at
FROM tmdb_titles t
WHERE i.media_type = t.media_type AND i.tmdb_id = t.tmdb_id;

-- Create index for purge job
CREATE INDEX tmdb_images_expires_idx ON tmdb_images (expires_at);
```

### On Image Fetch

Set `expires_at` from parent title's TTL when storing images.

---

## 3. Fix `getTitle()` - Never Serve Summaries for Detail

**File:** `src/modules/metadata/providers/tmdb-cache.service.ts`

**Current behavior:** Serves summary records with images (incomplete for detail)

**Target behavior:**
```typescript
async getTitle(client, mediaType, tmdbId, language) {
  const cached = await this.tmdbRepository.getTitle(...);
  
  if (cached?.hydrationLevel === 'not_found') return null;
  
  // Only serve detail records; summary is incomplete (no logos, credits, etc.)
  if (cached?.hydrationLevel === 'detail') {
    if (!isFresh(cached)) {
      this.scheduleEntityRefresh(mediaType, tmdbId);
    }
    return cached;
  }
  
  // Cold key OR summary record → full hydrate
  await this.ingest.ingestTitle(client, mediaType, tmdbId, lang);
  const hydrated = await this.tmdbRepository.getTitle(...);
  return hydrated?.hydrationLevel === 'detail' ? hydrated : null;
}
```

---

## 4. Fix `getTitles()` - Already Implemented

Keeps summary records, checks images, fetches if missing. No changes needed.

---

## 5. Fix `searchTitles()` - Remove Early Return

**File:** `src/modules/metadata/providers/tmdb-cache.service.ts`

**Current bug:**
```typescript
if (localResults.length >= Math.min(LOCAL_SEARCH_MIN_RESULTS, limit)) {
  return localResults;  // ← serves summaries without logos
}
```

**Fix:** Always call TMDB, persist summaries with images, return fresh data.

---

## 6. Fix `discoverTitlesByGenre()` - Remove Early Return

**File:** `src/modules/metadata/providers/tmdb-cache.service.ts`

Same pattern as search - early return bypasses image fetch.

---

## 7. Remove `searchSuggestions` Endpoint

### Files to modify:
- `src/http/routes/metadata.ts` - remove route handler
- `src/modules/metadata/metadata-search.service.ts` - remove `suggestTitles` method
- `openapi/public-app.v1.yaml` - remove `/v1/search/suggestions` path
- Regenerate types via `npm run contract:types`

---

## 8. Purge Expired Images Job

### New repo method (`src/modules/metadata/providers/tmdb.repo.ts`):

```typescript
async purgeExpiredImages(client: DbClient, limit: number): Promise<void> {
  await client.query(
    `DELETE FROM tmdb_images WHERE expires_at < NOW() LIMIT $1`,
    [limit]
  );
}
```

### Wire into existing purge job (`src/worker/jobs/tmdb-cache.job.ts`):

```typescript
export async function runTmdbCachePurgeExpiredJob(payload) {
  await withDbClient(async (client) => {
    await repository.purgeExpiredEntities(client, payload.limit);
    await repository.purgeExpiredImages(client, payload.limit);
  });
}
```

---

## 9. Set `expires_at` on Image Fetch

**File:** `src/modules/metadata/providers/tmdb-ingest.service.ts`

When fetching images, calculate `expires_at` from parent title TTL:

```typescript
async fetchImages(client, mediaType, tmdbId, language) {
  const ttlHours = mediaType === 'movie' 
    ? appConfig.cache.tmdb.movieTtlHours 
    : appConfig.cache.tmdb.showTtlHours;
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  
  // ... fetch and store with expiresAt
}
```

---

## Execution Order

1. Update `config/app-config.json` TTLs
2. Create migration for `tmdb_images.expires_at`
3. Fix `getTitle()` to never serve summaries
4. Fix `searchTitles()` early return
5. Fix `discoverTitlesByGenre()` early return
6. Set `expires_at` on image fetch
7. Add `purgeExpiredImages` repo method
8. Wire image purge into existing job
9. Remove `searchSuggestions` endpoint
10. Regenerate OpenAPI types
11. Run `npm run typecheck`
12. Run `npm run contract:check`

---

## Files Modified

| File | Change |
|------|--------|
| `config/app-config.json` | Update TTLs to 360/360/6 |
| `migrations/00XX_tmdb_images_expires.sql` | Add `expires_at` column + index |
| `tmdb-cache.service.ts` | Fix getTitle, searchTitles, discoverTitlesByGenre |
| `tmdb.repo.ts` | Add `purgeExpiredImages`, set `expires_at` on insert |
| `tmdb-ingest.service.ts` | Set `expires_at` when fetching images |
| `metadata.ts` (routes) | Remove searchSuggestions route |
| `metadata-search.service.ts` | Remove suggestTitles method |
| `openapi/public-app.v1.yaml` | Remove `/v1/search/suggestions` path |
| `openapi/generated/*.ts` | Regenerated types |
| `tmdb-cache.job.ts` | Add image purge to existing job |

---

## Verification Checklist

- [ ] All cards (search, discover, home, known-for, collections) show logos
- [ ] Detail page shows full enrichment (credits, reviews, similar)
- [ ] No summary records served without images
- [ ] Expired images purged by job
- [ ] `searchSuggestions` endpoint removed
- [ ] `npm run typecheck` passes
- [ ] `npm run contract:check` passes
