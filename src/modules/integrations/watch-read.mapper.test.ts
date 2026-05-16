import test from 'node:test';
import assert from 'node:assert/strict';
import { mapContinueWatchingRow, mapHistoryRow } from './watch-read.mapper.js';

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

test('mapContinueWatchingRow maps movie progress', () => {
  const item = mapContinueWatchingRow({
    title_media_key: 'movie:tmdb:694',
    playable_media_key: 'movie:tmdb:694',
    media_type: 'movie',
    position_seconds: 120,
    duration_seconds: 7200,
    progress_bps: 167,
    last_activity_at: '2026-05-13T00:00:00.000Z',
    source_kind: 'local',
    title: 'Test Movie',
    subtitle: null,
    poster_url: null,
    backdrop_url: null,
    release_year: null,
    metadata_rating: null,
  });

  assert.equal(item.id, 'movie:tmdb:694');
  assert.equal(item.kind, 'continue_watching');
  assert.equal(item.mediaItem.mediaKey, 'movie:tmdb:694');
  assert.equal(item.mediaItem.mediaType, 'movie');
  assert.equal(item.mediaItem.parent, null);
  assert.equal(item.mediaItem.showTmdbId, null);
  assert.equal(item.progress.positionSeconds, 120);
  assert.equal(item.progress.progressPercent, 1.67);
  assert.equal(item.lastActivityAt, '2026-05-13T00:00:00.000Z');
  assert.deepEqual(item.origins, ['local']);
  assert.equal(item.dismissible, true);
});

test('mapContinueWatchingRow maps episode progress with playable key', () => {
  const item = mapContinueWatchingRow({
    title_media_key: 'show:tmdb:123',
    playable_media_key: 'episode:tmdb:123:2:5',
    media_type: 'episode',
    position_seconds: 600,
    duration_seconds: 1800,
    progress_bps: 3333,
    last_activity_at: '2026-05-14T08:00:00.000Z',
    source_provider: 'trakt',
    title: 'Cached Show Title',
    subtitle: null,
    poster_url: 'https://cache.test/poster.jpg',
    backdrop_url: 'https://cache.test/backdrop.jpg',
    still_url: null,
    release_year: 2023,
    metadata_rating: 8.0,
  });

  assert.equal(item.id, 'show:tmdb:123');
  assert.equal(item.kind, 'continue_watching');
  assert.equal(item.mediaItem.mediaKey, 'episode:tmdb:123:2:5');
  assert.equal(item.mediaItem.mediaType, 'episode');
  assert.ok(item.mediaItem.parent);
  assert.equal(item.mediaItem.parent.mediaKey, 'show:tmdb:123');
  assert.equal(item.mediaItem.parent.mediaType, 'show');
  assert.equal(item.mediaItem.parent.title, '');
  assert.equal(item.mediaItem.showTmdbId, 123);
  assert.equal(item.mediaItem.seasonNumber, 2);
  assert.equal(item.mediaItem.episodeNumber, 5);
  assert.equal(item.progress.positionSeconds, 600);
  assert.equal(item.progress.progressPercent, 33.33);
  assert.equal(item.lastActivityAt, '2026-05-14T08:00:00.000Z');
  assert.deepEqual(item.origins, ['trakt']);
});
