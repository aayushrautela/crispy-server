import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';

seedTestEnv();

test('listWatchV2WatchedEpisodeKeys expands watched title override using TMDB episode listings', async () => {
  const { listWatchV2WatchedEpisodeKeys } = await import('./watch-v2-episode-keys.js');

  const client = {
    query: async (sql: string) => {
      if (sql.includes('SELECT override_state, applies_through_release_at')) {
        return { rows: [{ override_state: 'watched', applies_through_release_at: '2024-01-31T00:00:00.000Z' }] } as never;
      }
      if (sql.includes('SELECT DISTINCT content_id')) {
        return { rows: [] } as never;
      }
      if (sql.includes("override_state = 'unwatched'")) {
        return { rows: [{ target_content_id: 'episode-content-2' }] } as never;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as never;

  const keys = await listWatchV2WatchedEpisodeKeys(
    client,
    {
      ensureEpisodeContentIds: async () => new Map([
        ['100:s1:e1', 'episode-content-1'],
        ['100:s1:e2', 'episode-content-2'],
      ]),
      resolveContentReference: async () => null,
    } as never,
    {
      listEpisodesForShow: async () => [
        {
          showTmdbId: 100,
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: '2024-01-01',
        },
        {
          showTmdbId: 100,
          seasonNumber: 1,
          episodeNumber: 2,
          airDate: '2024-02-01',
        },
      ],
    } as never,
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', tmdbId: 100 }),
    '11111111-1111-4111-8111-111111111111',
  );

  assert.deepEqual(keys, ['episode:tmdb:100:1:1']);
});

test('listWatchV2WatchedEpisodeKeys returns exact watched keys when TMDB episode listing is empty', async () => {
  const { listWatchV2WatchedEpisodeKeys } = await import('./watch-v2-episode-keys.js');

  const client = {
    query: async (sql: string) => {
      if (sql.includes('SELECT override_state, applies_through_release_at')) {
        return { rows: [{ override_state: 'watched', applies_through_release_at: null }] } as never;
      }
      if (sql.includes('SELECT DISTINCT content_id')) {
        return { rows: [{ content_id: 'episode-content-1' }] } as never;
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as never;

  const keys = await listWatchV2WatchedEpisodeKeys(
    client,
    {
      ensureEpisodeContentIds: async () => new Map(),
      resolveContentReference: async () => ({
        entityType: 'episode',
        mediaIdentity: inferMediaIdentity({ mediaType: 'episode', provider: 'tmdb', parentProvider: 'tmdb', parentProviderId: '100', seasonNumber: 1, episodeNumber: 1 }),
      }),
    } as never,
    {
      listEpisodesForShow: async () => [],
    } as never,
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', tmdbId: 100 }),
    '11111111-1111-4111-8111-111111111111',
  );

  assert.deepEqual(keys, ['episode:tmdb:100:1:1']);
});
