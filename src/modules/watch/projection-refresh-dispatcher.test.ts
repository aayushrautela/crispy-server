import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { ProjectionRefreshDispatcher } = await import('./projection-refresh-dispatcher.js');

test('notifyProfileChanged enqueues home and calendar refresh', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshHomeCache: async (profileId: string) => { enqueued.push(`home:v2:${profileId}`); },
    enqueueRefreshCalendarCache: async (profileId: string) => { enqueued.push(`calendar:v2:${profileId}`); },
    enqueueMetadataRefresh: async () => {},
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.notifyProfileChanged('profile-1');

  assert.deepEqual(enqueued, ['home:v2:profile-1', 'calendar:v2:profile-1']);
});

test('notifyProfileChanged enqueues metadata refresh when mediaKey provided', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshHomeCache: async () => {},
    enqueueRefreshCalendarCache: async () => {},
    enqueueMetadataRefresh: async (profileId: string, mediaKey?: string) => {
      enqueued.push(`metadata:${profileId}:${mediaKey}`);
    },
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.notifyProfileChanged('profile-1', { mediaKey: 'movie:tmdb:1' });

  assert.deepEqual(enqueued, ['metadata:profile-1:movie:tmdb:1']);
});

test('notifyProfileChanged skips metadata refresh when refreshMetadata is false', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshHomeCache: async () => {},
    enqueueRefreshCalendarCache: async () => {},
    enqueueMetadataRefresh: async (profileId: string, mediaKey?: string) => {
      enqueued.push(`metadata:${profileId}:${mediaKey}`);
    },
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.notifyProfileChanged('profile-1', { mediaKey: 'movie:tmdb:1', refreshMetadata: false });

  assert.deepEqual(enqueued, []);
});

test('notifyProfileChanged swallows queue errors and logs warning', async () => {
  let warned = false;
  const mockQueue = {
    enqueueRefreshHomeCache: async () => { throw new Error('queue down'); },
    enqueueRefreshCalendarCache: async () => {},
    enqueueMetadataRefresh: async () => {},
  };

  const dispatcher = new ProjectionRefreshDispatcher({
    warn: () => { warned = true; },
  } as never, mockQueue);

  await dispatcher.notifyProfileChanged('profile-1');
  assert.equal(warned, true);
});
