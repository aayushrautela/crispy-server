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
      runtime: {
        continueWatching: {
          id: 'continue-watching',
          title: 'Continue Watching',
          layout: 'landscape',
          source: 'canonical_watch',
          items: [],
        },
        thisWeek: {
          id: 'this-week',
          title: 'This Week',
          layout: 'landscape',
          source: 'canonical_calendar',
          items: [],
        },
      },
      snapshot: {
        sourceKey: 'default',
        generatedAt: '2024-01-01T00:00:00.000Z',
        sections: [
          {
            id: 'hero-1',
            title: 'Featured Tonight',
            layout: 'hero',
            items: [
              {
                mediaKey: 'movie:tmdb:100',
                mediaType: 'movie',
                provider: 'tmdb',
                providerId: '100',
                title: 'Featured Movie',
                description: 'A major featured release.',
                backdropUrl: 'https://img.test/hero-backdrop.jpg',
                posterUrl: 'https://img.test/hero-poster.jpg',
                logoUrl: null,
                releaseYear: 2024,
                rating: 8.1,
                genre: null,
              },
            ],
            meta: {},
          },
          {
            id: 'collection-1',
            title: 'Franchise Picks',
            layout: 'collection',
            items: [
              {
                title: 'Collection Spotlight',
                logoUrl: 'https://img.test/collection-logo.png',
                items: [
                  {
                    mediaType: 'movie',
                    provider: 'tmdb',
                    providerId: '201',
                    title: 'Part One',
                    posterUrl: 'https://img.test/part-one.jpg',
                    releaseYear: 2020,
                    rating: 7.1,
                  },
                  {
                    mediaType: 'movie',
                    provider: 'tmdb',
                    providerId: '202',
                    title: 'Part Two',
                    posterUrl: 'https://img.test/part-two.jpg',
                    releaseYear: 2021,
                    rating: 7.4,
                  },
                  {
                    mediaType: 'movie',
                    provider: 'tmdb',
                    providerId: '203',
                    title: 'Part Three',
                    posterUrl: 'https://img.test/part-three.jpg',
                    releaseYear: 2022,
                    rating: 7.7,
                  },
                ],
              },
            ],
            meta: {},
          },
        ],
      },
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
    runtime: {
      continueWatching: {
        id: 'continue-watching',
        title: 'Continue Watching',
        layout: 'landscape',
        source: 'canonical_watch',
        items: [],
      },
      thisWeek: {
        id: 'this-week',
        title: 'This Week',
        layout: 'landscape',
        source: 'canonical_calendar',
        items: [],
      },
    },
    snapshot: {
      sourceKey: 'default',
      generatedAt: '2024-01-01T00:00:00.000Z',
      sections: [
        {
          id: 'hero-1',
          title: 'Featured Tonight',
          layout: 'hero',
          items: [
            {
              mediaKey: 'movie:tmdb:100',
              mediaType: 'movie',
              provider: 'tmdb',
              providerId: '100',
              title: 'Featured Movie',
              description: 'A major featured release.',
              backdropUrl: 'https://img.test/hero-backdrop.jpg',
              posterUrl: 'https://img.test/hero-poster.jpg',
              logoUrl: null,
              releaseYear: 2024,
              rating: 8.1,
              genre: null,
            },
          ],
          meta: {},
        },
        {
          id: 'collection-1',
          title: 'Franchise Picks',
          layout: 'collection',
          items: [
            {
              title: 'Collection Spotlight',
              logoUrl: 'https://img.test/collection-logo.png',
              items: [
                {
                  mediaType: 'movie',
                  provider: 'tmdb',
                  providerId: '201',
                  title: 'Part One',
                  posterUrl: 'https://img.test/part-one.jpg',
                  releaseYear: 2020,
                  rating: 7.1,
                },
                {
                  mediaType: 'movie',
                  provider: 'tmdb',
                  providerId: '202',
                  title: 'Part Two',
                  posterUrl: 'https://img.test/part-two.jpg',
                  releaseYear: 2021,
                  rating: 7.4,
                },
                {
                  mediaType: 'movie',
                  provider: 'tmdb',
                  providerId: '203',
                  title: 'Part Three',
                  posterUrl: 'https://img.test/part-three.jpg',
                  releaseYear: 2022,
                  rating: 7.7,
                },
              ],
            },
          ],
          meta: {},
        },
      ],
    },
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
      items: [
        {
          bucket: 'this_week',
          media: {
            mediaKey: 'show:tmdb:500',
            mediaType: 'show',
            provider: 'tmdb',
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
            mediaKey: 'show:tmdb:500',
            mediaType: 'show',
            provider: 'tmdb',
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
          mediaKey: 'show:tmdb:500',
          mediaType: 'show',
          provider: 'tmdb',
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
          mediaKey: 'show:tmdb:500',
          mediaType: 'show',
          provider: 'tmdb',
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
