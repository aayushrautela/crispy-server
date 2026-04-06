import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProviderDestructiveImportService } = await import('./provider-destructive-import.service.js');

function createService(overrides?: {
  projectionRebuildService?: { rebuildProfile: (...args: unknown[]) => Promise<{ titleProjections: number; trackedTitleStates: number }> };
  watchV2Repository?: Record<string, (...args: unknown[]) => Promise<unknown>>;
  contentIdentityService?: { ensureContentId?: (...args: unknown[]) => Promise<string> };
}) {
  return new ProviderDestructiveImportService(
    {
      markResetForImport: async () => ({ historyGeneration: 7 }),
      markImportCompleted: async () => ({ historyGeneration: 7 }),
    } as never,
    {
      clearForProfile: async () => {},
      append: async () => {},
    } as never,
    { clearOutputsForProfile: async () => {} } as never,
    (overrides?.projectionRebuildService ?? {
      rebuildProfile: async () => ({ titleProjections: 0, trackedTitleStates: 0 }),
    }) as never,
    { clearAllForProfile: async () => 0 } as never,
    (overrides?.watchV2Repository ?? createWatchV2Repository()) as never,
    (overrides?.contentIdentityService ?? {
      ensureContentId: async (_client: unknown, identity: { mediaType?: string }) => identity.mediaType === 'show' ? 'content-show-1' : 'content-episode-1',
    }) as never,
  );
}

const fakeClient = {
  query: async () => ({ rows: [] }),
} as never;

test('replaceProfileWatchData rejects invalid importedAt timestamps', async () => {
  const service = createService();

  await assert.rejects(
    () => service.replaceProfileWatchData(fakeClient, {
      job: { id: 'job-1', profileId: 'profile-1', profileGroupId: 'group-1' } as never,
      provider: 'trakt',
      payload: {
        importedAt: 'not-a-date',
        importedEvents: [],
        importedHistoryEntries: [],
        importSummary: {},
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_timestamp');
      assert.equal(error.message, 'Invalid importedAt timestamp.');
      return true;
    },
  );
});

test('replaceProfileWatchData rejects invalid imported event timestamps', async () => {
  const service = createService();

  await assert.rejects(
    () => service.replaceProfileWatchData(fakeClient, {
      job: { id: 'job-1', profileId: 'profile-1', profileGroupId: 'group-1' } as never,
      provider: 'trakt',
      payload: {
        importedAt: '2024-01-01T00:00:00.000Z',
        importedEvents: [{
          eventType: 'mark_watched',
          mediaKey: 'movie:tmdb:1',
          mediaType: 'movie',
          occurredAt: 'bad-occurrence',
        }],
        importedHistoryEntries: [],
        importSummary: {},
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_timestamp');
      assert.equal(error.message, 'Invalid occurredAt timestamp.');
      return true;
    },
  );
});

test('replaceProfileWatchData rejects invalid imported history timestamps', async () => {
  const service = createService();

  await assert.rejects(
    () => service.replaceProfileWatchData(fakeClient, {
      job: { id: 'job-1', profileId: 'profile-1', profileGroupId: 'group-1' } as never,
      provider: 'trakt',
      payload: {
        importedAt: '2024-01-01T00:00:00.000Z',
        importedEvents: [],
        importedHistoryEntries: [{
          mediaKey: 'movie:tmdb:1',
          mediaType: 'movie',
          watchedAt: 'bad-watch-time',
          sourceKind: 'provider_import',
        }],
        importSummary: {},
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'invalid_timestamp');
      assert.equal(error.message, 'Invalid watchedAt timestamp.');
      return true;
    },
  );
});

test('replaceProfileWatchData writes imported events and history directly into v2 repositories', async () => {
  const calls: string[] = [];
  const service = createService({
    projectionRebuildService: {
      rebuildProfile: async () => ({ titleProjections: 2, trackedTitleStates: 1 }),
    },
    watchV2Repository: createWatchV2Repository(calls),
  });

  const result = await service.replaceProfileWatchData(fakeClient, {
    job: { id: 'job-1', profileId: '11111111-1111-1111-1111-111111111111', profileGroupId: '22222222-2222-2222-2222-222222222222' } as never,
    provider: 'trakt',
    payload: {
      importedAt: '2024-01-01T00:00:00.000Z',
        importedEvents: [{
          eventType: 'mark_watched',
          mediaKey: 'episode:tvdb:100:1:2',
          mediaType: 'episode',
        provider: 'tvdb',
        providerId: '100',
        tmdbId: 100,
        showTmdbId: 100,
        seasonNumber: 1,
        episodeNumber: 2,
        absoluteEpisodeNumber: 2,
        occurredAt: '2024-01-01T00:00:00.000Z',
        payload: { source: 'test' },
      }],
      importedHistoryEntries: [{
        mediaKey: 'episode:tvdb:100:1:2',
        mediaType: 'episode',
        provider: 'tvdb',
        providerId: '100',
        tmdbId: 100,
        showTmdbId: 100,
        seasonNumber: 1,
        episodeNumber: 2,
        absoluteEpisodeNumber: 2,
        watchedAt: '2024-01-01T00:00:00.000Z',
        sourceKind: 'provider_import',
        payload: { source: 'test' },
      }],
      importSummary: {},
    },
  });

  assert.ok(calls.includes('reserveMutationSequence'));
  assert.ok(calls.includes('upsertWatchOverride'));
  assert.ok(calls.includes('upsertPlayableState'));
  assert.ok(calls.filter((call) => call === 'insertPlayHistory').length >= 2);
  assert.deepEqual(result.projectionSummary, { titleProjections: 2, trackedTitleStates: 1 });
  assert.equal(result.insertedEvents, 1);
  assert.equal(result.insertedHistoryEntries, 1);
});

test('replaceProfileWatchData collapses episode refresh keys to tracked show keys', async () => {
  const service = createService();

  const result = await service.replaceProfileWatchData(fakeClient, {
    job: { id: 'job-1', profileId: 'profile-1', profileGroupId: 'group-1' } as never,
    provider: 'trakt',
    payload: {
      importedAt: '2024-01-01T00:00:00.000Z',
      mediaKeysToRefresh: [
        'episode:tvdb:100:1:1',
        'episode:tvdb:100:1:2',
        'season:tvdb:100:1',
        'movie:tmdb:99',
      ],
      importedEvents: [{
        eventType: 'mark_watched',
        mediaKey: 'episode:tvdb:100:1:3',
        mediaType: 'episode',
        provider: 'tvdb',
        providerId: '100:s1:e3',
        parentProvider: 'tvdb',
        parentProviderId: '100',
        tvdbId: 100,
        seasonNumber: 1,
        episodeNumber: 3,
        occurredAt: '2024-01-01T00:00:00.000Z',
      }],
      importedHistoryEntries: [],
      importSummary: {},
    },
  });

  assert.deepEqual(result.mediaKeysToRefresh, ['show:tvdb:100', 'movie:tmdb:99']);
});

function createWatchV2Repository(calls: string[] = []) {
  return {
    reserveMutationSequence: async () => {
      calls.push('reserveMutationSequence');
      return 1;
    },
    upsertWatchOverride: async () => {
      calls.push('upsertWatchOverride');
    },
    upsertPlayableState: async () => {
      calls.push('upsertPlayableState');
    },
    insertPlayHistory: async () => {
      calls.push('insertPlayHistory');
    },
    upsertWatchlistState: async () => {
      calls.push('upsertWatchlistState');
    },
    upsertRatingState: async () => {
      calls.push('upsertRatingState');
    },
  };
}
