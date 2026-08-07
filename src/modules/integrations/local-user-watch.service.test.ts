import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('isBelowCompletionThreshold: below 90% returns true', async (t) => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(5000), true);
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(8999), true);
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(0), true);
});

test('isBelowCompletionThreshold: at or above 90% returns false', async (t) => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(9000), false);
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(9500), false);
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(10000), false);
});

test('isBelowCompletionThreshold: null progressBps returns false', async (t) => {
  const { LocalUserWatchService } = await import('./local-user-watch.service.js');
  assert.equal(LocalUserWatchService.isBelowCompletionThreshold(null), false);
});
