import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProviderDestructiveImportService } = await import('./provider-destructive-import.service.js');

function createService() {
  return new ProviderDestructiveImportService(
    {
      markResetForImport: async () => ({ historyGeneration: 7 }),
      markImportCompleted: async () => ({ historyGeneration: 7 }),
    } as never,
    {
      clearForProfile: async () => {},
      append: async () => ({ id: 'history-1' }),
    } as never,
    {
      clearForProfile: async () => {},
      append: async () => {},
    } as never,
    { clearOutputsForProfile: async () => {} } as never,
    { clearClaimsForProfile: async () => {} } as never,
    { rebuildProfile: async () => ({ eventsScanned: 0, mediaProgressRows: 0, watchHistoryRows: 0, watchlistRows: 0, ratingRows: 0, continueWatchingRows: 0, trackedSeriesRows: 0, metadataRefreshRecommended: false }) } as never,
    { clearAllForProfile: async () => 0 } as never,
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
