import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('home route returns canonical envelope fields', async (t) => {
  const { HomeService } = await import('../../modules/home/home.service.js');
  const original = HomeService.prototype.getHome;

  t.after(() => {
    HomeService.prototype.getHome = original;
  });

  HomeService.prototype.getHome = async function (_userId, profileId) {
    return {
      profileId,
      source: 'canonical_home',
      generatedAt: '2024-01-01T00:00:00.000Z',
      sections: [],
    } as never;
  };

  const { registerHomeRoutes } = await import('./home.js');
  const app = await buildTestApp(registerHomeRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/home', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    profileId: 'profile-1',
    source: 'canonical_home',
    generatedAt: '2024-01-01T00:00:00.000Z',
    sections: [],
  });
});

test('calendar route returns canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getCalendar;

  t.after(() => {
    CalendarService.prototype.getCalendar = original;
  });

  CalendarService.prototype.getCalendar = async function (_userId, profileId) {
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-02T00:00:00.000Z',
      items: [],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    profileId: 'profile-1',
    source: 'canonical_calendar',
    generatedAt: '2024-01-02T00:00:00.000Z',
    items: [],
  });
});
