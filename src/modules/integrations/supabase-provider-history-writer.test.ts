import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { SupabaseProviderHistoryWriter } = await import('./supabase-provider-history-writer.js');

const appUser = {
  id: 'local-user-1',
  authSubject: '00000000-0000-0000-0000-000000000001',
  email: 'user@example.com',
} as never;

const profile = {
  id: '10000000-0000-0000-0000-000000000001',
  profileGroupId: 'profile-group-1',
  name: 'Main',
  avatarKey: 'avatar-1',
  isKids: false,
  sortOrder: 0,
} as never;

const job = {
  id: 'job-1',
  provider: 'trakt',
} as never;

const providerSession = {
  providerUserId: 'provider-user-1',
  externalUsername: 'crispy',
} as never;

test('replaceImportedInteractions skips without service role client', async () => {
  const writer = new SupabaseProviderHistoryWriter(null);

  const result = await writer.replaceImportedInteractions({
    appUser,
    profile,
    job,
    providerSession,
    historyGeneration: 0,
    importedAt: '2026-05-11T00:00:00.000Z',
    historyEntries: [],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, true);
  assert.deepEqual(result.warnings, ['No Supabase service role client configured']);
});

test('replaceImportedInteractions calls all provider import RPCs', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: calls.length, error: null };
    },
  };
  const writer = new SupabaseProviderHistoryWriter(client as never);

  const result = await writer.replaceImportedInteractions({
    appUser,
    profile,
    job,
    providerSession,
    historyGeneration: 2,
    importedAt: '2026-05-11T00:00:00.000Z',
    historyEntries: [{ mediaKey: 'movie:tmdb:1', mediaType: 'movie', watchedAt: '2026-05-10T00:00:00.000Z' }],
    watchlistItems: [{ mediaKey: 'show:tmdb:2', mediaType: 'show', addedAt: '2026-05-09T00:00:00.000Z' }],
    ratings: [{ mediaKey: 'movie:tmdb:3', mediaType: 'movie', rating: 8, ratedAt: '2026-05-08T00:00:00.000Z' }],
    playbackStates: [{
      mediaKey: 'episode:tmdb:4:s1:e1',
      titleMediaKey: 'show:tmdb:4',
      mediaType: 'episode',
      positionSeconds: 120,
      durationSeconds: 2400,
      progressBps: 500,
      occurredAt: '2026-05-07T00:00:00.000Z',
      completed: false,
    }],
  });

  assert.deepEqual(calls.map((call) => call.name), [
    'replace_provider_import_history',
    'replace_provider_import_list_items',
    'replace_provider_import_ratings',
    'replace_provider_import_playback_states',
  ]);
  assert.equal(result.historyInserted, 1);
  assert.equal(result.watchlistInserted, 2);
  assert.equal(result.ratingsInserted, 3);
  assert.equal(result.playbackInserted, 4);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual((calls[1]?.args.p_items as unknown[])[0], {
    media_key: 'show:tmdb:2',
    media_type: 'show',
    added_at: '2026-05-09T00:00:00.000Z',
  });
  assert.deepEqual((calls[2]?.args.p_ratings as unknown[])[0], {
    media_key: 'movie:tmdb:3',
    media_type: 'movie',
    rating: 8,
    rated_at: '2026-05-08T00:00:00.000Z',
  });
  assert.deepEqual((calls[3]?.args.p_states as unknown[])[0], {
    media_key: 'episode:tmdb:4:s1:e1',
    title_media_key: 'show:tmdb:4',
    media_type: 'episode',
    position_seconds: 120,
    duration_seconds: 2400,
    progress_bps: 500,
    occurred_at: '2026-05-07T00:00:00.000Z',
    completed: false,
  });
});

test('replaceImportedInteractions converts RPC errors into warnings', async () => {
  const client = {
    rpc: async (name: string) => ({
      data: null,
      error: name === 'replace_provider_import_ratings' ? { message: 'ratings failed' } : null,
    }),
  };
  const writer = new SupabaseProviderHistoryWriter(client as never);

  const result = await writer.replaceImportedInteractions({
    appUser,
    profile,
    job,
    providerSession,
    historyGeneration: 0,
    importedAt: '2026-05-11T00:00:00.000Z',
    historyEntries: [],
    watchlistItems: [],
    ratings: [],
    playbackStates: [],
  });

  assert.equal(result.skipped, false);
  assert.deepEqual(result.warnings, ['ratings sync failed: ratings failed']);
});
