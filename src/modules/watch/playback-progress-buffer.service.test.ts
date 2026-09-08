import { test } from 'node:test';
import assert from 'node:assert';
import { seedTestEnv } from '../../test-helpers.js';
import type { BufferedPlaybackProgress } from './playback-progress-buffer.service.js';

seedTestEnv();

const { PlaybackProgressBuffer } = await import('./playback-progress-buffer.service.js');
const { redis } = await import('../../lib/redis.js');

type Call = {
  accountId: string;
  profileId: string;
  itemId: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
};

function makeBuffer(calls: Call[]): InstanceType<typeof PlaybackProgressBuffer> {
  const watchService = {
    recordPlaybackState: async (params: Call) => {
      calls.push(params);
    },
  } as unknown as import('../integrations/local-user-watch.service.js').LocalUserWatchService;
  return new PlaybackProgressBuffer(watchService, 10_000);
}

const base: BufferedPlaybackProgress = {
  accountId: 'acc-1',
  profileId: 'prof-1',
  itemId: '00000000-0000-4000-8000-000000000001',
  titleItemId: '00000000-0000-4000-8000-000000000001',
  mediaType: 'movie',
  positionSeconds: 10,
  durationSeconds: 100,
  progressBps: 1000,
  seasonNumber: null,
  episodeNumber: null,
  lastActivityAt: '2026-05-13T00:00:00.000Z',
};

test('coalesces multiple heartbeats into one flush write (last-write-wins)', async () => {
  const calls: Call[] = [];
  const buffer = makeBuffer(calls);
  await buffer.bufferProgress({ ...base, positionSeconds: 10 });
  await buffer.bufferProgress({ ...base, positionSeconds: 25 });
  await buffer.bufferProgress({ ...base, positionSeconds: 40 });
  await buffer.flush();
  assert.equal(calls.length, 1, 'only the latest position should be written');
  assert.equal(calls[0]!.positionSeconds, 40);
});

test('flushes distinct items as separate writes', async () => {
  const calls: Call[] = [];
  const buffer = makeBuffer(calls);
  await buffer.bufferProgress({ ...base, itemId: '00000000-0000-4000-8000-000000000001', positionSeconds: 10 });
  await buffer.bufferProgress({ ...base, itemId: '00000000-0000-4000-8000-000000000002', positionSeconds: 20 });
  await buffer.flush();
  assert.equal(calls.length, 2);
});

test('drains leftover processing set from a crash on boot', async () => {
  const calls: Call[] = [];
  const buffer = makeBuffer(calls);
  await buffer.bufferProgress({ ...base, positionSeconds: 30 });
  // Simulate a crash: dirty member moved to processing but not cleared.
  await redis.sadd('cw:dirty:acc-1:prof-1', base.itemId);
  await redis.smove('cw:dirty:acc-1:prof-1', 'cw:processing:acc-1:prof-1', base.itemId);
  await buffer.flushPendingOnBoot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.positionSeconds, 30);
});

test('isolates per-item flush failures so one bad item does not stall the profile batch', async () => {
  const calls: Call[] = [];
  const watchService = {
    recordPlaybackState: async (params: Call) => {
      if (params.itemId === '00000000-0000-4000-8000-000000000002') {
        throw new Error('write failed');
      }
      calls.push(params);
    },
  } as unknown as import('../integrations/local-user-watch.service.js').LocalUserWatchService;
  const buffer = new PlaybackProgressBuffer(watchService, 10_000);

  await buffer.bufferProgress({ ...base, itemId: '00000000-0000-4000-8000-000000000001', positionSeconds: 10 });
  await buffer.bufferProgress({ ...base, itemId: '00000000-0000-4000-8000-000000000002', positionSeconds: 20 });
  await buffer.bufferProgress({ ...base, itemId: '00000000-0000-4000-8000-000000000003', positionSeconds: 30 });
  await buffer.flush();

  assert.deepEqual(calls.map((call) => call.itemId), [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003',
  ]);

  // The failed item is re-queued on the dirty set and retried on the next
  // flush; the processing set is kept until every member has been written.
  const retryCalls: Call[] = [];
  const retryBuffer = new PlaybackProgressBuffer({
    recordPlaybackState: async (params: Call) => {
      retryCalls.push(params);
    },
  } as unknown as import('../integrations/local-user-watch.service.js').LocalUserWatchService, 10_000);
  await retryBuffer.flush();
  assert.deepEqual(retryCalls.map((call) => call.itemId), ['00000000-0000-4000-8000-000000000002']);
  assert.equal(retryCalls[0]!.positionSeconds, 20);
});
