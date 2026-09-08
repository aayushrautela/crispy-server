import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { LocalUserWatchService } = await import('./local-user-watch.service.js');
const { db } = await import('../../lib/db.js');

type CapturedStatement = { sql: string; params: unknown[] };

/**
 * Stubs the pg pool so write-path statements can be captured without a live
 * database. Restores both `db.query` and `db.connect` afterwards.
 */
function captureDbWrites(t: import('node:test').TestContext): CapturedStatement[] {
  const statements: CapturedStatement[] = [];
  const originalQuery = db.query.bind(db);
  const originalConnect = db.connect.bind(db);

  const fakeClient = {
    query: async (sql: string, params?: unknown[]) => {
      statements.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };

  db.query = (async (sql: string, params?: unknown[]) => {
    statements.push({ sql, params: params ?? [] });
    return { rows: [], rowCount: 0 };
  }) as typeof db.query;
  db.connect = (async () => fakeClient) as typeof db.connect;

  t.after(() => {
    db.query = originalQuery;
    db.connect = originalConnect;
  });
  return statements;
}

const REWATCH_PARAMS = {
  accountId: '00000000-0000-4000-8000-00000000a001',
  profileId: '00000000-0000-4000-8000-00000000p001',
  itemId: '00000000-0000-4000-8000-00000000i001',
  titleItemId: '00000000-0000-4000-8000-00000000i001',
  mediaType: 'movie' as const,
  durationSeconds: null,
  occurredAt: '2026-09-08T12:00:00.000Z',
  clientEventId: null,
  seasonNumber: null,
  episodeNumber: null,
};

test('resolvePlaybackDecision: no runtime keeps item in progress and preserves resume point', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(120, null), { kind: 'in_progress', positionSeconds: 120 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(0, null), { kind: 'ignored' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(null, null), { kind: 'ignored' });
});

test('resolvePlaybackDecision: sub-floor reports are ignored, never stored or reset', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(2, 1000), { kind: 'ignored' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(0, 1000), { kind: 'ignored' });
});

test('resolvePlaybackDecision: mid-progress stores resume position', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(50, 1000), { kind: 'in_progress', positionSeconds: 50 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(500, 1000), { kind: 'in_progress', positionSeconds: 500 });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(800, 1000), { kind: 'in_progress', positionSeconds: 800 });
});

test('resolvePlaybackDecision: >= MaxResumePct or at end is played', () => {
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(910, 1000), { kind: 'played' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(999, 1000), { kind: 'played' });
  assert.deepEqual(LocalUserWatchService.resolvePlaybackDecision(1000, 1000), { kind: 'played' });
});

test('deleteHistory resolves cascade target ids for season, show, and episode', async (t) => {
  const { ContentIdentityRepository } = await import('../identity/content-identity.repo.js');

  ContentIdentityRepository.prototype.findChildContentIds = async function (
    _client: unknown,
    parentContentId: string,
    relationshipType: string,
  ): Promise<string[]> {
    if (relationshipType === 'season' && parentContentId === 'season-1') return ['ep-a', 'ep-b'];
    if (relationshipType === 'season' && parentContentId === 'show-1') return ['season-1', 'season-2'];
    if (relationshipType === 'series' && parentContentId === 'show-1') return ['ep-1', 'ep-2'];
    return [];
  };
  LocalUserWatchService.prototype.resolveEpisodePlayableItemId = async function (
    _series: string,
    _season: number,
    _episode: number,
  ): Promise<string | null> {
    return 'ep-target';
  };

  const service = new LocalUserWatchService();
  const resolve = (params: Record<string, unknown>) =>
    (service as unknown as {
      resolveHistoryTargetItemIds: (client: unknown, p: unknown) => Promise<string[]>;
    }).resolveHistoryTargetItemIds({}, params as never);

  assert.deepEqual(
    await resolve({ itemId: 'movie-1', mediaType: 'movie' }),
    ['movie-1'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'ep-1', mediaType: 'episode' }),
    ['ep-1'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'season-1', mediaType: 'season' }),
    ['season-1', 'ep-a', 'ep-b'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'show-1', mediaType: 'show' }),
    ['show-1', 'ep-1', 'ep-2', 'season-1', 'season-2'],
  );
  assert.deepEqual(
    await resolve({ itemId: 'show-1', mediaType: 'show', seasonNumber: 1, episodeNumber: 3 }),
    ['ep-target'],
  );
});

