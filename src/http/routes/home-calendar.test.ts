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
          kind: 'calendar_item',
          mediaItem: {
            mediaKey: 'show:tmdb:500',
            mediaType: 'show',
            title: 'Example Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
              backdrop: { small: 'https://img.test/show-backdrop.jpg', medium: 'https://img.test/show-backdrop.jpg', large: 'https://img.test/show-backdrop.jpg' },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2024,
            rating: 8.5,
            genres: [],
            runtimeMinutes: 44,
            status: null,
            maturityRating: null,
            certification: null,
            externalIds: { tmdb: 500, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 500,
            seasonNumber: 1,
            episodeNumber: 3,
            absoluteEpisodeNumber: null,
            episodeTitle: 'Third Episode',
            airDate: '2024-01-03',
          },
          context: {
            bucket: 'this_week',
            airDate: '2024-01-03',
            watched: false,
            relatedShow: {
              mediaKey: 'show:tmdb:500',
              mediaType: 'show',
              title: 'Example Show',
              originalTitle: null,
              subtitle: null,
              overview: null,
              images: {
                poster: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
                backdrop: { small: null, medium: null, large: null },
                logo: { small: null, medium: null, large: null },
                still: { small: null, medium: null, large: null },
              },
              releaseDate: null,
              releaseYear: 2024,
              rating: 8.5,
              genres: [],
              runtimeMinutes: null,
              status: null,
              maturityRating: null,
              certification: null,
              externalIds: { tmdb: 500, imdb: null, tvdb: null },
              parent: null,
              showTmdbId: 500,
              seasonNumber: null,
              episodeNumber: null,
              absoluteEpisodeNumber: null,
              episodeTitle: null,
              airDate: null,
            },
          },
          presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
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
        kind: 'calendar_item',
        mediaItem: {
          mediaKey: 'show:tmdb:500',
          mediaType: 'show',
          title: 'Example Show',
          originalTitle: null,
          subtitle: null,
          overview: null,
          images: {
            poster: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
            backdrop: { small: 'https://img.test/show-backdrop.jpg', medium: 'https://img.test/show-backdrop.jpg', large: 'https://img.test/show-backdrop.jpg' },
            logo: { small: null, medium: null, large: null },
            still: { small: null, medium: null, large: null },
          },
          releaseDate: null,
          releaseYear: 2024,
          rating: 8.5,
          genres: [],
          runtimeMinutes: 44,
          status: null,
          maturityRating: null,
          certification: null,
          externalIds: { tmdb: 500, imdb: null, tvdb: null },
          parent: null,
          showTmdbId: 500,
          seasonNumber: 1,
          episodeNumber: 3,
          absoluteEpisodeNumber: null,
          episodeTitle: 'Third Episode',
          airDate: '2024-01-03',
        },
        context: {
          bucket: 'this_week',
          airDate: '2024-01-03',
          watched: false,
          relatedShow: {
            mediaKey: 'show:tmdb:500',
            mediaType: 'show',
            title: 'Example Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
              backdrop: { small: null, medium: null, large: null },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2024,
            rating: 8.5,
            genres: [],
            runtimeMinutes: null,
            status: null,
            maturityRating: null,
            certification: null,
            externalIds: { tmdb: 500, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 500,
            seasonNumber: null,
            episodeNumber: null,
            absoluteEpisodeNumber: null,
            episodeTitle: null,
            airDate: null,
          },
        },
        presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
        airDate: '2024-01-03',
        watched: false,
      },
    ],
  });
  assert.equal('kind' in response.json(), false);
  assert.equal('relatedShow' in response.json().items[0].context, true);
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
          kind: 'calendar_item',
          mediaItem: {
            mediaKey: 'show:tmdb:501',
            mediaType: 'show',
            title: 'Next Week Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/next-show-poster.jpg', medium: 'https://img.test/next-show-poster.jpg', large: 'https://img.test/next-show-poster.jpg' },
              backdrop: { small: 'https://img.test/next-show-backdrop.jpg', medium: 'https://img.test/next-show-backdrop.jpg', large: 'https://img.test/next-show-backdrop.jpg' },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2024,
            rating: 8.3,
            genres: [],
            runtimeMinutes: 46,
            status: null,
            maturityRating: null,
            certification: null,
            externalIds: { tmdb: 501, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 501,
            seasonNumber: 2,
            episodeNumber: 1,
            absoluteEpisodeNumber: null,
            episodeTitle: 'Season Premiere',
            airDate: '2024-01-05',
          },
          context: {
            bucket: 'this_week',
            airDate: '2024-01-05',
            watched: false,
            relatedShow: {
              mediaKey: 'show:tmdb:501',
              mediaType: 'show',
              title: 'Next Week Show',
              originalTitle: null,
              subtitle: null,
              overview: null,
              images: {
                poster: { small: 'https://img.test/next-show-poster.jpg', medium: 'https://img.test/next-show-poster.jpg', large: 'https://img.test/next-show-poster.jpg' },
                backdrop: { small: null, medium: null, large: null },
                logo: { small: null, medium: null, large: null },
                still: { small: null, medium: null, large: null },
              },
              releaseDate: null,
              releaseYear: 2024,
              rating: 8.3,
              genres: [],
              runtimeMinutes: null,
              status: null,
              maturityRating: null,
              certification: null,
              externalIds: { tmdb: 501, imdb: null, tvdb: null },
              parent: null,
              showTmdbId: 501,
              seasonNumber: null,
              episodeNumber: null,
              absoluteEpisodeNumber: null,
              episodeTitle: null,
              airDate: null,
            },
          },
          presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
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
        kind: 'calendar_item',
        mediaItem: {
          mediaKey: 'show:tmdb:501',
          mediaType: 'show',
          title: 'Next Week Show',
          originalTitle: null,
          subtitle: null,
          overview: null,
          images: {
            poster: { small: 'https://img.test/next-show-poster.jpg', medium: 'https://img.test/next-show-poster.jpg', large: 'https://img.test/next-show-poster.jpg' },
            backdrop: { small: 'https://img.test/next-show-backdrop.jpg', medium: 'https://img.test/next-show-backdrop.jpg', large: 'https://img.test/next-show-backdrop.jpg' },
            logo: { small: null, medium: null, large: null },
            still: { small: null, medium: null, large: null },
          },
          releaseDate: null,
          releaseYear: 2024,
          rating: 8.3,
          genres: [],
          runtimeMinutes: 46,
          status: null,
          maturityRating: null,
          certification: null,
          externalIds: { tmdb: 501, imdb: null, tvdb: null },
          parent: null,
          showTmdbId: 501,
          seasonNumber: 2,
          episodeNumber: 1,
          absoluteEpisodeNumber: null,
          episodeTitle: 'Season Premiere',
          airDate: '2024-01-05',
        },
        context: {
          bucket: 'this_week',
          airDate: '2024-01-05',
          watched: false,
          relatedShow: {
            mediaKey: 'show:tmdb:501',
            mediaType: 'show',
            title: 'Next Week Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/next-show-poster.jpg', medium: 'https://img.test/next-show-poster.jpg', large: 'https://img.test/next-show-poster.jpg' },
              backdrop: { small: null, medium: null, large: null },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2024,
            rating: 8.3,
            genres: [],
            runtimeMinutes: null,
            status: null,
            maturityRating: null,
            certification: null,
            externalIds: { tmdb: 501, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 501,
            seasonNumber: null,
            episodeNumber: null,
            absoluteEpisodeNumber: null,
            episodeTitle: null,
            airDate: null,
          },
        },
        presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
        airDate: '2024-01-05',
        watched: false,
      },
    ],
  });
  assert.equal(response.json().kind, 'this-week');
  assert.equal('relatedShow' in response.json().items[0].context, true);
});
