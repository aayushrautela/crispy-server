import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
});

async function makeBaseItemDto(overrides: Record<string, unknown>) {
  const itemId = overrides.itemId as string ?? '00000000000000000000000000000503';
  const tmdbId = overrides.tmdbId as string ?? '500';
  return {
    Id: itemId,
    Type: 'Episode',
    Name: overrides.name as string ?? 'Example Show',
    OriginalTitle: null,
    Overview: null,
    Taglines: [],
    ProductionYear: overrides.productionYear as number ?? 2026,
    PremiereDate: null,
    CommunityRating: overrides.communityRating as number ?? 8.5,
    OfficialRating: null,
    Certification: null,
    Genres: [],
    RunTimeTicks: (overrides.runTimeSeconds as number | null ?? 2640) * 10_000_000,
    Status: null,
    ProviderIds: { Tmdb: tmdbId, Imdb: null, Tvdb: null },
    ImageTags: {
      Primary: { small: overrides.posterSmall as string ?? 'https://img.test/poster.jpg', medium: overrides.posterMedium as string ?? 'https://img.test/poster.jpg', large: overrides.posterLarge as string ?? 'https://img.test/poster.jpg' },
      Backdrop: [{ small: overrides.backdropSmall as string ?? 'https://img.test/backdrop.jpg', medium: overrides.backdropMedium as string ?? 'https://img.test/backdrop.jpg', large: overrides.backdropLarge as string ?? 'https://img.test/backdrop.jpg' }],
      Logo: null,
      Thumb: null,
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: overrides.seriesId as string ?? null,
    SeriesName: overrides.seriesName as string ?? null,
    SeasonId: null,
    SeasonName: null,
    ParentIndexNumber: overrides.parentIndexNumber as number | null ?? 1,
    IndexNumber: overrides.indexNumber as number | null ?? 3,
    AbsoluteIndexNumber: null,
    EpisodeTitle: overrides.episodeTitle as string | null ?? 'Third Episode',
    AirDate: overrides.airDate as string | null ?? '2026-04-17T00:00:00.000Z',
    RemoteTrailers: [],
    PosterColor: null,
    BackdropColor: null,
    UserData: null,
  } as const;
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
    const mediaItem = await makeBaseItemDto({
      itemId: itemKey,
      tmdbId: '500',
      name: 'Example Show',
      productionYear: 2026,
      communityRating: 8.5,
      runTimeSeconds: 2640,
      seriesId: seriesItemId,
      seriesName: 'Example Show',
      parentIndexNumber: 1,
      indexNumber: 3,
      episodeTitle: 'Third Episode',
      airDate: '2026-04-17T00:00:00.000Z',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [mediaItem],
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
  assert.equal(data.items[0].Id, itemKey);
  assert.equal(data.items[0].Type, 'Episode');
  assert.equal(data.items[0].Name, 'Example Show');
  assert.equal(data.items[0].ParentIndexNumber, 1);
  assert.equal(data.items[0].IndexNumber, 3);
  assert.equal(data.items[0].EpisodeTitle, 'Third Episode');
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
    const mediaItem = await makeBaseItemDto({
      itemId: itemKey,
      tmdbId: '501',
      name: 'Next Week Show',
      productionYear: 2026,
      communityRating: 8.3,
      runTimeSeconds: 2760,
      seriesId: seriesItemId,
      seriesName: 'Next Week Show',
      parentIndexNumber: 2,
      indexNumber: 1,
      episodeTitle: 'Season Premiere',
      airDate: '2026-04-18T00:00:00.000Z',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2026-04-15T00:00:00.000Z',
      items: [mediaItem],
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
  assert.equal(data.items[0].Id, itemKey);
  assert.equal(data.items[0].Type, 'Episode');
  assert.equal(data.items[0].Name, 'Next Week Show');
  assert.equal(data.items[0].ParentIndexNumber, 2);
  assert.equal(data.items[0].IndexNumber, 1);
  assert.equal(data.items[0].EpisodeTitle, 'Season Premiere');
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
