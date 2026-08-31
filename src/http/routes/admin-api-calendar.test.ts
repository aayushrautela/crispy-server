import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
});

function makeCalendarCard(overrides: Record<string, unknown>) {
  const itemId = overrides.itemId as string ?? '00000000000000000000000000000503';
  return {
    itemId,
    mediaType: 'episode',
    title: overrides.title as string ?? 'Third Episode',
    overview: null,
    year: overrides.year as number | null ?? 2026,
    releaseDate: overrides.releaseDate as string | null ?? '2026-04-17',
    rating: overrides.rating as number | null ?? 8.5,
    maturityRating: null,
    genres: ['Drama'],
    runtimeSeconds: overrides.runtimeSeconds as number | null ?? 2640,
    images: {
      artwork: { small: 'https://img.test/artwork.jpg', medium: 'https://img.test/artwork.jpg', large: 'https://img.test/artwork.jpg' },
      logo: { small: 'https://img.test/logo.png', medium: 'https://img.test/logo.png', large: 'https://img.test/logo.png' },
      still: { small: 'https://img.test/still.jpg', medium: 'https://img.test/still.jpg', large: 'https://img.test/still.jpg' },
    },
    trailerUrl: null,
    progress: null,
    parent: {
      seriesItemId: overrides.seriesItemId as string | undefined ?? undefined,
      seriesTitle: overrides.seriesTitle as string | undefined ?? undefined,
      seasonItemId: undefined,
      seasonNumber: overrides.seasonNumber as number | null ?? 1,
      episodeNumber: overrides.episodeNumber as number | null ?? 3,
    },
    providerIds: { tmdb: overrides.tmdbId as string ?? '500', tvdb: null, imdb: null },
    airDate: overrides.airDate as string | null ?? '2026-04-17',
    bucket: overrides.bucket as string ?? 'up_next',
  };
}

test('admin calendar route returns canonical envelope fields for authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');

  const itemKey = '00000000000000000000000000000503';
  const seriesItemId = '00000000000000000000000000000500';
  const original = CalendarService.prototype.getCalendarForAccountService;
  CalendarService.prototype.getCalendarForAccountService = async function (_accountId, profileId) {
    const item = makeCalendarCard({
      itemId: itemKey,
      tmdbId: '500',
      title: 'Third Episode',
      seriesTitle: 'Example Show',
      seriesItemId,
      year: 2026,
      rating: 8.5,
      runtimeSeconds: 2640,
      seasonNumber: 1,
      episodeNumber: 3,
      airDate: '2026-04-17',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [item],
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
  const data = response.json().data;
  assert.equal(data.profileId, 'profile-1');
  assert.equal(data.source, 'canonical_calendar');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].itemId, itemKey);
  assert.equal(data.items[0].mediaType, 'episode');
  assert.equal(data.items[0].title, 'Third Episode');
  assert.equal(data.items[0].parent.seasonNumber, 1);
  assert.equal(data.items[0].parent.episodeNumber, 3);
  assert.equal(data.items[0].parent.seriesTitle, 'Example Show');
  assert.equal(data.items[0].bucket, 'up_next');
  assert.ok(data.items[0].images.logo);
});

test('admin calendar this-week route returns narrowed canonical envelope fields for authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');

  const itemKey = '00000000000000000000000000000521';
  const seriesItemId = '00000000000000000000000000000501';
  const original = CalendarService.prototype.getThisWeekForAccountService;
  CalendarService.prototype.getThisWeekForAccountService = async function (_accountId, profileId) {
    const item = makeCalendarCard({
      itemId: itemKey,
      tmdbId: '501',
      title: 'Season Premiere',
      seriesTitle: 'Next Week Show',
      seriesItemId,
      year: 2026,
      rating: 8.3,
      runtimeSeconds: 2760,
      seasonNumber: 2,
      episodeNumber: 1,
      airDate: '2026-04-18',
      bucket: 'this_week',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [item],
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
  const data = response.json().data;
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].itemId, itemKey);
  assert.equal(data.items[0].title, 'Season Premiere');
  assert.equal(data.items[0].parent.seriesTitle, 'Next Week Show');
  assert.equal(data.items[0].parent.seasonNumber, 2);
  assert.equal(data.items[0].bucket, 'this_week');
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
