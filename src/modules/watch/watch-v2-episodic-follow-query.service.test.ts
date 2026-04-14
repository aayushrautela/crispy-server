import assert from 'node:assert/strict';
import test from 'node:test';

test('WatchV2EpisodicFollowQueryService resolves mediaKey to contentId before querying episodic follow rows', async () => {
  const { WatchV2EpisodicFollowQueryService } = await import('./watch-v2-episodic-follow-query.service.js');

  let capturedSql = '';
  let capturedParams: unknown[] = [];
  let ensuredMediaKey = '';

  const client = {
    query: async (sql: string, params: unknown[]) => {
      capturedSql = sql;
      capturedParams = params;
      return {
        rows: [{
          title_content_id: '11111111-1111-4111-8111-111111111111',
          title_media_key: 'show:tvdb:100',
          title_media_type: 'show',
          title_provider: 'tvdb',
          title_provider_id: '100',
          reason: 'watch_activity',
          last_interacted_at: '2026-04-07T12:00:00.000Z',
          next_episode_air_date: '2026-04-10',
          next_episode_media_key: 'episode:tvdb:100:1:2',
          next_episode_season_number: 1,
          next_episode_episode_number: 2,
          next_episode_absolute_episode_number: null,
          next_episode_title: 'Episode 2',
          metadata_refreshed_at: null,
          payload: {},
        }],
      };
    },
  };

  const service = new WatchV2EpisodicFollowQueryService({
    ensureContentId: async (_client: unknown, identity: { mediaKey: string }) => {
      ensuredMediaKey = identity.mediaKey;
      return '11111111-1111-4111-8111-111111111111';
    },
    resolveContentReference: async () => {
      throw new Error('not found');
    },
  } as never);

  const result = await service.getEpisodicFollowByMediaKey(client as never, 'profile-1', 'show:tvdb:100');

  assert.equal(ensuredMediaKey, 'show:tvdb:100');
  assert.match(capturedSql, /projection\.title_content_id = \$2::uuid/);
  assert.doesNotMatch(capturedSql, /projection\.title_media_key = \$2/);
  assert.deepEqual(capturedParams, ['profile-1', '11111111-1111-4111-8111-111111111111']);
  assert.equal(result?.titleContentId, '11111111-1111-4111-8111-111111111111');
  assert.equal(result?.seriesMediaKey, 'show:tvdb:100');
  assert.equal(result?.nextEpisodeAirDate, '2026-04-10T00:00:00.000Z');
  assert.equal(result?.nextEpisodeMediaKey, 'episode:tvdb:100:1:2');
  assert.equal(result?.nextEpisodeSeasonNumber, 1);
  assert.equal(result?.nextEpisodeEpisodeNumber, 2);
  assert.equal(result?.nextEpisodeAbsoluteEpisodeNumber, null);
  assert.equal(result?.nextEpisodeTitle, 'Episode 2');
});
