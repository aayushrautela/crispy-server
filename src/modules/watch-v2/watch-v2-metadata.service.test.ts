import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('WatchV2MetadataService upsertEpisodicFollowState writes canonical next-episode fields', async () => {
  const { WatchV2MetadataService } = await import('./watch-v2-metadata.service.js');

  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  const service = new WatchV2MetadataService({} as never, {} as never);
  await service.upsertEpisodicFollowState(client as never, {
    profileId: 'profile-1',
    titleContentId: 'content-show-1',
    titleMediaKey: 'show:tvdb:100',
    nextEpisode: {
      mediaKey: 'episode:tvdb:100:1:2',
      airDate: '2026-04-10',
      seasonNumber: 1,
      episodeNumber: 2,
      absoluteEpisodeNumber: null,
      title: 'Episode 2',
    },
    metadataRefreshedAt: '2026-04-07T12:00:00.000Z',
    payload: { source: 'test' },
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0]?.sql ?? '', /next_episode_media_key/);
  assert.match(queries[0]?.sql ?? '', /next_episode_season_number/);
  assert.match(queries[0]?.sql ?? '', /next_episode_episode_number/);
  assert.match(queries[0]?.sql ?? '', /next_episode_absolute_episode_number/);
  assert.match(queries[0]?.sql ?? '', /next_episode_title/);
  assert.deepEqual(queries[0]?.params, [
    'profile-1',
    'content-show-1',
    'show:tvdb:100',
    '2026-04-10',
    'episode:tvdb:100:1:2',
    1,
    2,
    null,
    'Episode 2',
    '2026-04-07T12:00:00.000Z',
    JSON.stringify({ source: 'test' }),
  ]);
});

test('WatchV2MetadataService syncEpisodicFollowState resolves canonical next episode and forwards payload', async () => {
  const { WatchV2MetadataService } = await import('./watch-v2-metadata.service.js');

  const upserts: Array<Record<string, unknown>> = [];
  const service = new WatchV2MetadataService(
    {
      resolveNextEpisode: async () => ({
        mediaKey: 'episode:tvdb:100:1:2',
        airDate: '2026-04-10',
        seasonNumber: 1,
        episodeNumber: 2,
        absoluteEpisodeNumber: null,
        title: 'Episode 2',
      }),
    } as never,
    {} as never,
  );

  service.upsertEpisodicFollowState = async (_client: unknown, input: Record<string, unknown>) => {
    upserts.push(input);
  };

  await service.syncEpisodicFollowState({} as never, {
    profileId: 'profile-1',
    titleContentId: 'content-show-1',
    titleMediaKey: 'show:tvdb:100',
    seriesIdentity: {
      mediaKey: 'show:tvdb:100',
      mediaType: 'show',
      provider: 'tvdb',
      providerId: '100',
      tmdbId: null,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
    },
    payload: { source: 'test' },
  });

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.titleContentId, 'content-show-1');
  assert.equal(upserts[0]?.titleMediaKey, 'show:tvdb:100');
  assert.deepEqual(upserts[0]?.nextEpisode, {
    mediaKey: 'episode:tvdb:100:1:2',
    airDate: '2026-04-10',
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteEpisodeNumber: null,
    title: 'Episode 2',
  });
  assert.deepEqual(upserts[0]?.payload, { source: 'test' });
});
