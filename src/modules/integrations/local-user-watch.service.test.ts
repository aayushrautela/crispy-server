import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

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
