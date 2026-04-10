import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { inferMediaIdentity } from '../identity/media-key.js';

seedTestEnv();

test('listWatchV2WatchedEpisodeKeys expands watched title override using source-backed episodes', async () => {
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
      loadTitleSource: async () => ({
        identity: inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
        language: null,
        providerIdentity: inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
        providerContext: {
          title: null,
          currentEpisode: null,
          nextEpisode: null,
          seasons: [],
          episodes: [
            {
              mediaType: 'episode',
              provider: 'tvdb',
              providerId: '100:1:1',
              parentMediaType: 'show',
              parentProvider: 'tvdb',
              parentProviderId: '100',
              seasonNumber: 1,
              episodeNumber: 1,
              absoluteEpisodeNumber: null,
              title: 'Episode 1',
              summary: null,
              airDate: '2024-01-01',
              runtimeMinutes: 45,
              rating: null,
              stillUrl: null,
              raw: {},
            },
            {
              mediaType: 'episode',
              provider: 'tvdb',
              providerId: '100:1:2',
              parentMediaType: 'show',
              parentProvider: 'tvdb',
              parentProviderId: '100',
              seasonNumber: 1,
              episodeNumber: 2,
              absoluteEpisodeNumber: null,
              title: 'Episode 2',
              summary: null,
              airDate: '2024-02-01',
              runtimeMinutes: 45,
              rating: null,
              stillUrl: null,
              raw: {},
            },
          ],
          videos: [],
          cast: [],
          directors: [],
          creators: [],
          reviews: [],
          production: null,
          collection: null,
          collectionItems: [],
          similar: [],
        },
        tmdbTitle: null,
        tmdbCurrentEpisode: null,
        tmdbNextEpisode: null,
      }),
    } as never,
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
    '11111111-1111-4111-8111-111111111111',
  );

  assert.deepEqual(keys, ['episode:tvdb:100:1:1']);
});

test('listWatchV2WatchedEpisodeKeys returns exact watched keys when source has no provider episodes', async () => {
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
        mediaIdentity: inferMediaIdentity({ mediaType: 'episode', provider: 'tvdb', parentProvider: 'tvdb', parentProviderId: '100', seasonNumber: 1, episodeNumber: 1 }),
      }),
    } as never,
    {
      loadTitleSource: async () => ({
        identity: inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
        language: null,
        providerIdentity: inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
        providerContext: null,
        tmdbTitle: null,
        tmdbCurrentEpisode: null,
        tmdbNextEpisode: null,
      }),
    } as never,
    'profile-1',
    inferMediaIdentity({ mediaType: 'show', provider: 'tvdb', providerId: '100' }),
    '11111111-1111-4111-8111-111111111111',
  );

  assert.deepEqual(keys, ['episode:tvdb:100:1:1']);
});