test('resolveCascadeItemIds mirrors history targets for mark/unmark watched', async (t) => {
  const { ContentIdentityRepository } = await import('../identity/content-identity.repo.js');

  ContentIdentityRepository.prototype.findChildContentIds = async function (
    _client: unknown,
    parentContentId: string,
    relationshipType: string,
  ): Promise<string[]> {
    if (relationshipType === 'season' && parentContentId === 'season-1') return ['ep-a', 'ep-b'];
    if (relationshipType === 'season' && parentContentId === 'show-1') return ['season-1', 'season-2'];
    if (relationshipType === 'series' && parentContentId === 'show-1') return ['ep-1', 'ep-2'];
    return [];
  };
  LocalUserWatchService.prototype.resolveEpisodePlayableItemId = async function (
    _series: string,
    _season: number,
    _episode: number,
  ): Promise<string | null> {
    return 'ep-target';
  };

  const service = new LocalUserWatchService();
  const resolve = (itemId: string, mediaType: string, seasonNumber?: number, episodeNumber?: number) =>
    (service as unknown as {
      resolveCascadeItemIds: (client: unknown, i: string, m: string, s?: number, e?: number) => Promise<string[]>;
    }).resolveCascadeItemIds({}, itemId, mediaType as never, seasonNumber, episodeNumber);

  assert.deepEqual(await resolve('movie-1', 'movie'), ['movie-1']);
  assert.deepEqual(await resolve('ep-1', 'episode'), ['ep-1']);
  assert.deepEqual(await resolve('season-1', 'season'), ['season-1', 'ep-a', 'ep-b']);
  assert.deepEqual(await resolve('show-1', 'show'), ['show-1', 'ep-1', 'ep-2', 'season-1', 'season-2']);
  assert.deepEqual(await resolve('show-1', 'show', 1, 3), ['ep-target']);
});

test('recordPlaybackState in-progress upsert clears a stale played flag (rewatch lifecycle)', async (t) => {
  const statements = captureDbWrites(t);
  const service = new LocalUserWatchService();

  // Row left behind by the pre-31ad140 bug: played with a live resume position.
  // The in-progress upsert must clear played so the rewatch returns to
  // Continue Watching; play_count (completion history) stays untouched.
  await service.recordPlaybackState({ ...REWATCH_PARAMS, positionSeconds: 2889, durationSeconds: 7030 });

  const write = statements.find(({ sql }) => sql.includes('user_state.watch_state'));
  assert.ok(write, 'expected a watch_state upsert');
  assert.match(write.sql, /ON CONFLICT \(profile_id, item_id\) DO UPDATE SET[\s\S]*played = false/);
  assert.match(write.sql, /ON CONFLICT \(profile_id, item_id\) DO UPDATE SET[\s\S]*position_seconds = EXCLUDED\.position_seconds/);
  assert.doesNotMatch(write.sql, /play_count = user_state\.watch_state\.play_count \+ 1/);
  assert.equal(write.params[0], REWATCH_PARAMS.profileId);
  assert.equal(write.params[1], REWATCH_PARAMS.itemId);
  assert.equal(write.params[2], 2889);
});

test('recordPlaybackState completion branch clears position and increments play_count', async (t) => {
  const statements = captureDbWrites(t);
  const service = new LocalUserWatchService();

  await service.recordPlaybackState({ ...REWATCH_PARAMS, positionSeconds: 7300, durationSeconds: 7030 });

  const write = statements.find(({ sql }) => sql.includes('user_state.watch_state'));
  assert.ok(write, 'expected a watch_state upsert');
  assert.match(write.sql, /played = true/);
  assert.match(write.sql, /play_count = user_state\.watch_state\.play_count \+ 1/);
  assert.match(write.sql, /position_seconds = 0/);
});
