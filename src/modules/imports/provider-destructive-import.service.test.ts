import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HttpError } = await import('../../lib/errors.js');
const { ProviderDestructiveImportService } = await import('./provider-destructive-import.service.js');
const { WatchHistoryEntriesRepository } = await import('./watch-history-entries.repo.js');

function createService(overrides?: {
  watchHistoryEntriesRepository?: InstanceType<typeof WatchHistoryEntriesRepository>;
}) {
  return new ProviderDestructiveImportService(
    {
      markResetForImport: async () => ({ historyGeneration: 7 }),
      markImportCompleted: async () => ({ historyGeneration: 7 }),
    } as never,
    (overrides?.watchHistoryEntriesRepository ?? {
      clearForProfile: async () => {},
      append: async () => ({ id: 'history-1' }),
    }) as never,
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

test('replaceProfileWatchData aligns imported event and history insert placeholders', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = createService({
    watchHistoryEntriesRepository: new WatchHistoryEntriesRepository(),
  });
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      if (text.includes('INSERT INTO watch_history_entries')) {
        return {
          rows: [{
            id: 'history-1',
            profile_id: values[0],
            profile_group_id: values[1],
            media_key: values[2],
            media_type: values[3],
            provider: values[4],
            provider_id: values[5],
            parent_provider: values[6],
            parent_provider_id: values[7],
            tmdb_id: values[8],
            show_tmdb_id: values[9],
            season_number: values[10],
            episode_number: values[11],
            absolute_episode_number: values[12],
            watched_at: values[13],
            source_watch_event_id: values[14],
            source_kind: values[15],
            payload: JSON.parse(String(values[16] ?? '{}')),
            created_at: '2024-01-01T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    },
  } as never;

  await service.replaceProfileWatchData(client, {
    job: { id: 'job-1', profileId: '11111111-1111-1111-1111-111111111111', profileGroupId: '22222222-2222-2222-2222-222222222222' } as never,
    provider: 'trakt',
    payload: {
      importedAt: '2024-01-01T00:00:00.000Z',
      importedEvents: [{
        eventType: 'mark_watched',
        mediaKey: 'episode:tmdb:100:1:2',
        mediaType: 'episode',
        provider: 'tmdb',
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
        mediaKey: 'episode:tmdb:100:1:2',
        mediaType: 'episode',
        provider: 'tmdb',
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

  const watchEventInsert = queries.find((entry) => entry.text.includes('INSERT INTO watch_events'));
  assert.ok(watchEventInsert, 'expected watch_events insert query');
  assert.match(watchEventInsert.text, /\$22::jsonb/);
  assert.equal(watchEventInsert.values.length, 22);

  const historyInsert = queries.find((entry) => entry.text.includes('INSERT INTO watch_history_entries'));
  assert.ok(historyInsert, 'expected watch_history_entries insert query');
  assert.match(historyInsert.text, /\$17::jsonb/);
  assert.equal(historyInsert.values.length, 17);
});
