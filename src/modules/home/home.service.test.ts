import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { HomeService } = await import('./home.service.js');
const { redis } = await import('../../lib/redis.js');

test('getHome builds payload without watch history dependency', async (t) => {
  const originalGet = redis.get;
  const originalSet = redis.set;

  (redis as { get: typeof redis.get }).get = async () => null;
  (redis as { set: typeof redis.set }).set = async () => 'OK';

  t.after(() => {
    (redis as { get: typeof redis.get }).get = originalGet;
    (redis as { set: typeof redis.set }).set = originalSet;
  });

  const service = new HomeService(
    {
      listContinueWatchingProducts: async () => ['continue-watching-item'],
    } as never,
    {
      getCalendar: async () => ({ items: ['calendar-item'] }),
    } as never,
    {
      getActiveRecommendationForAccount: async () => null,
    } as never,
    {
      build: ({ continueWatching, calendarItems }: { continueWatching: unknown[]; calendarItems: unknown[] }) => ({
        continueWatching,
        calendarItems,
      }),
    } as never,
  );

  const result = await service.getHome('user-1', 'profile-1');

  assert.equal(result.profileId, 'profile-1');
  assert.deepEqual(result.runtime, {
    continueWatching: ['continue-watching-item'],
    calendarItems: ['calendar-item'],
  });
});
