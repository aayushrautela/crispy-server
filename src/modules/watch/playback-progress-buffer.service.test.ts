import { test } from 'node:test';
import assert from 'node:assert';
import { PlaybackProgressBuffer, type BufferedPlaybackProgress } from './playback-progress-buffer.service.js';
import { redis } from '../../lib/redis.js';

type Call = {
  accountId: string;
  profileId: string;
  itemId: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
  eventKind: 'playback_progress' | 'playback_completed';
};

function makeBuffer(calls: Call[]): PlaybackProgressBuffer {
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
  eventKind: 'playback_progress',
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

test('forwards eventKind to recordPlaybackState', async () => {
  const calls: Call[] = [];
  const buffer = makeBuffer(calls);
  await buffer.bufferProgress({ ...base, eventKind: 'playback_completed' });
  await buffer.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.eventKind, 'playback_completed');
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
