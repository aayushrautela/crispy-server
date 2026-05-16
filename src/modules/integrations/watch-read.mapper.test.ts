import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHistoryRow } from './watch-read.mapper.js';

test('mapHistoryRow maps title-level show history rows', () => {
  const item = mapHistoryRow({
    id: '00000000-0000-4000-8000-000000000001',
    media_key: 'show:tmdb:789',
    title_media_key: 'show:tmdb:789',
    media_type: 'show',
    event_type: 'playback_completed',
    occurred_at: '2026-05-11T08:00:00.000Z',
    source_provider: 'trakt',
    title: 'Cached Show Title',
    subtitle: null,
    poster_url: 'https://cache.test/show-poster.jpg',
    backdrop_url: 'https://cache.test/show-backdrop.jpg',
    release_year: 2022,
    metadata_rating: 9.1,
  });

  assert.equal(item.id, '00000000-0000-4000-8000-000000000001');
  assert.equal(item.kind, 'watch_history');
  assert.equal(item.mediaItem.mediaKey, 'show:tmdb:789');
  assert.equal(item.mediaItem.mediaType, 'show');
  assert.equal(item.mediaItem.title, 'Cached Show Title');
  assert.equal(item.mediaItem.releaseYear, 2022);
  assert.equal(item.mediaItem.rating, 9.1);
  assert.equal(item.eventType, 'playback_completed');
  assert.equal(item.occurredAt, '2026-05-11T08:00:00.000Z');
  assert.deepEqual(item.origins, ['trakt']);
});
