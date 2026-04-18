import test from 'node:test';
import assert from 'node:assert/strict';
import { setTestEnv } from '../../test-helpers.js';

setTestEnv({
  ADMIN_UI_USER: 'admin-user',
  ADMIN_UI_PASSWORD: 'admin-pass',
  ADMIN_UI_SESSION_SECRET: 'admin-session-secret-for-tests',
  SERVICE_CLIENTS_JSON: '[]',
});

test('admin episodic-follow route returns canonical next-episode fields for authenticated admin session', async (t) => {
  const Fastify = (await import('fastify')).default;
  const { default: errorHandlerPlugin } = await import('../plugins/error-handler.js');
  const { default: adminUiAuthPlugin } = await import('../plugins/admin-ui-auth.js');
  const { registerAdminUiRoutes } = await import('./admin-ui.js');
  const { registerAdminApiRoutes } = await import('./admin-api.js');
  const { RecommendationDataService } = await import('../../modules/recommendations/recommendation-data.service.js');

  const original = RecommendationDataService.prototype.getEpisodicFollowForAccountService;
  RecommendationDataService.prototype.getEpisodicFollowForAccountService = async function () {
    return [{
      show: {
        mediaType: 'show',
        mediaKey: 'show:tmdb:100',
        provider: 'tmdb',
        providerId: '100',
        title: 'Example Show',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: 2024,
        rating: 8.2,
        genre: null,
        subtitle: null,
      },
      reason: 'watchlist',
      lastInteractedAt: '2026-04-07T12:00:00.000Z',
      nextEpisodeAirDate: '2026-04-10T00:00:00.000Z',
      nextEpisodeMediaKey: 'episode:tmdb:100:1:2',
      nextEpisodeSeasonNumber: 1,
      nextEpisodeEpisodeNumber: 2,
      nextEpisodeAbsoluteEpisodeNumber: null,
      nextEpisodeTitle: 'Episode 2',
      metadataRefreshedAt: '2026-04-07T12:10:00.000Z',
      payload: { source: 'follow' },
    }] as never;
  };

  t.after(() => {
    RecommendationDataService.prototype.getEpisodicFollowForAccountService = original;
  });

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(adminUiAuthPlugin);
  await registerAdminUiRoutes(app);
  await registerAdminApiRoutes(app);
  t.after(async () => { await app.close(); });

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
  const sessionCookie = readCookieHeader(loginResponse.headers['set-cookie']);

  const response = await app.inject({
    method: 'GET',
    url: '/admin/api/accounts/account-1/profiles/profile-1/episodic-follow',
    headers: {
      cookie: sessionCookie,
      host: 'localhost',
      origin: 'http://localhost',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    items: [{
      show: {
        mediaType: 'show',
        mediaKey: 'show:tmdb:100',
        provider: 'tmdb',
        providerId: '100',
        title: 'Example Show',
        posterUrl: 'https://img.test/poster.jpg',
        releaseYear: 2024,
        rating: 8.2,
        genre: null,
        subtitle: null,
      },
      reason: 'watchlist',
      lastInteractedAt: '2026-04-07T12:00:00.000Z',
      nextEpisodeAirDate: '2026-04-10T00:00:00.000Z',
      nextEpisodeMediaKey: 'episode:tmdb:100:1:2',
      nextEpisodeSeasonNumber: 1,
      nextEpisodeEpisodeNumber: 2,
      nextEpisodeAbsoluteEpisodeNumber: null,
      nextEpisodeTitle: 'Episode 2',
      metadataRefreshedAt: '2026-04-07T12:10:00.000Z',
      payload: { source: 'follow' },
    }],
  });
});

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
