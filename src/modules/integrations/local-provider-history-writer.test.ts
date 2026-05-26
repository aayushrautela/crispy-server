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
  avatarKey: null,
  isKids: false,
  sortOrder: 0,
  createdByUserId: 'local-user-1',
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
