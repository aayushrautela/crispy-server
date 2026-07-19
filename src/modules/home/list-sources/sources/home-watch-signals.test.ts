import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../../test-helpers.js';

seedTestEnv();
const { topGenresForProfile, recentWatchedTmdbIds } = await import('./home-watch-signals.js');

function fakeClient(rows: unknown[]): never {
  return { query: async () => ({ rows }) } as never;
}

test('topGenresForProfile maps aggregated genre rows and sorts descending', async () => {
  const client = fakeClient([
    { genre_id: 28, media_type: 'movie', count: '5' },
    { genre_id: 18, media_type: 'movie', count: '2' },
    { genre_id: 10765, media_type: 'tv', count: '3' },
  ]) as never;

  const genres = await topGenresForProfile(client, 'profile-1', 200, 5);
  assert.equal(genres.length, 3);
  const byId = new Map(genres.map((g) => [g.genreId, g]));
  assert.equal(byId.get(28)?.mediaType, 'movie');
  assert.equal(byId.get(28)?.count, 5);
  assert.equal(byId.get(10765)?.mediaType, 'tv');
});

test('topGenresForProfile normalizes media type to movie/tv', async () => {
  const client = fakeClient([
    { genre_id: 10765, media_type: 'series', count: '1' },
  ]) as never;

  const genres = await topGenresForProfile(client, 'profile-2', 200, 5);
  assert.equal(genres.length, 1);
  assert.equal(genres[0]!.mediaType, 'movie', 'unknown media type falls back to movie');
});

test('recentWatchedTmdbIds returns deduped id+mediaType pairs', async () => {
  const client = fakeClient([
    { media_type: 'movie', tmdb_id: 11 },
    { media_type: 'movie', tmdb_id: 22 },
    { media_type: 'tv', tmdb_id: 9 },
  ]) as never;

  const ids = await recentWatchedTmdbIds(client, 'profile-3', 50);
  const sorted = ids.slice().sort((a, b) => a.tmdbId - b.tmdbId);
  assert.deepEqual(sorted, [
    { mediaType: 'tv', tmdbId: 9 },
    { mediaType: 'movie', tmdbId: 11 },
    { mediaType: 'movie', tmdbId: 22 },
  ]);
});
