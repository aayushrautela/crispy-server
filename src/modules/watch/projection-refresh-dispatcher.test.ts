import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { ProjectionRefreshDispatcher } = await import('./projection-refresh-dispatcher.js');

test('invalidateCalendar enqueues calendar refresh', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshCalendarCache: async (profileId: string) => { enqueued.push(`calendar:v2:${profileId}`); },
    enqueueMetadataRefresh: async () => {},
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.invalidateCalendar('profile-1');

  assert.deepEqual(enqueued, ['calendar:v2:profile-1']);
});

test('refreshMetadata enqueues metadata refresh when mediaKey provided', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshCalendarCache: async () => {},
    enqueueMetadataRefresh: async (profileId: string, mediaKey?: string) => {
      enqueued.push(`metadata:${profileId}:${mediaKey}`);
    },
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.refreshMetadata('profile-1', 'movie:tmdb:1');

  assert.deepEqual(enqueued, ['metadata:profile-1:movie:tmdb:1']);
});

test('refreshMetadata accepts missing mediaKey', async () => {
  const enqueued: string[] = [];
  const mockQueue = {
    enqueueRefreshCalendarCache: async () => {},
    enqueueMetadataRefresh: async (profileId: string, mediaKey?: string) => {
      enqueued.push(`metadata:${profileId}:${mediaKey}`);
    },
  };

  const dispatcher = new ProjectionRefreshDispatcher({ warn: () => {} } as never, mockQueue);
  await dispatcher.refreshMetadata('profile-1');

  assert.deepEqual(enqueued, ['metadata:profile-1:undefined']);
});

test('invalidateCalendar swallows queue errors and logs warning', async () => {
  let warned = false;
  const mockQueue = {
    enqueueRefreshCalendarCache: async () => { throw new Error('queue down'); },
    enqueueMetadataRefresh: async () => {},
  };

  const dispatcher = new ProjectionRefreshDispatcher({
    warn: () => { warned = true; },
  } as never, mockQueue);

  await dispatcher.invalidateCalendar('profile-1');
  assert.equal(warned, true);
});
