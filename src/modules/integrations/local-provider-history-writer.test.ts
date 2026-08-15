import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { LocalProviderHistoryWriter } = await import('./local-provider-history-writer.js');

const appUser = {
  id: 'local-user-1',
  authSubject: 'local-user-1',
  email: 'test@example.com',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  lastSeenAt: '2026-05-15T00:00:00.000Z',
};

const profile = {
  id: 'profile-1',
  profileGroupId: '',
  name: 'Test Profile',
  interfaceLanguage: 'en',
  region: null,
  avatarUrl: null,
  isAdmin: false,
  requirePinToAddProfiles: false,
  hasPin: false,
  isKids: false,
  sortOrder: 0,
  createdByUserId: 'local-user-1',
  recommendationSource: 'reco',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
};

const job = {
  id: 'job-1',
  profileId: 'profile-1',
  profileGroupId: '',
  provider: 'trakt',
  requestedByUserId: 'local-user-1',
  status: 'succeeded',
} as never;

const providerSession = {
  id: 'session-1',
  profileId: 'profile-1',
  provider: 'trakt',
  providerUserId: 'trakt-user-1',
  externalUsername: 'traktuser',
  credentialsJson: '{}',
} as never;

test('LocalProviderHistoryWriter::replaceImportedInteractions - returns result for empty input', async (t) => {
  const writer = new LocalProviderHistoryWriter();
  const client = {
    query: async () => ({ rowCount: 0 }),
  } as never;

  const result = await writer.replaceImportedInteractions(client, {
    appUser,
    job,
    profile,
    providerSession,
    historyGeneration: 1,
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, false);
  assert.equal(result.historyInserted, 0);
  assert.equal(result.watchlistInserted, 0);
  assert.equal(result.ratingsInserted, 0);
  assert.equal(result.playbackInserted, 0);
});

test('LocalProviderHistoryWriter::replaceImportedInteractions - populates season/episode numbers for episodes', async (t) => {
  const queries: string[] = [];
  const params: unknown[][] = [];

  const contentIdentityService = {
    ensureContentId: async (_client: any, identity: { mediaKey: string }) => {
      return identity.mediaKey.startsWith('show:') ? 'title-uuid-1' : 'episode-uuid-2';
    },
    ensureContentIds: async (_client: any, identities: Array<{ mediaKey: string }>) => {
      const map = new Map<string, string>();
      for (const identity of identities) {
        map.set(identity.mediaKey, identity.mediaKey.startsWith('show:') ? 'title-uuid-1' : 'episode-uuid-2');
      }
      return map;
    },
  };

  const writer = new LocalProviderHistoryWriter(contentIdentityService as any);

  const client = {
    query: async (sql: string, args: unknown[]) => {
      queries.push(sql);
      params.push(args);
      return { rowCount: 1, rows: [] };
    },
  } as never;

  const result = await writer.replaceImportedInteractions(client, {
    appUser,
    job,
    profile,
    providerSession,
    historyGeneration: 1,
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [],
    watchlistItems: [],
    ratings: [],
    playbackStates: [
      {
        mediaKey: 'episode:tmdb:12345:2:3',
        titleMediaKey: 'show:tmdb:12345',
        mediaType: 'episode',
        positionSeconds: 600,
        durationSeconds: 1200,
        progressBps: 5000,
        occurredAt: '2026-05-14T00:00:00.000Z',
        completed: false,
      },
    ],
  });

  assert.equal(result.skipped, false);
  assert.equal(result.playbackInserted, 1);

  const insertQuery = queries.find((q) => q.includes('INSERT INTO user_state.playback_progress'));
  assert.ok(insertQuery, 'should have an INSERT query for playback_progress');
  assert.ok(insertQuery.includes('season_number'), 'INSERT should include season_number column');
  assert.ok(insertQuery.includes('episode_number'), 'INSERT should include episode_number column');

  const insertParams = params.find((_, i) => queries[i] === insertQuery);
  assert.ok(insertParams, 'should have params for the INSERT');
  assert.equal(insertParams![8], 2, 'season_number should be 2');
  assert.equal(insertParams![9], 3, 'episode_number should be 3');
});

test('LocalProviderHistoryWriter::replaceImportedInteractions - handles DB error gracefully', async (t) => {
  const writer = new LocalProviderHistoryWriter();
  const client = {
    query: async () => { throw new Error('connection failed'); },
  } as never;

  const result = await writer.replaceImportedInteractions(client, {
    appUser,
    job,
    profile,
    providerSession,
    historyGeneration: 1,
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [{ mediaKey: 'movie:tmdb:1', mediaType: 'movie', watchedAt: '2026-05-10T00:00:00.000Z' }],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, true);
  assert.ok(result.warnings.length > 0);
});
