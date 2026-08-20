import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import { WATCH_ITEM_CONTENT_JOIN } from './local-user-watch.service.js';

seedTestEnv();

test('resolvePlayState: no runtime, position > 0 is played', async () => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.deepEqual(LocalUserWatchService.resolvePlayState(120, null), { played: true, positionSeconds: 0 });
  assert.deepEqual(LocalUserWatchService.resolvePlayState(0, null), { played: false, positionSeconds: 0 });
});

test('resolvePlayState: ignores near-zero starts (below MinResumePct)', async () => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.deepEqual(LocalUserWatchService.resolvePlayState(2, 1000), { played: false, positionSeconds: 0 });
});

test('resolvePlayState: mid-progress stores resume position', async () => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.deepEqual(LocalUserWatchService.resolvePlayState(500, 1000), { played: false, positionSeconds: 500 });
  assert.deepEqual(LocalUserWatchService.resolvePlayState(800, 1000), { played: false, positionSeconds: 800 });
});

test('resolvePlayState: >= MaxResumePct or at end is played and clears position', async () => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.deepEqual(LocalUserWatchService.resolvePlayState(910, 1000), { played: true, positionSeconds: 0 });
  assert.deepEqual(LocalUserWatchService.resolvePlayState(999, 1000), { played: true, positionSeconds: 0 });
  assert.deepEqual(LocalUserWatchService.resolvePlayState(1000, 1000), { played: true, positionSeconds: 0 });
});

test('deleteHistory resolves cascade target ids for season, show, and episode', async (t) => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
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

test('WATCH_ITEM_CONTENT_JOIN never casts an episode provider ref to integer', () => {
  const ttClause = (WATCH_ITEM_CONTENT_JOIN.split('LEFT JOIN tmdb_titles tt')[1] ?? '')
    .split('LEFT JOIN tmdb_tv_episodes')[0] ?? '';
  assert.ok(
    ttClause.includes("CASE WHEN ci.entity_type = 'movie' THEN cpr_tmdb.external_id::integer END"),
    'movie-title cast must be guarded by a CASE so episode provider refs are never cast',
  );

  const caseStart = ttClause.indexOf('CASE WHEN ci.entity_type = ');
  const caseEnd = ttClause.indexOf('END', caseStart);
  assert.ok(caseStart >= 0 && caseEnd > caseStart, 'CASE guard must wrap the integer cast');
  assert.ok(ttClause.indexOf('cpr_tmdb.external_id::integer') > caseStart && ttClause.indexOf('cpr_tmdb.external_id::integer') < caseEnd,
    'the integer cast must sit inside the CASE guard');
});
