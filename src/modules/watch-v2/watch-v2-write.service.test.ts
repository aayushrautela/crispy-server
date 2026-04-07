import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { WatchV2WriteService } = await import('./watch-v2-write.service.js');

test('markWatched writes completed playable state and history for playable targets', async () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const repository = createRepository(calls, {
    reserveMutationSequence: 7,
    getPlayableState: null,
    getProjectionAggregate: {
      activeState: null,
      override: { overrideState: 'watched', sourceUpdatedAt: '2024-01-01T00:00:00.000Z' },
      watchlist: null,
      rating: null,
      lastPlayableCompletedAt: '2024-01-01T00:00:00.000Z',
      lastHistoryCompletedAt: '2024-01-01T00:00:00.000Z',
    },
  });
  const service = new WatchV2WriteService(
    repository as never,
    {
      ensureContentId: async (_client: unknown, identity: { mediaType?: string }) => (
        identity.mediaType === 'show' ? 'content-show-1' : 'content-episode-1'
      ),
      resolveContentReference: async () => ({
        contentId: 'content-episode-1',
        entityType: 'episode',
        mediaIdentity: {
          contentId: 'content-episode-1',
          mediaKey: 'episode:tvdb:100:1:2',
          mediaType: 'episode',
          provider: 'tvdb',
          providerId: '100:s1:e2',
          parentContentId: 'content-show-1',
          parentProvider: 'tvdb',
          parentProviderId: '100',
          tmdbId: null,
          showTmdbId: null,
          seasonNumber: 1,
          episodeNumber: 2,
          absoluteEpisodeNumber: null,
        },
      }),
    } as never,
    {
      buildWatchProjection: async () => createProjection({ title: 'Example Show', posterUrl: 'poster' }),
    } as never,
    createMetadataService() as never,
  );

  await service.markWatched({} as never, {
    profileId: 'profile-1',
    identity: {
      mediaKey: 'episode:tvdb:100:1:2',
      mediaType: 'episode',
      provider: 'tvdb',
      providerId: '100:s1:e2',
      parentContentId: 'content-show-1',
      parentProvider: 'tvdb',
      parentProviderId: '100',
      tmdbId: null,
      showTmdbId: null,
      seasonNumber: 1,
      episodeNumber: 2,
      absoluteEpisodeNumber: null,
    },
    occurredAt: '2024-01-01T00:00:00.000Z',
  });

  assert.ok(calls.some((entry) => entry.method === 'upsertPlayableState' && entry.args.playbackStatus === 'completed'));
  assert.ok(calls.some((entry) => entry.method === 'insertPlayHistory'));
  assert.ok(calls.some((entry) => entry.method === 'upsertWatchOverride' && entry.args.overrideState === 'watched'));
  assert.ok(calls.some((entry) => entry.method === 'upsertTitleProjection' && entry.args.titleContentId === 'content-show-1'));
});

test('unmarkWatched clears playable progress for title targets and voids history', async () => {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
  const repository = createRepository(calls, {
    reserveMutationSequence: 4,
    getProjectionAggregate: {
      activeState: null,
      override: { overrideState: 'unwatched', sourceUpdatedAt: '2024-02-01T00:00:00.000Z' },
      watchlist: null,
      rating: null,
      lastPlayableCompletedAt: null,
      lastHistoryCompletedAt: null,
    },
  });
  const service = new WatchV2WriteService(
    repository as never,
    {
      ensureContentId: async () => 'content-show-1',
      resolveContentReference: async () => ({
        contentId: 'content-show-1',
        entityType: 'show',
        mediaIdentity: {
          contentId: 'content-show-1',
          mediaKey: 'show:tvdb:100',
          mediaType: 'show',
          provider: 'tvdb',
          providerId: '100',
          parentContentId: null,
          parentProvider: null,
          parentProviderId: null,
          tmdbId: null,
          showTmdbId: null,
          seasonNumber: null,
          episodeNumber: null,
          absoluteEpisodeNumber: null,
        },
      }),
    } as never,
    {
      buildWatchProjection: async () => createProjection({ title: 'Example Show', posterUrl: 'poster' }),
    } as never,
    createMetadataService() as never,
  );

  await service.unmarkWatched({} as never, {
    profileId: 'profile-1',
    identity: {
      mediaKey: 'show:tvdb:100',
      mediaType: 'show',
      provider: 'tvdb',
      providerId: '100',
      parentContentId: null,
      parentProvider: null,
      parentProviderId: null,
      tmdbId: null,
      showTmdbId: null,
      seasonNumber: null,
      episodeNumber: null,
      absoluteEpisodeNumber: null,
    },
    occurredAt: '2024-02-01T00:00:00.000Z',
  });

  assert.ok(calls.some((entry) => entry.method === 'deletePlayableStateByTitle' && entry.args.titleContentId === 'content-show-1'));
  assert.ok(calls.some((entry) => entry.method === 'voidPlayHistoryByTitle' && entry.args.titleContentId === 'content-show-1'));
  assert.ok(calls.some((entry) => entry.method === 'upsertWatchOverride' && entry.args.overrideState === 'unwatched'));
});

function createProjection(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function createMetadataService() {
  return {
    buildProjection: async () => createProjection({ title: 'Example Show', posterUrl: 'poster' }),
    syncEpisodicFollowState: async () => {},
    deleteEpisodicFollowState: async () => {},
  };
}

function createRepository(calls: Array<{ method: string; args: Record<string, unknown> }>, overrides: Record<string, unknown>) {
  return {
    reserveMutationSequence: async () => overrides.reserveMutationSequence ?? 1,
    getPlayableState: async () => overrides.getPlayableState ?? null,
    upsertPlayableState: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertPlayableState', args }); },
    insertPlayHistory: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'insertPlayHistory', args }); },
    upsertWatchOverride: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertWatchOverride', args }); },
    upsertWatchlistState: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertWatchlistState', args }); },
    upsertRatingState: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertRatingState', args }); },
    dismissPlayableState: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'dismissPlayableState', args }); },
    deletePlayableState: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'deletePlayableState', args }); },
    deletePlayableStateByTitle: async (_client: unknown, _profileId: string, titleContentId: string) => {
      calls.push({ method: 'deletePlayableStateByTitle', args: { titleContentId } });
    },
    voidPlayHistory: async (_client: unknown, _profileId: string, contentId: string, voidedAt: string) => {
      calls.push({ method: 'voidPlayHistory', args: { contentId, voidedAt } });
    },
    voidPlayHistoryByTitle: async (_client: unknown, _profileId: string, titleContentId: string, voidedAt: string) => {
      calls.push({ method: 'voidPlayHistoryByTitle', args: { titleContentId, voidedAt } });
    },
    getProjectionAggregate: async () => overrides.getProjectionAggregate,
    upsertTitleProjection: async (_client: unknown, args: Record<string, unknown>) => { calls.push({ method: 'upsertTitleProjection', args }); },
    deleteTitleProjection: async (_client: unknown, _profileId: string, titleContentId: string) => {
      calls.push({ method: 'deleteTitleProjection', args: { titleContentId } });
    },
  };
}
