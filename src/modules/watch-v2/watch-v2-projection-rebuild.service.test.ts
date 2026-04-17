import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { WatchV2ProjectionRebuildService } = await import('./watch-v2-projection-rebuild.service.js');

test('rebuildProfile heals missing active playback duration from metadata runtime', async () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const service = new WatchV2ProjectionRebuildService(
    {
      getProjectionAggregate: async () => ({
        activeState: {
          contentId: 'content-episode-1',
          playbackStatus: 'in_progress',
          positionSeconds: 300,
          durationSeconds: null,
          progressPercent: 14.5,
          playCount: 0,
          lastCompletedAt: null,
          lastActivityAt: '2024-01-03T00:00:00.000Z',
          dismissedAt: null,
        },
        override: null,
        watchlist: null,
        rating: null,
        lastPlayableCompletedAt: null,
        lastHistoryCompletedAt: null,
      }),
      backfillPlayableDuration: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'backfillPlayableDuration', args }); },
      upsertTitleProjection: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertTitleProjection', args }); },
      listTitlesToRebuild: undefined,
    } as never,
    {
      resolveContentReference: async (_client: unknown, contentId: string) => ({
        contentId,
        entityType: contentId === 'content-show-1' ? 'show' : 'episode',
        mediaIdentity: contentId === 'content-show-1'
          ? {
              contentId: 'content-show-1',
              mediaKey: 'show:tvdb:100',
              mediaType: 'show',
              provider: 'tvdb',
              providerId: '100',
            }
          : {
              contentId: 'content-episode-1',
              mediaKey: 'episode:tvdb:100:1:2',
              mediaType: 'episode',
              provider: 'tvdb',
              providerId: '100:s1:e2',
              parentContentId: 'content-show-1',
              parentProvider: 'tvdb',
              parentProviderId: '100',
              seasonNumber: 1,
              episodeNumber: 2,
              absoluteEpisodeNumber: null,
            },
      }),
    } as never,
    {
      buildProjection: async (_client: unknown, identity: { mediaType?: string }) => (
        identity.mediaType === 'episode'
          ? {
              detailsTitleMediaType: 'show',
              playbackMediaType: 'episode',
              playbackProvider: 'tvdb',
              playbackProviderId: '100:s1:e2',
              playbackParentProvider: 'tvdb',
              playbackParentProviderId: '100',
              playbackSeasonNumber: 1,
              playbackEpisodeNumber: 2,
              playbackAbsoluteEpisodeNumber: null,
              detailsStillUrl: null,
              detailsReleaseYear: 2024,
              detailsRuntimeMinutes: 45,
              detailsRating: 8.2,
              episodeTitle: 'Episode 2',
              episodeAirDate: '2024-01-02T00:00:00.000Z',
              episodeRuntimeMinutes: 45,
              episodeStillUrl: null,
              title: 'Example Show',
              subtitle: 'S1 E2',
              posterUrl: 'poster',
              backdropUrl: 'backdrop',
            }
          : {
              detailsTitleMediaType: 'show',
              playbackMediaType: 'show',
              playbackProvider: 'tvdb',
              playbackProviderId: '100',
              playbackParentProvider: null,
              playbackParentProviderId: null,
              playbackSeasonNumber: null,
              playbackEpisodeNumber: null,
              playbackAbsoluteEpisodeNumber: null,
              detailsStillUrl: null,
              detailsReleaseYear: 2024,
              detailsRuntimeMinutes: 45,
              detailsRating: 8.2,
              episodeTitle: null,
              episodeAirDate: null,
              episodeRuntimeMinutes: null,
              episodeStillUrl: null,
              title: 'Example Show',
              subtitle: null,
              posterUrl: 'poster',
              backdropUrl: 'backdrop',
            }
      ),
      syncEpisodicFollowState: async () => {},
    } as never,
  );

  const client = {
    query: async () => ({
      rows: [{ profile_id: 'profile-1', title_content_id: 'content-show-1' }],
    }),
  } as never;

  const result = await service.rebuildProfile(client, 'profile-1');

  assert.equal(result.titleProjections, 1);
  assert.ok(calls.some((entry) => entry.method === 'backfillPlayableDuration' && entry.args.durationSeconds === 2700));
  const projectionCall = calls.find((entry) => entry.method === 'upsertTitleProjection');
  const aggregate = projectionCall?.args.aggregate as { activeState?: { durationSeconds?: number | null } } | undefined;
  assert.equal(aggregate?.activeState?.durationSeconds, 2700);
});
