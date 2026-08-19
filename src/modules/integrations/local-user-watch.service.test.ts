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
