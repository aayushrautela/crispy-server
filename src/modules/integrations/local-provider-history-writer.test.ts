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

  const insertQuery = queries.find((q) => q.includes('INSERT INTO user_state.watch_state'));
  assert.ok(insertQuery, 'should have an INSERT query for watch_state');
  assert.ok(!insertQuery.includes('season_number'), 'INSERT must no longer store season_number');
  assert.ok(!insertQuery.includes('episode_number'), 'INSERT must no longer store episode_number');
  assert.ok(!insertQuery.includes('media_type'), 'INSERT must no longer store media_type');

  const insertParams = params.find((_, i) => queries[i] === insertQuery);
  assert.ok(insertParams, 'should have params for the INSERT');
  assert.equal(insertParams![5], 600, 'position_seconds should be 600');
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
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [{ mediaKey: 'movie:tmdb:1', mediaType: 'movie', watchedAt: '2026-05-10T00:00:00.000Z' }],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, true);
  assert.ok(result.warnings.length > 0);
});

test('LocalProviderHistoryWriter::replaceImportedInteractions - stores episode history as media_type episode', async (t) => {
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
  } as never;

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
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [
      {
        mediaKey: 'episode:tmdb:12345:2:3',
        mediaType: 'episode',
        watchedAt: '2026-05-10T00:00:00.000Z',
        seasonNumber: 2,
        episodeNumber: 3,
      },
    ],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, false);
  assert.equal(result.historyInserted, 1);

  const insertQuery = queries.find((q) => q.includes('INSERT INTO user_state.watch_state'));
  assert.ok(insertQuery, 'should have an INSERT query for watch_state');
  assert.ok(!insertQuery.includes('media_type'), 'history must no longer store media_type');
  assert.ok(insertQuery.includes('played'), 'history must store played');
  assert.ok(insertQuery.includes('play_count'), 'history must store play_count');
  const insertParams = params.find((_, i) => queries[i] === insertQuery);
  assert.ok(insertParams, 'should have params for the INSERT');
  assert.equal(insertParams![2], '2026-05-10T00:00:00.000Z', 'watched_at should be bound as a parameter');
});

test('LocalProviderHistoryWriter::replaceImportedInteractions - playback upsert merges instead of dropping', async (t) => {
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
  } as never;

  const writer = new LocalProviderHistoryWriter(contentIdentityService as any);

  const client = {
    query: async (sql: string, args: unknown[]) => {
      queries.push(sql);
      params.push(args);
      return { rowCount: 1, rows: [] };
    },
  } as never;

  await writer.replaceImportedInteractions(client, {
    appUser,
    job,
    profile,
    providerSession,
    importedAt: '2026-05-15T00:00:00.000Z',
    historyEntries: [],
    watchlistItems: [],
    ratings: [],
    playbackStates: [
      {
        mediaKey: 'movie:tmdb:555',
        titleMediaKey: 'movie:tmdb:555',
        mediaType: 'movie',
        positionSeconds: 600,
        durationSeconds: 1200,
        progressBps: 5000,
        occurredAt: '2026-05-14T00:00:00.000Z',
        completed: false,
      },
    ],
  });

  const insertQuery = queries.find((q) => q.includes('INSERT INTO user_state.watch_state'));
  assert.ok(insertQuery, 'should have an INSERT query for watch_state');
  assert.ok(
    insertQuery.includes('ON CONFLICT (profile_id, item_id) DO UPDATE SET'),
    'playback upsert must merge on conflict instead of dropping',
  );
  assert.ok(!insertQuery.includes('DO NOTHING'), 'playback upsert must not be a no-op on conflict');
  assert.ok(insertQuery.includes('GREATEST(user_state.watch_state.play_count, EXCLUDED.play_count)'), 'must keep the max play count');
  assert.ok(insertQuery.includes('user_state.watch_state.played OR EXCLUDED.played'), 'must keep played=true if either side is played');
});

