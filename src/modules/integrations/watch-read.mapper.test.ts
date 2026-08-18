import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePublicItemId } from '../identity/public-item-id.js';
import { mapContinueWatchingRow, mapHistoryRow, mapWatchStateRow } from './watch-read.mapper.js';

const showId = '00000000-0000-4000-8000-000000000001';
const movieId = '00000000-0000-4000-8000-000000000002';
const episodeId = '00000000-0000-4000-8000-000000000003';
const seasonId = '00000000-0000-4000-8000-000000000004';

test('mapHistoryRow maps title-level show history rows', () => {
  const item = mapHistoryRow({
    id: '00000000-0000-4000-8000-000000000010',
    item_id: showId,
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

  assert.equal(item.Id, encodePublicItemId(showId));
  assert.equal(item.Type, 'Series');
  assert.equal(item.Name, 'Cached Show Title');
  assert.equal(item.ProductionYear, 2022);
  assert.equal(item.CommunityRating, 9.1);
  assert.deepEqual(item.ProviderIds, { Tmdb: null, Imdb: null, Tvdb: null });
  assert.equal(item.UserData!.Played, true);
  assert.equal(item.UserData!.LastPlayedDate, '2026-05-11T08:00:00.000Z');
});
test('mapHistoryRow uses actual provider IDs when present', () => {
  const item = mapHistoryRow({
    id: '00000000-0000-4000-8000-000000000011',
    item_id: movieId,
    media_type: 'movie',
    event_type: 'playback_completed',
    occurred_at: '2026-05-12T08:00:00.000Z',
    title_provider_id: '550',
    imdb_id: 'tt0137523',
    tvdb_id: '12345',
  });

  assert.equal(item.Id, encodePublicItemId(movieId));
  assert.deepEqual(item.ProviderIds, { Tmdb: '550', Imdb: 'tt0137523', Tvdb: '12345' });
});
test('mapContinueWatchingRow maps movie progress', () => {
  const item = mapContinueWatchingRow({
    title_item_id: movieId,
    playable_item_id: movieId,
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

  assert.equal(item.Id, encodePublicItemId(movieId));
  assert.equal(item.Type, 'Movie');
  assert.equal(item.ProviderIds.Tmdb, null);
  assert.equal(item.UserData!.PlaybackPositionTicks, 1_200_000_000);
  assert.equal(item.UserData!.RuntimeTicks, 72_000_000_000);
  assert.equal(item.UserData!.PlayedPercentage, 1.67);
  assert.equal(item.UserData!.LastPlayedDate, '2026-05-13T00:00:00.000Z');
  assert.equal(item.UserData!.Played, false);
});

test('mapContinueWatchingRow maps episode progress with playable key', () => {
  const item = mapContinueWatchingRow({
    title_item_id: showId,
    playable_item_id: episodeId,
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

  assert.equal(item.Id, encodePublicItemId(episodeId));
  assert.equal(item.Type, 'Episode');
  assert.equal(item.SeriesId, encodePublicItemId(showId));
  assert.equal(item.SeriesName, 'Cached Show Title');
  assert.equal(item.ParentIndexNumber, null);
  assert.equal(item.IndexNumber, null);
  assert.equal(item.EpisodeTitle, 'Cached Show Title');
  assert.equal(item.ProviderIds.Tmdb, null);
  assert.equal(item.UserData!.PlaybackPositionTicks, 6_000_000_000);
  assert.equal(item.UserData!.PlayedPercentage, 33.33);
  assert.equal(item.UserData!.LastPlayedDate, '2026-05-14T08:00:00.000Z');
});

test('mapContinueWatchingRow maps show-level progress with season/episode as episode card', () => {
  const item = mapContinueWatchingRow({
    title_item_id: showId,
    playable_item_id: episodeId,
    media_type: 'show',
    position_seconds: 600,
    duration_seconds: 1800,
    progress_bps: 3333,
    last_activity_at: '2026-05-14T08:00:00.000Z',
    source_provider: 'trakt',
    title_provider_id: '52814',
    imdb_id: 'tt0118415',
    tvdb_id: null,
    season_number: 2,
    episode_number: 5,
  });

  assert.equal(item.Id, encodePublicItemId(episodeId));
  assert.equal(item.Type, 'Episode');
  assert.equal(item.SeriesId, encodePublicItemId(showId));
  assert.equal(item.ParentIndexNumber, 2);
  assert.equal(item.IndexNumber, 5);
  assert.deepEqual(item.ProviderIds, { Tmdb: '52814', Imdb: 'tt0118415', Tvdb: null });
  assert.equal(item.UserData!.PlaybackPositionTicks, 6_000_000_000);
});

test('mapContinueWatchingRow maps percentage-only imported progress (no seconds)', () => {
  const item = mapContinueWatchingRow({
    title_item_id: movieId,
    playable_item_id: movieId,
    media_type: 'movie',
    position_seconds: 0,
    duration_seconds: 0,
    progress_bps: 4889,
    last_activity_at: '2026-05-15T00:00:00.000Z',
    source_kind: 'provider_import',
    title: 'Imported Movie',
    subtitle: null,
    poster_url: null,
    backdrop_url: null,
    release_year: null,
    metadata_rating: null,
  });

  assert.equal(item.Id, encodePublicItemId(movieId));
  assert.equal(item.Type, 'Movie');
  assert.equal(item.ProviderIds.Tmdb, null);
  assert.equal(item.UserData!.PlaybackPositionTicks, 0);
  assert.equal(item.UserData!.RuntimeTicks, 0);
  assert.equal(item.UserData!.PlayedPercentage, 48.89);
  assert.equal(item.UserData!.LastPlayedDate, '2026-05-15T00:00:00.000Z');
  assert.equal(item.UserData!.Played, false);
});

test('mapWatchStateRow resolves episode identity via show tmdb id + season/episode', () => {
  const item = mapWatchStateRow({
    item_id: episodeId,
    media_type: 'episode',
    title_provider_id: '52814',
    imdb_id: null,
    tvdb_id: null,
    show_tmdb_id: '32726',
    season_number: 1,
    episode_number: 1,
    effective_watched: true,
    play_count: 1,
    last_watched_at: '2026-05-16T00:00:00.000Z',
  });

  assert.equal(item.Id, encodePublicItemId(episodeId));
  assert.equal(item.Type, 'Episode');
  assert.equal(item.ParentIndexNumber, 1);
  assert.equal(item.IndexNumber, 1);
  assert.deepEqual(item.ProviderIds, { Tmdb: '32726', Imdb: null, Tvdb: null });
  assert.equal(item.UserData!.Played, true);
});
