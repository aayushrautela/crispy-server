import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

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
      items: [
        {
          bucket: 'this_week',
          media: {
            mediaKey: 'show:tvdb:500',
            mediaType: 'show',
            provider: 'tvdb',
            providerId: '500',
            title: 'Example Show',
            posterUrl: 'https://img.test/show-poster.jpg',
            backdropUrl: 'https://img.test/show-backdrop.jpg',
            releaseYear: 2024,
            rating: 8.5,
            genre: null,
            seasonNumber: 1,
            episodeNumber: 3,
            episodeTitle: 'Third Episode',
            airDate: '2024-01-03',
            runtimeMinutes: 44,
          },
          relatedShow: {
            mediaKey: 'show:tvdb:500',
            mediaType: 'show',
            provider: 'tvdb',
            providerId: '500',
            title: 'Example Show',
            posterUrl: 'https://img.test/show-poster.jpg',
            releaseYear: 2024,
            rating: 8.5,
            genre: null,
            subtitle: null,
          },
          airDate: '2024-01-03',
          watched: false,
        },
      ],
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
    items: [
      {
        bucket: 'this_week',
        media: {
          mediaKey: 'show:tvdb:500',
          mediaType: 'show',
          provider: 'tvdb',
          providerId: '500',
          title: 'Example Show',
          posterUrl: 'https://img.test/show-poster.jpg',
          backdropUrl: 'https://img.test/show-backdrop.jpg',
          releaseYear: 2024,
          rating: 8.5,
          genre: null,
          seasonNumber: 1,
          episodeNumber: 3,
          episodeTitle: 'Third Episode',
          airDate: '2024-01-03',
          runtimeMinutes: 44,
        },
        relatedShow: {
          mediaKey: 'show:tvdb:500',
          mediaType: 'show',
          provider: 'tvdb',
          providerId: '500',
          title: 'Example Show',
          posterUrl: 'https://img.test/show-poster.jpg',
          releaseYear: 2024,
          rating: 8.5,
          genre: null,
          subtitle: null,
        },
        airDate: '2024-01-03',
        watched: false,
      },
    ],
  });
});

test('calendar this-week route returns narrowed canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getThisWeek;

  t.after(() => {
    CalendarService.prototype.getThisWeek = original;
  });

  CalendarService.prototype.getThisWeek = async function (_userId, profileId) {
    return {
      profileId,
      source: 'canonical_calendar',
      kind: 'this-week',
      generatedAt: '2024-01-03T00:00:00.000Z',
      items: [
        {
          bucket: 'this_week',
          media: {
            mediaKey: 'show:tvdb:501',
            mediaType: 'show',
            provider: 'tvdb',
            providerId: '501',
            title: 'Next Week Show',
            posterUrl: 'https://img.test/next-show-poster.jpg',
            backdropUrl: 'https://img.test/next-show-backdrop.jpg',
            releaseYear: 2024,
            rating: 8.3,
            genre: null,
            seasonNumber: 2,
            episodeNumber: 1,
            episodeTitle: 'Season Premiere',
            airDate: '2024-01-05',
            runtimeMinutes: 46,
          },
          relatedShow: {
            mediaKey: 'show:tvdb:501',
            mediaType: 'show',
            provider: 'tvdb',
            providerId: '501',
            title: 'Next Week Show',
            posterUrl: 'https://img.test/next-show-poster.jpg',
            releaseYear: 2024,
            rating: 8.3,
            genre: null,
            subtitle: null,
          },
          airDate: '2024-01-05',
          watched: false,
        },
      ],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar/this-week', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    profileId: 'profile-1',
    source: 'canonical_calendar',
    kind: 'this-week',
    generatedAt: '2024-01-03T00:00:00.000Z',
    items: [
      {
        bucket: 'this_week',
        media: {
          mediaKey: 'show:tvdb:501',
          mediaType: 'show',
          provider: 'tvdb',
          providerId: '501',
          title: 'Next Week Show',
          posterUrl: 'https://img.test/next-show-poster.jpg',
          backdropUrl: 'https://img.test/next-show-backdrop.jpg',
          releaseYear: 2024,
          rating: 8.3,
          genre: null,
          seasonNumber: 2,
          episodeNumber: 1,
          episodeTitle: 'Season Premiere',
          airDate: '2024-01-05',
          runtimeMinutes: 46,
        },
        relatedShow: {
          mediaKey: 'show:tvdb:501',
          mediaType: 'show',
          provider: 'tvdb',
          providerId: '501',
          title: 'Next Week Show',
          posterUrl: 'https://img.test/next-show-poster.jpg',
          releaseYear: 2024,
          rating: 8.3,
          genre: null,
          subtitle: null,
        },
        airDate: '2024-01-05',
        watched: false,
      },
    ],
  });
});
