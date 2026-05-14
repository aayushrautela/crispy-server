import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
});

test('admin calendar route returns canonical envelope fields for authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');

  const original = CalendarService.prototype.getCalendarForAccountService;
  CalendarService.prototype.getCalendarForAccountService = async function (_accountId, profileId) {
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [
        {
          bucket: 'this_week',
          kind: 'calendar_item',
          mediaItem: {
            mediaType: 'episode',
            mediaKey: 'episode:tmdb:500:1:3',
            provider: 'tmdb',
            providerId: '500:1:3',
            title: 'Example Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' },
              backdrop: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2026,
            rating: 8.5,
            genres: [],
            runtimeMinutes: 44,
            status: null,
            maturityRating: null,
            certification: null,
            trailerUrl: null,
            trailerThumbnailUrl: null,
            posterColor: null,
            backdropColor: null,
            externalIds: { tmdb: 500, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 500,
            seasonNumber: 1,
            episodeNumber: 3,
            absoluteEpisodeNumber: null,
            episodeTitle: 'Third Episode',
            airDate: '2026-04-17T00:00:00.000Z',
          },
          context: {
            bucket: 'this_week',
            airDate: '2026-04-17T00:00:00.000Z',
            watched: false,
            relatedShow: {
              mediaType: 'show',
              mediaKey: 'show:tmdb:500',
              provider: 'tmdb',
              providerId: '500',
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
              releaseYear: 2026,
              rating: 8.5,
              genres: [],
              runtimeMinutes: null,
              status: null,
              maturityRating: null,
              certification: null,
              trailerUrl: null,
              trailerThumbnailUrl: null,
              posterColor: null,
              backdropColor: null,
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
          airDate: '2026-04-17T00:00:00.000Z',
          watched: false,
        },
      ],
    } as never;
  };

  t.after(() => {
    CalendarService.prototype.getCalendarForAccountService = original;
  });

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);
  t.after(async () => { await app.close(); });

  const sessionCookie = await loginAsAdmin(app);
  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/account-1/profiles/profile-1/calendar',
    headers: {
      cookie: sessionCookie,
      host: 'localhost',
      origin: 'http://localhost',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, {
    profileId: 'profile-1',
    source: 'canonical_calendar',
    generatedAt: '2026-04-15T00:00:00.000Z',
    items: [
      {
        bucket: 'this_week',
        kind: 'calendar_item',
        mediaItem: {
          mediaType: 'episode',
          mediaKey: 'episode:tmdb:500:1:3',
          provider: 'tmdb',
          providerId: '500:1:3',
          title: 'Example Show',
          originalTitle: null,
          subtitle: null,
          overview: null,
          images: {
            poster: { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' },
            backdrop: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' },
            logo: { small: null, medium: null, large: null },
            still: { small: null, medium: null, large: null },
          },
          releaseDate: null,
          releaseYear: 2026,
          rating: 8.5,
          genres: [],
          runtimeMinutes: 44,
          status: null,
          maturityRating: null,
          certification: null,
          trailerUrl: null,
          trailerThumbnailUrl: null,
          posterColor: null,
          backdropColor: null,
          externalIds: { tmdb: 500, imdb: null, tvdb: null },
          parent: null,
          showTmdbId: 500,
          seasonNumber: 1,
          episodeNumber: 3,
          absoluteEpisodeNumber: null,
          episodeTitle: 'Third Episode',
          airDate: '2026-04-17T00:00:00.000Z',
        },
        context: {
          bucket: 'this_week',
          airDate: '2026-04-17T00:00:00.000Z',
          watched: false,
          relatedShow: {
            mediaType: 'show',
            mediaKey: 'show:tmdb:500',
            provider: 'tmdb',
            providerId: '500',
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
            releaseYear: 2026,
            rating: 8.5,
            genres: [],
            runtimeMinutes: null,
            status: null,
            maturityRating: null,
            certification: null,
            trailerUrl: null,
            trailerThumbnailUrl: null,
            posterColor: null,
            backdropColor: null,
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
        airDate: '2026-04-17T00:00:00.000Z',
        watched: false,
      },
    ],
  });
});

test('admin calendar this-week route returns narrowed canonical envelope fields for authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');

  const original = CalendarService.prototype.getThisWeekForAccountService;
  CalendarService.prototype.getThisWeekForAccountService = async function (_accountId, profileId) {
    return {
      profileId,
      source: 'canonical_calendar',
      kind: 'this-week',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [
        {
          bucket: 'this_week',
          kind: 'calendar_item',
          mediaItem: {
            mediaType: 'episode',
            mediaKey: 'episode:tmdb:501:2:1',
            provider: 'tmdb',
            providerId: '501:2:1',
            title: 'Next Week Show',
            originalTitle: null,
            subtitle: null,
            overview: null,
            images: {
              poster: { small: 'https://img.test/next-poster.jpg', medium: 'https://img.test/next-poster.jpg', large: 'https://img.test/next-poster.jpg' },
              backdrop: { small: 'https://img.test/next-backdrop.jpg', medium: 'https://img.test/next-backdrop.jpg', large: 'https://img.test/next-backdrop.jpg' },
              logo: { small: null, medium: null, large: null },
              still: { small: null, medium: null, large: null },
            },
            releaseDate: null,
            releaseYear: 2026,
            rating: 8.3,
            genres: [],
            runtimeMinutes: 46,
            status: null,
            maturityRating: null,
            certification: null,
            trailerUrl: null,
            trailerThumbnailUrl: null,
            posterColor: null,
            backdropColor: null,
            externalIds: { tmdb: 501, imdb: null, tvdb: null },
            parent: null,
            showTmdbId: 501,
            seasonNumber: 2,
            episodeNumber: 1,
            absoluteEpisodeNumber: null,
            episodeTitle: 'Season Premiere',
            airDate: '2026-04-18T00:00:00.000Z',
          },
          context: {
            bucket: 'this_week',
            airDate: '2026-04-18T00:00:00.000Z',
            watched: false,
            relatedShow: {
              mediaType: 'show',
              mediaKey: 'show:tmdb:501',
              provider: 'tmdb',
              providerId: '501',
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
              releaseYear: 2026,
              rating: 8.3,
              genres: [],
              runtimeMinutes: null,
              status: null,
              maturityRating: null,
              certification: null,
              trailerUrl: null,
              trailerThumbnailUrl: null,
              posterColor: null,
              backdropColor: null,
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
          airDate: '2026-04-18T00:00:00.000Z',
          watched: false,
        },
      ],
    } as never;
  };

  t.after(() => {
    CalendarService.prototype.getThisWeekForAccountService = original;
  });

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);
  t.after(async () => { await app.close(); });

  const sessionCookie = await loginAsAdmin(app);
  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/account-1/profiles/profile-1/calendar/this-week',
    headers: {
      cookie: sessionCookie,
      host: 'localhost',
      origin: 'http://localhost',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, {
    profileId: 'profile-1',
    source: 'canonical_calendar',
    kind: 'this-week',
    generatedAt: '2026-04-15T00:00:00.000Z',
    items: [
      {
        bucket: 'this_week',
        kind: 'calendar_item',
        mediaItem: {
          mediaType: 'episode',
          mediaKey: 'episode:tmdb:501:2:1',
          provider: 'tmdb',
          providerId: '501:2:1',
          title: 'Next Week Show',
          originalTitle: null,
          subtitle: null,
          overview: null,
          images: {
            poster: { small: 'https://img.test/next-poster.jpg', medium: 'https://img.test/next-poster.jpg', large: 'https://img.test/next-poster.jpg' },
            backdrop: { small: 'https://img.test/next-backdrop.jpg', medium: 'https://img.test/next-backdrop.jpg', large: 'https://img.test/next-backdrop.jpg' },
            logo: { small: null, medium: null, large: null },
            still: { small: null, medium: null, large: null },
          },
          releaseDate: null,
          releaseYear: 2026,
          rating: 8.3,
          genres: [],
          runtimeMinutes: 46,
          status: null,
          maturityRating: null,
          certification: null,
          trailerUrl: null,
          trailerThumbnailUrl: null,
          posterColor: null,
          backdropColor: null,
          externalIds: { tmdb: 501, imdb: null, tvdb: null },
          parent: null,
          showTmdbId: 501,
          seasonNumber: 2,
          episodeNumber: 1,
          absoluteEpisodeNumber: null,
          episodeTitle: 'Season Premiere',
          airDate: '2026-04-18T00:00:00.000Z',
        },
        context: {
          bucket: 'this_week',
          airDate: '2026-04-18T00:00:00.000Z',
          watched: false,
          relatedShow: {
            mediaType: 'show',
            mediaKey: 'show:tmdb:501',
            provider: 'tmdb',
            providerId: '501',
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
            releaseYear: 2026,
            rating: 8.3,
            genres: [],
            runtimeMinutes: null,
            status: null,
            maturityRating: null,
            certification: null,
            trailerUrl: null,
            trailerThumbnailUrl: null,
            posterColor: null,
            backdropColor: null,
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
        airDate: '2026-04-18T00:00:00.000Z',
        watched: false,
      },
    ],
  });
});

async function loginAsAdmin(app: import('fastify').FastifyInstance): Promise<string> {
  const loginPage = await app.inject({ method: 'GET', url: '/admin/login' });
  const formToken = readHiddenInput(loginPage.body, 'formToken');
  const loginResponse = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'localhost',
      origin: 'http://localhost',
    },
    payload: new URLSearchParams({
      formToken,
      username: 'admin-user',
      password: 'admin-pass',
    }).toString(),
  });
  return readCookieHeader(loginResponse.headers['set-cookie']);
}

function readHiddenInput(html: string, name: string): string {
  const pattern = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]+)"`, 'i');
  const match = html.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Unable to find hidden input ${name}`);
  }
  return match[1];
}

function readCookieHeader(setCookieHeader: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
  const sessionCookie = cookies.find((value) => value.startsWith('crispy_admin_session='));
  if (!sessionCookie) {
    throw new Error('Admin login did not return a session cookie');
  }
  return sessionCookie.split(';')[0] ?? '';
}
